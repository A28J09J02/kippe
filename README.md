# Kippe

1-gegen-1-Strategiespiel fürs Handy: Zwei Kugeln, ein kippbares Brett mit Löchern und Wänden. Wer am Zug ist, kippt das Brett oder baut. Ziel: die gegnerische Kugel in ein Loch oder über eine offene Kante befördern.

## Stand
v2 lokal (zwei Spieler an einem Gerät):
- Kippen per Wischen, Pfeilknöpfen oder Pfeiltasten, mit Vorschau und Bestätigung
- 3 Bauaktionen pro Runde: Stein oder Loch
- Bröckelwände und Steine halten 3 Treffer, Randsegmente können zum Abgrund werden
- Anti-Einbunker-Regeln, schrumpfende Arena ab Zug 24
- Best of 3, Verlierer wählt Karte und Startspieler
- 4 Karten: Kreuzung, Schleuse, Zickzack, Abbruch

## Aufbau
- `index.html` – das komplette Spiel. Die Spiellogik steht als reine Funktionen zwischen `LOGIC START` und `LOGIC END`.
- `tools/check-maps.js` – prüft alle Karten auf Punktsymmetrie, Sofort-Fall beim ersten Kippen und erzwungenen Sieg des Startspielers in 4 Halbzügen. Dazu Zufallspartien als Plausibilitätstest.

```
node tools/check-maps.js
```

## Starten
`index.html` im Browser öffnen. Später über GitHub Pages.
