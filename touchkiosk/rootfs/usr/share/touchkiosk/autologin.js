// Touch Kiosk – automatische Anmeldung mit einem langlebigen Zugriffstoken.
//
// Läuft als Content-Script vor dem Home-Assistant-Frontend (document_start)
// und legt das Token dort ab, wo das Frontend seine Anmeldedaten sucht
// (localStorage "hassTokens"). Die Konfiguration (Origin + Token) hängt
// touchkiosk-run beim Start als Aufruf von touchKioskAutoLogin() an.

function touchKioskAutoLogin(config) {
  if (location.origin !== config.origin) {
    return;
  }

  try {
    const raw = window.localStorage.getItem("hassTokens");
    const stored = raw ? JSON.parse(raw) : null;

    // Jemand hat sich am Kiosk von Hand angemeldet -> diese Sitzung behalten.
    if (stored && stored.refresh_token) {
      return;
    }
    // Token ist bereits hinterlegt.
    if (stored && stored.access_token === config.token) {
      return;
    }

    window.localStorage.setItem(
      "hassTokens",
      JSON.stringify({
        hassUrl: location.origin,
        clientId: location.origin + "/",
        access_token: config.token,
        token_type: "Bearer",
        expires_in: 315360000,
        // Langlebige Tokens müssen nie erneuert werden
        expires: 4102444800000,
        refresh_token: "",
      }),
    );
  } catch (err) {
    console.error("Touch Kiosk Auto-Login fehlgeschlagen:", err);
  }
}
