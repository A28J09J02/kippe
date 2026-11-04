# Online-Duelle

## So funktioniert es
1. Spieler 1 wählt im Menü **Online gegen Freunde**, gibt seinen Namen ein und tippt **Duell erstellen**.
2. Er bekommt einen Link wie `https://a28j09j02.github.io/kippe/#r-K7QM2P` und schickt ihn (Teilen-Knopf oder kopieren).
3. Spieler 2 öffnet den Link, gibt seinen Namen ein und tippt **Beitreten**. Das Spiel startet sofort auf beiden Geräten.
4. Der Eingeladene (Blau) fängt an, danach beginnt immer der Verlierer der Runde. Best of 3, danach Revanche.

Wer die Seite neu lädt oder die App kurz schließt, landet über denselben Link wieder im Spiel: Der Spielstand wird aus der Zugliste nachgespielt.

## Technik
- Firebase Realtime Database, direkt über REST und Streaming (EventSource), ohne Firebase-SDK.
- Die Spiellogik ist deterministisch, deshalb speichert ein Raum nur Spieler und eine Zugliste:
  ```
  rooms/K7QM2P/
    v, created, field            ("std" oder "pool")
    players/p0, players/p1       {name, seen}
    log/m0000, log/m0001, …      {k:"m", t:"tilt", dir, by} | {k:"m", t:"build", r, c, kind, by} | {k:"next", map?} | {k:"rematch"}
  ```
- Nur wer am Zug ist, schreibt den nächsten Eintrag. Beide Geräte prüfen jeden Zug mit derselben Logik und spielen ihn mit Animation nach.
- Anwesenheit: Jedes Gerät meldet sich alle 15 s, nach 40 s Funkstille erscheint „offline“.
- Sicherheitsregeln: `docs/database.rules.json` (Räume nur über ihren Code erreichbar, Züge können nicht überschrieben werden).
- Lokaler Test ohne Firebase: im Browser `localStorage.setItem("kippe-db","http://localhost:8766")` und einen Nachbau des Firebase-REST-Endpunkts starten.

## Einrichtung (einmalig)
1. console.firebase.google.com → **Projekt hinzufügen** (z. B. „kippe“), Google Analytics kann aus bleiben.
2. Im Projekt: **Build → Realtime Database → Datenbank erstellen**, Standort **Belgien (europe-west1)**, im **gesperrten Modus** starten.
3. Tab **Regeln**: Inhalt von `docs/database.rules.json` einfügen → **Veröffentlichen**.
4. Die Datenbank-Adresse oben auf der Seite (z. B. `https://kippe-xxxx-default-rtdb.europe-west1.firebasedatabase.app`) in `index.html` bei `KIPPE_CONFIG.dbUrl` eintragen.

Kosten: Gratis-Tarif (Spark): 100 gleichzeitige Verbindungen (rund 50 Duelle gleichzeitig), 1 GB Speicher, 10 GB Download pro Monat. Ein Zug sind ein paar Bytes.

## Später
- Zugzeit (z. B. 15 s pro Zug), zweimal überschritten = Runde verloren
- Alte Räume automatisch löschen (z. B. per geplanter Funktion oder beim Erstellen eines neuen Raums)
- Gegnersuche mit eigenem Server (Node + WebSocket, Zugprüfung, Elo), sobald genug Leute spielen
