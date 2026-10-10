#!/usr/bin/env python3
"""Bildschirm-Manager für den Touch Kiosk.

* Schaltet den Monitor nach ``--timeout`` Sekunden ohne Eingabe per DPMS in
  den Standby (kein Signal -> der Monitor geht selbst in den Energiesparmodus).
* Legt vor dem Abschalten eine schwarze Ebene über den Browser. Die Berührung,
  die den Monitor wieder aufweckt, landet dadurch auf dieser Ebene und löst
  nicht versehentlich einen Schalter im Dashboard aus.
* Kleine HTTP-API (nur 127.0.0.1), damit Home Assistant den Bildschirm z. B.
  per Bewegungsmelder oder Klingel aufwecken kann:
      GET/POST /screen/on      -> einschalten bzw. Timer neu starten
      GET/POST /screen/off     -> sofort in den Standby
      GET/POST /screen/toggle  -> umschalten
      GET      /status         -> {"screen": "on"|"off", ...}
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import select
import signal
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from Xlib import X
from Xlib import display as xdisplay
from Xlib import error as xerror
from Xlib.ext import dpms

TOUCH_RELEASE_TIMEOUT = 2.0  # s: Sicherheitsnetz, falls kein "Loslassen" kommt
LOOP_INTERVAL = 0.5  # s


def log(message: str) -> None:
    print(f"[Bildschirm] {message}", flush=True)


class ScreenManager:
    def __init__(self, timeout: int, swallow_wake_touch: bool) -> None:
        self.timeout = max(0, timeout)
        self.swallow_wake_touch = swallow_wake_touch

        self.d = xdisplay.Display()
        self.screen = self.d.screen()
        self.root = self.screen.root

        self.has_idle = self.d.has_extension("MIT-SCREEN-SAVER")
        self.has_dpms = False
        if self.d.has_extension("DPMS"):
            try:
                self.has_dpms = bool(self.d.dpms_capable().capable)
            except xerror.XError:
                self.has_dpms = False

        self.standby = False
        self.overlay_mapped = False
        self.press_started: float | None = None
        self.last_wake = time.monotonic()

        self.commands: "queue.Queue[str]" = queue.Queue()
        self._wake_r, self._wake_w = os.pipe()
        self._state = {"screen": "on", "idle_seconds": 0, "timeout": self.timeout}
        self._state_lock = threading.Lock()

        self._setup_x()
        self.overlay = self._create_overlay()

    # ------------------------------------------------------------------ setup
    def _setup_x(self) -> None:
        # Eingebauten X-Bildschirmschoner abschalten – wir steuern selbst.
        self.d.set_screen_saver(0, 0, X.DontPreferBlanking, X.AllowExposures)
        if self.has_dpms:
            self.d.dpms_enable()
            self.d.dpms_set_timeouts(0, 0, 0)
            self.d.dpms_force_level(dpms.DPMSModeOn)
        self.d.sync()

        if not self.has_idle:
            log("WARNUNG: X meldet keine Leerlaufzeit (MIT-SCREEN-SAVER fehlt) – "
                "automatischer Standby nicht möglich.")
        if not self.has_dpms:
            log("WARNUNG: Monitor/Treiber unterstützt kein DPMS – statt Standby "
                "wird nur ein schwarzes Bild angezeigt.")

        if self.timeout > 0:
            log(f"Standby nach {self.timeout} s ohne Bedienung.")
        else:
            log("Automatischer Standby ist deaktiviert (screen_timeout = 0).")
        if self.swallow_wake_touch:
            log("Die Berührung zum Aufwecken wird nicht an das Dashboard weitergegeben.")

    def _create_overlay(self):
        geo = self.root.get_geometry()
        win = self.root.create_window(
            0, 0, geo.width, geo.height, 0,
            self.screen.root_depth,
            X.InputOutput,
            X.CopyFromParent,
            background_pixel=self.screen.black_pixel,
            override_redirect=True,
            event_mask=X.ButtonPressMask | X.ButtonReleaseMask | X.KeyPressMask,
        )
        win.set_wm_name("touchkiosk-wake-overlay")
        return win

    # ---------------------------------------------------------------- helpers
    def idle_seconds(self) -> float:
        since_wake = time.monotonic() - self.last_wake
        if not self.has_idle:
            return since_wake
        x_idle = self.root.screensaver_query_info().idle / 1000.0
        return min(x_idle, since_wake)

    def monitor_on(self) -> bool | None:
        if not self.has_dpms:
            return None
        info = self.d.dpms_info()
        return info.power_level == dpms.DPMSModeOn

    def _set_power(self, on: bool) -> None:
        if not self.has_dpms:
            return
        try:
            self.d.dpms_force_level(dpms.DPMSModeOn if on else dpms.DPMSModeOff)
            self.d.sync()
        except xerror.XError as err:
            log(f"DPMS-Fehler: {err}")

    def _show_overlay(self) -> None:
        geo = self.root.get_geometry()
        self.overlay.configure(x=0, y=0, width=geo.width, height=geo.height,
                               stack_mode=X.Above)
        self.overlay.map()
        self.overlay.configure(stack_mode=X.Above)
        self.d.sync()
        self.overlay_mapped = True

    def _hide_overlay(self) -> None:
        if self.overlay_mapped:
            self.overlay.unmap()
            self.d.sync()
        self.overlay_mapped = False

    # ---------------------------------------------------------------- actions
    def sleep(self, reason: str) -> None:
        # Ohne DPMS bleibt nur das schwarze Bild als "Standby".
        if self.swallow_wake_touch or not self.has_dpms:
            self._show_overlay()
            time.sleep(0.2)  # Ebene sicher anzeigen, bevor das Bild ausgeht
        self._set_power(False)
        self.standby = True
        self.press_started = None
        log(f"Standby ({reason}).")

    def wake(self, reason: str) -> None:
        was_standby = self.standby
        self._hide_overlay()
        self._set_power(True)
        self.standby = False
        self.press_started = None
        self.last_wake = time.monotonic()
        if was_standby:
            log(f"Aufgeweckt ({reason}).")

    # ------------------------------------------------------------ event loop
    def handle_event(self, ev) -> None:
        if not self.overlay_mapped:
            return
        if ev.type == X.ButtonPress:
            self.press_started = time.monotonic()
        elif ev.type == X.ButtonRelease:
            self.wake("Berührung")
        elif ev.type == X.KeyPress:
            self.wake("Taste")

    def handle_command(self, cmd: str) -> None:
        if cmd == "on":
            self.wake("Home Assistant")
        elif cmd == "off":
            if not self.standby:
                self.sleep("Home Assistant")
        elif cmd == "toggle":
            if self.standby:
                self.wake("Home Assistant")
            else:
                self.sleep("Home Assistant")

    def tick(self) -> None:
        now = time.monotonic()

        # Finger liegt auf, aber kein Loslassen kam an -> trotzdem aufwecken
        if self.press_started and now - self.press_started > TOUCH_RELEASE_TIMEOUT:
            self.wake("Berührung")

        idle = self.idle_seconds()
        powered = self.monitor_on()

        if self.standby:
            if not self.overlay_mapped and powered:
                # Ohne schwarze Ebene: die Eingabe selbst hat den Monitor geweckt
                self.standby = False
                self.last_wake = now
                log("Aufgeweckt (Eingabe).")
            elif self.overlay_mapped and powered and 0 < self.timeout <= idle:
                # Monitor z. B. durch Mausbewegung an, aber niemand tippt -> wieder aus
                self._set_power(False)
        elif self.timeout > 0 and idle >= self.timeout:
            self.sleep(f"{self.timeout} s keine Bedienung")

        with self._state_lock:
            self._state = {
                "screen": "off" if self.standby else "on",
                "idle_seconds": int(idle),
                "timeout": self.timeout,
            }

    def snapshot(self) -> dict:
        with self._state_lock:
            return dict(self._state)

    def submit(self, cmd: str) -> None:
        self.commands.put(cmd)
        os.write(self._wake_w, b"x")

    def run(self) -> None:
        x_fd = self.d.fileno()
        while True:
            readable, _, _ = select.select([x_fd, self._wake_r], [], [], LOOP_INTERVAL)
            if self._wake_r in readable:
                os.read(self._wake_r, 1024)
            while self.d.pending_events():
                self.handle_event(self.d.next_event())
            while True:
                try:
                    cmd = self.commands.get_nowait()
                except queue.Empty:
                    break
                self.handle_command(cmd)
            self.tick()

    def shutdown(self) -> None:
        try:
            self._hide_overlay()
            self._set_power(True)
            self.d.close()
        except Exception:  # noqa: BLE001 – beim Beenden egal
            pass


# ---------------------------------------------------------------------- API
ROUTES = {"/screen/on": "on", "/screen/off": "off", "/screen/toggle": "toggle"}


def make_handler(manager: ScreenManager):
    class ApiHandler(BaseHTTPRequestHandler):
        server_version = "TouchKiosk"

        def _send(self, status: int, payload: dict) -> None:
            body = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _handle(self) -> None:
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(length)
            path = self.path.split("?", 1)[0].rstrip("/") or "/"
            if path in ("/status", "/screen"):
                self._send(200, manager.snapshot())
                return
            cmd = ROUTES.get(path)
            if cmd is None:
                self._send(404, {"error": "unbekannter Pfad",
                                 "paths": sorted([*ROUTES, "/status"])})
                return
            manager.submit(cmd)
            self._send(200, {"ok": True, "command": cmd})

        do_GET = _handle
        do_POST = _handle

        def log_message(self, fmt, *args):  # noqa: N802 – leise
            pass

    return ApiHandler


def start_api(manager: ScreenManager, host: str, port: int) -> None:
    server = ThreadingHTTPServer((host, port), make_handler(manager))
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log(f"API bereit: http://{host}:{port}/screen/on | /screen/off | /status")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=180,
                        help="Sekunden bis zum Standby (0 = nie)")
    parser.add_argument("--swallow-wake-touch", action="store_true",
                        help="Aufweck-Berührung nicht an den Browser weitergeben")
    parser.add_argument("--api-host", default="127.0.0.1")
    parser.add_argument("--api-port", type=int, default=8099,
                        help="Port der lokalen API (0 = aus)")
    args = parser.parse_args()

    manager = ScreenManager(args.timeout, args.swallow_wake_touch)

    def _terminate(_sig, _frame):
        manager.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGTERM, _terminate)
    signal.signal(signal.SIGINT, _terminate)

    if args.api_port > 0:
        try:
            start_api(manager, args.api_host, args.api_port)
        except OSError as err:
            log(f"API konnte nicht starten (Port {args.api_port}): {err}")

    manager.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
