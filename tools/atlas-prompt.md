# Sprite-Aufträge für den Bildgenerator

## Warum der bisherige Prompt nicht funktionieren konnte

Der erste Prompt forderte **ein Blatt mit exaktem Raster**: gleich große
Zellen, mindestens 10 px Abstand, dazu 8 px freier Rand um jedes Motiv und
Zielgrößen in Pixeln.

Das kann ein Bildgenerator nicht liefern. Er malt ein Bild, er setzt kein
Layout — Zellgrößen, Abstände und Ränder werden immer ungefähr. Genau
daran ist v0.1 gescheitert (Beschriftungen im Zuschnitt, wechselnder
Versatz je Kachel), und v0.2 hat es nur nachträglich repariert, indem
jemand am fertigen Bild entlang der sichtbaren Kanten geschnitten hat.

**Die Auflösung: gar kein Raster verlangen.** Ein Motiv pro Bild. Dann
gibt es keine Zellen, keine Abstände, keine Beschriftungen — und mein
Extraktor braucht nur noch Hintergrund entfernen und auf den Inhalt
zuschneiden. Das ist die eine Sache, die Bildgeneratoren zuverlässig
können.

## Verbindliches Lieferformat

**„Ein Motiv pro Bild“ ist wörtlich gemeint:** Für jedes Motiv und jede
Variante beziehungsweise Blickrichtung muss eine eigene PNG-Datei erzeugt
und einzeln ausgeliefert werden. **Keine Übersichtsblätter, Sprite-Sheets,
Collagen oder Kontaktabzüge. Keine Beschriftungen und keine Rahmen.** Es ist
ausdrücklich nicht vorgesehen, mehrere Motive in einem Bild anzuordnen und
dieses anschließend auszuschneiden — genau dieser Arbeitsweg ist bereits
zweimal fehlgeschlagen.

## Regeln für ALLE Aufträge

```
Erstelle EIN Bild mit GENAU EINEM Motiv, freigestellt.

- Nur das eine Objekt, nichts daneben, keine zweite Ansicht, keine Varianten
  im selben Bild.
- Hintergrund einfarbig kräftig Magenta (#FF00FF) — nicht transparent,
  nicht kariert, kein Verlauf. Diese Farbe kommt im Motiv selbst nicht vor
  und lässt sich deshalb sauber entfernen.
- Rundherum etwas Abstand zum Bildrand. Das Motiv darf den Rand nirgends
  berühren, auch nicht mit Schatten, Zaun, Bodenplatte oder Beiwerk.
- KEIN Text, keine Beschriftung, keine Zahlen, kein Rahmen.
- Pixel-Art, leicht schräge Draufsicht (3/4), von vorne-oben gesehen —
  nicht isometrisch gekippt.
- Licht von oben links, Schatten nach rechts unten.
- Warme, leicht entsättigte Palette: Holzbraun, Strohgelb, Dachziegelrot,
  Moosgrün, Steingrau.
- Stil und Farbgebung wie in den angehängten Referenzbildern.
```

Referenzbilder anhängen (aus dem v0.2-Paket):

| Datei | wofür |
| --- | --- |
| `assets/buildings/warehouse/warehouse_01.png` | Gebäudestil, Dach, Proportion |
| `assets/buildings/sawmill/sawmill_01.png` | Gebäude am Wasser |
| `assets/terrain/grass_01.png` | Bodenpalette |
| `assets/trees/pine_01.png` | Vegetationsstil |
| `assets/units/soldier_01.png` | Figurenstil und Größenverhältnis |

## Was gebraucht wird

Je Motiv **4 Varianten**, also vier getrennte Bilder mit demselben Prompt
plus einem Variantenhinweis ("andere Dachfarbe", "andere Anordnung").

### Gebäude — fehlen komplett

1. **Hafen** — Holzsteg ins Wasser, Anleger mit Pollern, Bootshaus,
   gestapelte Kisten und Fässer, Netze
2. **Steinbruch** — Abbaugrube mit behauenen Steinblöcken, Holzkran,
   Loren, Werkzeug
3. **Bergwerk** — Stolleneingang im Fels, Holzverbau, Loren, Erzhaufen
4. **Fischerhütte** — Hütte am Ufer, Netze zum Trocknen, Fischkörbe
5. **Mühle** — Windmühle mit Flügeln, Mehlsäcke davor
6. **Bäckerei** — Fachwerkhaus mit Steinofen und rauchendem Schornstein

### Schiffe — fehlen komplett

Wichtig: Schiffe brauchen **vier Blickrichtungen** (nach oben, unten,
links, rechts), nicht vier Gestaltungsvarianten.

7. **Handelsschiff** — bauchige Kogge mit einem Segel, Frachtkisten an Deck
8. **Kleines Kriegsschiff** — schlanker, Schilde am Rumpf, Segel gerefft

### Bodentexturen (Punkt 6)

Diese als **nahtlos kachelbare Quadrate**, das ist die einzige Ausnahme
von "ein Motiv pro Bild":

```
Erstelle eine NAHTLOS KACHELBARE Bodentextur als Quadrat.
Links und rechts sowie oben und unten müssen ohne sichtbare Naht
aneinanderpassen. Kein Rahmen, kein Schatten am Rand, kein Text.
Gleichmäßige Ausleuchtung ohne Lichtrichtung — sonst entsteht beim
Kacheln ein Muster.
Pixel-Art, Draufsicht, Palette wie im Referenzbild.
```

Gebraucht werden je 6 Varianten von: **Wiese, Sand, Wasser, Waldboden,
Fels, getretener Erdboden**.

Die vorhandenen Bodenkacheln sind nicht nahtlos — deshalb liegen sie im
Spiel nur halbdurchsichtig über einer prozeduralen Grundfarbe. Mit
nahtlosen Kacheln fiele dieser Umweg weg und der Boden würde deutlich
klarer.

### Warensymbole

Kleine freistehende Symbole, je 1 Bild: **Fisch, Brot, Mehl, Getreide,
Kohle, Eisenbarren, Werkzeug, Fleisch**.

## Was schon da ist — nicht nochmal erzeugen

Aus dem v0.2-Paket vorhanden: Wohnhaus, Holzfällerhütte, Sägewerk,
Lagerhaus, Farm; Eiche und Kiefer; Arbeiter, Holzfäller, Bauer und
**Soldat** (je 8 Bilder); Kuh, Schaf, Pferd, Huhn; Holz, Stein, Eisen,
Getreide, Beeren; Brücken; Klippen und Uferkanten; 21 Dekorationen.
