# Online-Duelle – Plan

## Grundidee
Die Spiellogik ist deterministisch: Aus Startkarte, Startspieler und Zugliste lässt sich jede Partie exakt nachspielen. Online müssen deshalb nur die Züge übertragen werden, ein paar Bytes pro Zug.

Zug-Format:
```json
{"t":"tilt","dir":"left"}
{"t":"build","r":3,"c":4,"kind":"H"}
```

## Phase A: Einladungslink (kostenlos)
- Hosting: GitHub Pages aus diesem Repo.
- Synchronisation: Firebase Realtime Database, Gratis-Tarif (Spark): 100 gleichzeitige Verbindungen, 1 GB Speicher, ca. 10 GB Download pro Monat.
- Ablauf: Spieler 1 erstellt ein Duell, bekommt einen Link `…/#r-ABCD12`. Spieler 2 öffnet ihn, beide geben nur einen Namen ein.
- Datenbank pro Raum:
  ```
  rooms/ABCD12/
    created, map, starter
    players/{0,1}: {name, online}
    moves: [ {t, dir|r,c,kind, by, at}, … ]
  ```
- Beide Geräte hängen neue Züge an `moves` an und spielen sie mit derselben Logik nach. Ein Zug wird nur angehängt, wenn er nach der eigenen Logik erlaubt ist und der Spieler am Zug ist.
- Zugzeit 15 s, zweimal überschritten = Runde verloren.

### Was dafür von Jonas gebraucht wird
1. Unter console.firebase.google.com ein Projekt anlegen (Google-Konto, kostenlos).
2. Realtime Database aktivieren (Region europe-west1).
3. Web-App registrieren und die `firebaseConfig` (apiKey, databaseURL, projectId …) hier ins Repo legen. Diese Werte sind nicht geheim, Schutz läuft über die Datenbank-Regeln.

## Phase B: Gegnersuche und eigener Server
- Kleiner Node-Server mit WebSocket, prüft jeden Zug mit derselben Logik (gegen Schummeln), Warteschlange und Elo-Wertung.
- Kosten: kleinster Hetzner-Cloud-Server um 6–7 €/Monat (Preis vor Bestellung prüfen). Alternativen: Firebase Blaze oder Cloudflare Durable Objects.
- Lohnt sich erst, wenn regelmäßig genug Leute gleichzeitig spielen.
