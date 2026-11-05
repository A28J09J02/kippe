# Tiltrap auf Cloudflare (kostenlos)

Die Spielseite läuft auf **Cloudflare Pages** (`https://tiltrap.pages.dev`), der Spielserver für Profile, Freunde, Rangliste und Online-Duelle als **Cloudflare Worker** mit Durable Objects. Beides im **Gratis-Tarif (Workers Free)**.

## Kosten
- Gratis-Tarif, **keine Kreditkarte nötig**. Ohne hinterlegte Zahlungsart kann Cloudflare nichts abbuchen.
- Wird ein Tageslimit erreicht, liefert der Server bis Mitternacht (UTC) Fehler, es entstehen **keine Kosten**. Das Spiel gegen Bot, Rätsel und Tutorial laufen weiter, weil sie keinen Server brauchen.
- Statische Dateien (die Spielseite selbst) sind bei Cloudflare Pages unbegrenzt und kostenlos.
- Tageslimits Workers Free: 100.000 Anfragen, 13.000 GB-s Laufzeit, 5 Mio. gelesene und 100.000 geschriebene Datenbankzeilen, 5 GB Speicher. Eine Verbindung zählt als Anfrage, eingehende Nachrichten im Verhältnis 20:1. Grob: ein Spieler verbraucht pro Online-Duell etwa 3–6 Anfragen, also reicht es für viele tausend Duelle am Tag.
- **Nie** in Cloudflare auf „Workers Paid“ upgraden und keine Zahlungsart hinterlegen, dann bleibt es kostenlos.

## Sicherheit und Daten
- Gespeichert werden nur Spielername mit Nummer (z. B. `Jonas#4821`), Freundesliste, Kopf-an-Kopf-Bilanzen und Statistik (Siege, Niederlagen, Elo). Keine E-Mail, kein Passwort, kein Standort.
- Das Gerät bekommt beim Anlegen einen zufälligen geheimen Schlüssel; der Server speichert nur dessen SHA-256-Prüfsumme.
- Jedes Profil lässt sich im Spiel komplett löschen („Datenschutz & Konto“).
- Der Spielserver hat keine eigene öffentliche Adresse (`workers_dev = false`), er ist nur über die Spielseite unter `/api` erreichbar.
- Jeder Zug wird auf dem Server mit denselben Spielregeln nachgerechnet; nur der Server trägt Ergebnisse in die Rangliste ein. Plätze in einem Duell sind an geheime Schlüssel gebunden, die nur die beiden Spieler bekommen.
- Schutz vor Missbrauch: höchstens 8 neue Profile pro Stunde und IP, Nachrichtenlimit pro Verbindung, Größenlimits, Namensprüfung.
- Sicherheits-Header auf der Seite (Content-Security-Policy, kein Einbetten in fremde Seiten, HSTS), siehe `pages/_headers`.

## Einmalige Einrichtung (ca. 10 Minuten)
1. **Konto anlegen:** https://dash.cloudflare.com/sign-up → E-Mail und Passwort, E-Mail bestätigen. Keinen kostenpflichtigen Tarif wählen.
2. **Account-ID kopieren:** Im Dashboard links **Workers & Pages** öffnen. Rechts steht die **Account ID** → kopieren.
3. **API-Token erstellen:** Oben rechts Profil → **My Profile** → **API Tokens** → **Create Token** → **Create Custom Token**:
   - Name: `tiltrap-github`
   - Permissions: `Account` · `Workers Scripts` · `Edit` und `Account` · `Cloudflare Pages` · `Edit`
   - Account Resources: `Include` · dein Konto
   - **Continue to summary** → **Create Token** → Token kopieren (wird nur einmal angezeigt).
4. **In GitHub hinterlegen:** Repo `A28J09J02/kippe` → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**:
   - `CLOUDFLARE_API_TOKEN` = der Token aus Schritt 3
   - `CLOUDFLARE_ACCOUNT_ID` = die ID aus Schritt 2
5. **Veröffentlichen:** Repo → **Actions** → **Deploy to Cloudflare** → **Run workflow**. Nach 1–2 Minuten ist das Spiel unter `https://tiltrap.pages.dev` erreichbar. Ab dann wird jede Änderung auf `main` automatisch veröffentlicht.

Den Token nie in den Chat oder in Dateien kopieren, nur in die GitHub-Secrets.

Ist `tiltrap.pages.dev` schon vergeben, hängt Cloudflare automatisch etwas an (z. B. `tiltrap-4xk.pages.dev`); die genaue Adresse steht im Log des Workflows und im Cloudflare-Dashboard unter **Workers & Pages → tiltrap**. Eine eigene Domain (z. B. `tiltrap.de`) kostet beim Registrar etwa 5–15 € im Jahr und lässt sich später unter **Custom domains** verbinden.

## Lokal entwickeln
```
cd server && npm install
node ../tools/build.js           # Spielregeln für den Server + Seite nach pages/dist
npx wrangler dev                  # Server auf http://127.0.0.1:8787
node test/api.test.mjs            # Integrationstest gegen den lokalen Server
cd ../pages && ../server/node_modules/.bin/wrangler pages dev   # Seite + Server auf http://127.0.0.1:8788
```
Alternativ die Seite mit irgendeinem lokalen Webserver öffnen und im Browser `localStorage.setItem("tiltrap-api","http://127.0.0.1:8787/api")` setzen.

## Aufbau
- `server/src/index.js` – Worker und zwei Durable Objects:
  - **Lobby** (eine Instanz, SQLite): Profile, Freunde, Bilanzen, Elo, Gegnersuche, Herausforderungen
  - **Match** (eine pro Duell): Raum im bisherigen Format (Spieler + Zugliste), prüft jeden Eintrag, Schachuhr auf dem Server, Aufgabe nach 90 s offline in der Rangliste, meldet Ergebnisse an die Lobby, löscht sich nach 24 h Ruhe
- `server/src/logic.js` – wird von `tools/build.js` aus `index.html` erzeugt (dieselben Regeln wie im Spiel)
- `pages/` – Cloudflare-Pages-Projekt: `functions/api/[[path]].js` reicht `/api` an den Worker weiter, `_headers` setzt die Sicherheits-Header
- `.github/workflows/deploy-cloudflare.yml` – baut und veröffentlicht beides bei jedem Push

## Rangliste
- Elo, Start 1000, K = 32. Gegnersuche nach Elo-Nähe, der erlaubte Abstand wächst mit der Wartezeit.
- Ranglistenduell: Standardbrett, 5 Minuten Bedenkzeit pro Runde, Best of 3. Danach eine Revanche, dann „Neuer Gegner“.
- Wer ein Ranglistenduell verlässt oder 90 Sekunden offline ist, verliert es.
- Freundschaftsduelle zählen nicht für Elo, aber für die Siegesrate und die Bilanz gegeneinander.
