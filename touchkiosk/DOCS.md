# Touch Kiosk

Zeigt ein Home-Assistant-Dashboard im Vollbild auf einem Monitor, der direkt
am Home-Assistant-Gerät (z. B. Raspberry Pi 4) hängt – mit Touch-Bedienung und
automatischem Standby.

## So funktioniert es

- Ein schlanker X-Server läuft direkt auf dem HDMI-Ausgang (kein Desktop).
- Chromium zeigt das Dashboard im Kiosk-Modus (ohne Adressleiste, ohne Ränder).
- Nach **3 Minuten** ohne Berührung schaltet die App das Bildsignal ab
  (DPMS) – der Monitor geht in den Standby.
- Eine Berührung weckt den Monitor wieder. Diese erste Berührung wird
  abgefangen, damit nicht versehentlich ein Licht o. Ä. geschaltet wird.

## Vor dem ersten Start

1. **Andere Kiosk-Apps stoppen** (z. B. „HAOS Kiosk Display“). Es kann immer
   nur eine App den Bildschirm benutzen – sonst erscheint im Log
   `drmSetMaster failed: Resource busy`. Am besten Autostart dort ausschalten.
2. **Monitor einschalten und anschließen**, bevor die App startet:
   - Pi 4: Bild an **HDMI 0** (der Anschluss neben dem USB-C-Strom).
   - Touch: das USB-Kabel des Monitors an einen USB-Port des Pi.
3. **Zugriffstoken anlegen** (für die automatische Anmeldung):
   - Am besten einen eigenen Benutzer „Kiosk“ anlegen (kein Administrator).
   - Als dieser Benutzer anmelden → Profil → Sicherheit →
     *Langlebige Zugriffstoken* → *Token erstellen*.
   - Den Token in der App-Konfiguration bei **Langlebiges Zugriffstoken**
     eintragen.

   Ohne Token zeigt der Monitor die normale Anmeldeseite. Dann einmal mit
   angeschlossener Tastatur anmelden und „Angemeldet bleiben“ aktivieren – die
   Anmeldung bleibt gespeichert.

## Optionen

| Option | Standard | Bedeutung |
|---|---|---|
| `ha_url` | `http://localhost:8123` | Adresse von Home Assistant |
| `dashboard` | leer | z. B. `lovelace/0` oder `dashboard-kiosk/start` |
| `access_token` | leer | Langlebiges Zugriffstoken für die Auto-Anmeldung |
| `screen_timeout` | `180` | Sekunden bis zum Standby, `0` = nie |
| `swallow_wake_touch` | `true` | Aufweck-Berührung nicht ans Dashboard geben |
| `rotation` | `normal` | `left`, `right`, `inverted` – dreht Bild **und** Touch |
| `zoom` | `100` | Vergrößerung in Prozent |
| `hide_cursor` | `true` | Mauszeiger ausblenden |
| `video_driver` | `auto` | `modesetting`, bei Problemen automatisch `fbdev` |
| `api_port` | `8099` | Lokale Steuerung, `0` = aus |
| `debug` | `false` | Ausführliches Log |

Tipp: Wer Kopfzeile und Seitenleiste ausblenden möchte, kann die
HACS-Erweiterung *kiosk-mode* nutzen und `?kiosk` an das Dashboard hängen,
z. B. `dashboard-kiosk/start?kiosk`.

## Bildschirm aus Home Assistant steuern

Die App bietet eine kleine Schnittstelle, die nur auf dem Gerät selbst
erreichbar ist (`127.0.0.1`). Home Assistant kann damit den Bildschirm z. B.
bei Bewegung oder Klingeln einschalten.

| Aufruf | Wirkung |
|---|---|
| `/screen/on` | einschalten bzw. Standby-Zeit neu starten |
| `/screen/off` | sofort in den Standby |
| `/screen/toggle` | umschalten |
| `/status` | `{"screen": "on", "idle_seconds": 12, "timeout": 180}` |

In `configuration.yaml`:

```yaml
rest_command:
  kiosk_bildschirm_an:
    url: http://127.0.0.1:8099/screen/on
    method: post
  kiosk_bildschirm_aus:
    url: http://127.0.0.1:8099/screen/off
    method: post

sensor:
  - platform: rest
    name: Kiosk Bildschirm
    resource: http://127.0.0.1:8099/status
    value_template: "{{ value_json.screen }}"
    scan_interval: 30
```

Beispiel-Automation „Bildschirm an bei Bewegung“:

```yaml
alias: Kiosk bei Bewegung einschalten
triggers:
  - trigger: state
    entity_id: binary_sensor.DEIN_BEWEGUNGSMELDER
    to: "on"
actions:
  - action: rest_command.kiosk_bildschirm_an
```

## Raspberry Pi 4: Fehlersuche

- **Schwarzes Bild / „no screens found“ / „No modes“:** Der Pi bekommt vom
  Monitor keine Auflösung (EDID). In der Datei `cmdline.txt` auf der
  Boot-Partition am Ende der Zeile ergänzen (Auflösung anpassen):
  `video=HDMI-A-1:1920x1080@60D` – danach neu starten. Das Log zeigt beim
  Start, welche Anschlüsse erkannt wurden.
- **`drmSetMaster failed: Resource busy`:** Eine andere App (oder ein
  zweiter Kiosk) belegt den Bildschirm → diese stoppen und die App neu starten.
  Hilft das nicht, `video_driver: fbdev` probieren.
- **Touch reagiert nicht:** Im Log stehen beim Start alle Eingabegeräte und
  ob ein Touch-Gerät gefunden wurde. USB-Kabel des Monitors prüfen; nach dem
  Einstecken die App neu starten.
- **Touch trifft daneben (gedrehter Monitor):** `rotation` setzen – Bild und
  Touch werden gemeinsam gedreht.
- **Monitor geht nicht in Standby:** Manche Monitore zeigen bei fehlendem
  Signal nur „Kein Signal“ und bleiben an – dann im Menü des Monitors den
  Energiesparmodus / Auto-Standby einschalten.
- Mit `debug: true` landen alle Meldungen von Xorg und Chromium im Log.
