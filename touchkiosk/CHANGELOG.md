# Changelog

## 1.1.0

- Bildschirmtastatur (QWERTZ mit Umlauten oder QWERTY): erscheint automatisch,
  sobald ein Textfeld angetippt wird – auch auf der Anmeldeseite und in Dialogen
- Taste „⌨ ▾“ blendet die Tastatur aus, erneutes Antippen des Feldes holt sie zurück
- Enter sendet Formulare ab bzw. übernimmt Werte (z. B. Text-Helfer)
- Browsersprache folgt dem Tastaturlayout (Deutsch bzw. Englisch)

## 1.0.0

- Erste Version: Dashboard im Vollbild auf einem Touch-Monitor (Chromium-Kiosk)
- Standby per DPMS nach einstellbarer Zeit ohne Berührung (Standard: 3 Minuten)
- Aufweck-Berührung wird nicht an das Dashboard weitergegeben
- Automatische Anmeldung per langlebigem Zugriffstoken
- Lokale API (127.0.0.1) zum Ein-/Ausschalten aus Home Assistant
- Raspberry Pi 4: automatische Wahl von Grafikkarte und HDMI-Anschluss,
  glamor deaktiviert, Ersatztreiber fbdev
