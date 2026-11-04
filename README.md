# Kippe

1-gegen-1-Strategiespiel fürs Handy: Zwei Kugeln, ein kippbares Brett. Wer am Zug ist, kippt das Brett oder baut einen Stein oder ein Loch. Ziel: die gegnerische Kugel in ein Loch oder über die Kante befördern, ohne selbst zu fallen.

## Spielen
`index.html` im Browser öffnen. Im Menü wählen:
- **Zu zweit** an einem Handy
- **Gegen den Bot** in drei Stufen (Leicht, Mittel, Schwer), mit Rot oder Blau
- **Online** kommt später (siehe `docs/ONLINE.md`)

Spielfeld: **Standard** (immer dieselbe Aufstellung, wie beim Schach) oder **Wechselnde Karten** (4 Karten, der Verlierer wählt die nächste).

## Regeln in Kürze
- Pro Zug genau eins: kippen oder bauen. Kippen bewegt beide Kugeln.
- 3 Bauaktionen pro Runde, danach muss man erst wieder kippen, bevor man erneut baut.
- Randsteine und gesetzte Steine halten 3 Treffer. Ein zerbrochener Randstein wird zum Abgrund.
- Ab Zug 20 bricht alle 2 Züge ein Randstein weg (vorher rot markiert).
- Best of 3, wer eine Runde verliert, fängt die nächste an.

## Standardbrett
7×7, fast leer: ein Loch in der Mitte, zwei feste Blöcke diagonal, ringsum bröckelnde Randsteine, nur die Ecken sind fest. Rot startet unten links, Blau oben rechts. Ausgewählt aus drei Kandidaten per Bot-gegen-Bot-Test: die meisten Runden enden durch eine gestellte Falle („Reingelegt“), Startvorteil im Test rund 40 %.

## Aufbau
- `index.html` – das komplette Spiel in einer Datei:
  - `<script id="logic-src">` Spielregeln als reine Funktionen (`LOGIC START` … `LOGIC END`)
  - `<script id="bot-src">` Bot: Minimax mit Alpha-Beta und Iterative Deepening, läuft im Web Worker (`BOT START` … `BOT END`)
  - danach Darstellung (Canvas), Ton, Menü und Bedienung
- `tools/check-maps.js` – Fairness-Prüfung aller Karten (Symmetrie, kein Sofort-Fall, kein erzwungener Sieg in 4 Halbzügen)
- `tools/bot-arena.js` – Bot gegen Bot, z. B. `node tools/bot-arena.js hard hard 20`
- `tools/artifact.py` – erzeugt `dist/artifact.html` (ohne Dokument-Hülle) für die Claude-Vorschau
- `docs/ONLINE.md` – Plan für Online-Duelle

## Tests
```
node tools/check-maps.js
node tools/bot-arena.js hard hard 20 400
node tools/bot-arena.js medium hard 20 400
```

## Bot-Stufen
| Stufe | Rechentiefe | Verhalten |
|---|---|---|
| Leicht | 1 Halbzug | übersieht oft Fallen, macht jeden 4. Zug einen lockeren Zug |
| Mittel | 2 Halbzüge | fällt nicht in einfache Fallen, etwas Zufall |
| Schwer | bis 6 Halbzüge, ca. 1,4 s | spielt den besten gefundenen Zug |
