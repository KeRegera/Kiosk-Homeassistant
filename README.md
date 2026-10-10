# HASSOS Apps

Eigene Apps (Add-ons) für Home Assistant OS.

| App | Beschreibung |
|---|---|
| [Touch Kiosk](touchkiosk/) | Dashboard im Vollbild auf einem Touch-Monitor, Standby nach Inaktivität |

## In Home Assistant hinzufügen

1. Einstellungen → Apps (früher „Add-ons“) → App-Store
2. Menü ⋮ oben rechts → **Repositories**
3. Diese Adresse eintragen und hinzufügen:
   `https://github.com/DEIN-GITHUB-NAME/hassos-apps`
4. Seite neu laden, „Touch Kiosk“ auswählen → **Installieren**

Die App wird beim Installieren direkt auf dem Gerät gebaut. Auf einem
Raspberry Pi 4 dauert das je nach Internetverbindung etwa 5–15 Minuten.

## Updates

Änderungen auf GitHub hochladen und in `touchkiosk/config.yaml` die `version`
erhöhen (z. B. `1.0.1`). Home Assistant bietet das Update dann automatisch an.
