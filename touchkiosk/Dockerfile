FROM ghcr.io/home-assistant/base:3.24

ARG BUILD_VERSION
ARG BUILD_ARCH

LABEL \
    io.hass.version="${BUILD_VERSION}" \
    io.hass.type="app" \
    io.hass.arch="${BUILD_ARCH}"

# X-Server (ohne Desktop), Touch-Eingabe über libinput, Chromium als Browser,
# Python + Xlib für den Bildschirm-Manager (Standby / Touch-Wecken / API)
RUN apk add --no-cache \
        xorg-server \
        xf86-video-fbdev \
        xf86-input-libinput \
        libinput \
        libinput-udev \
        eudev \
        xrandr \
        xinput \
        xset \
        chromium \
        font-dejavu \
        font-noto-emoji \
        python3 \
        py3-xlib \
        util-linux

ENV DISPLAY=:0

COPY rootfs /

# Windows-Zeilenenden entfernen (falls Dateien unter Windows bearbeitet wurden)
RUN sed -i 's/\r$//' \
        /usr/bin/touchkiosk-run \
        /usr/share/touchkiosk/screen_manager.py \
        /usr/share/touchkiosk/autologin.js \
        /usr/share/touchkiosk/keyboard.js \
    && chmod a+x /usr/bin/touchkiosk-run /usr/share/touchkiosk/screen_manager.py

CMD ["/usr/bin/touchkiosk-run"]
