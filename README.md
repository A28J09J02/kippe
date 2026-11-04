# Kippe

1-gegen-1-Strategiespiel fürs Handy: Zwei Kugeln, ein kippbares Brett. Wer am Zug ist, kippt das Brett oder baut einen Stein oder ein Loch. Ziel: die gegnerische Kugel in ein Loch oder über die Kante befördern, ohne selbst zu fallen.

## Spielen
**https://a28j09j02.github.io/kippe/** (GitHub Pages aus `main`, installierbar als App). Lokal: `index.html` im Browser öffnen. Im Menü wählen:
- **Zu zweit** an einem Handy
- **Gegen den Bot** in drei Stufen (Leicht, Mittel, Schwer), als Rot, Blau oder per Zufall
- **Online gegen Freunde** per Einladungslink (siehe `docs/ONLINE.md`)

Spielfeld: **Standard** (immer dieselbe Aufstellung, wie beim Schach) oder **Wechselnde Karten** (4 Karten, der Verlierer wählt die nächste).

## Als App installieren
Kippe ist eine Web-App (PWA): dieselbe Seite läuft im Browser und lässt sich als App installieren, mit eigenem Icon, im Vollbild und offline gegen den Bot.
- **iPhone/iPad:** Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“
- **Android:** Seite in Chrome öffnen → „App installieren“ (auch als Knopf im Menü)
- **Windows/Mac:** Seite in Chrome oder Edge öffnen → Installieren-Symbol in der Adressleiste oder Knopf im Menü

Nach einem Update `VERSION` in `sw.js` hochzählen, damit installierte Apps die neuen Dateien laden.

## Regeln in Kürze
- Pro Zug genau eins: **kippen** (beide Kugeln rollen bis zum Hindernis), **schubsen** (nur die eigene Kugel ein Feld; gegen einen hellen Stein = ein Treffer) oder **bauen**.
- Jeder hat pro Runde 3 Steine und 3 Löcher. Man muss nie kippen.
- Kippen geht in jede Richtung, auch zurück.
- Randsteine und gesetzte Steine halten 3 Treffer. Ein zerbrochener Randstein wird zum Abgrund.
- Ab Zug 20 bricht alle 2 Züge ein rot markiertes Stück weg: erst die 28 Randsteine, dann der Boden Ring für Ring von außen. Wer auf einem einstürzenden Feld steht, fällt. Damit endet jede Runde, ein Zuglimit gibt es nicht.
- Bedenkzeit pro Runde wählbar: ohne, 1, 5 oder 10 Minuten (Schachuhr). Läuft die Uhr ab, ist die Runde verloren. Der Bot hat keine Uhr.
- Best of 3, wer eine Runde verliert, fängt die nächste an.

## Spielfelder
- **Standard:** immer dieselbe Aufstellung, wie beim Schach.
- **4 Karten:** Kreuzung, Schleuse, Zickzack, Abbruch. Der Verlierer wählt die nächste oder lässt den Zufall entscheiden.
- **Zufallskarte:** jede Runde eine neu gebaute, punktsymmetrische Karte (aus einer Zahl erzeugt, online für beide gleich).

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
- `manifest.webmanifest`, `sw.js`, `icons/` – App-Installation und Offline-Betrieb (`tools/make-icons.py` zeichnet die Icons)
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
| Leicht | 1 Halbzug | übersieht gut die Hälfte der Siege, spielt jeden zweiten Zug unachtsam, wählt locker unter brauchbaren Zügen |
| Mittel | 2 Halbzüge | sieht die meisten Fallen, übersieht ab und zu einen Sieg, gelegentlich unachtsam |
| Schwer | bis 6 Halbzüge, ca. 1,4 s | spielt einen der besten gefundenen Züge |

Abwechslung: Der Bot wählt zufällig (gewichtet) unter allen Zügen, die fast so gut sind wie der beste. In den ersten Zügen ist die Auswahl größer, damit Runden unterschiedlich beginnen. Zusätzlich bekommt er pro Runde einen Spielstil: Fallensteller (baut lieber Löcher), Mauerer (lieber Steine) oder Roller (kippt lieber). Der Stil beeinflusst nur die Auswahl unter guten Zügen, nie das Erkennen von Gefahr.
