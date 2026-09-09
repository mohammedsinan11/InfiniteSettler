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

### Gebäude — als sauberer Ersatzsatz neu zeichnen

11. **Wohnhaus** — vier gleich große 2×2-Gebäudevarianten; keine
    Beschriftung, kein Rahmen, keine mitgemalte Bodenkachel. Der aktuelle
    Laufzeitsatz verwendet vier brauchbare v0.1-Motive als Übergang, weil die
    vorherigen v0.2-Dateien beschriftete Atlas-Spalten waren.
12. **Getreidefeld/Bauernhof** — vier Varianten als klare Wachstumsreihe:
    vorbereitetes Feld, junge Saat, wachsendes Getreide, erntereifes Feld.
    Das Feld muss in allen Bildern dieselbe Grundfläche behalten; keine Mühle
    als Farmvariante. Aktuell ist nur eine saubere Übergangsgrafik aktiv.

#### Erledigt: Umschlagplatz und kleiner Hafen

Beide sind geliefert (`art/generated-textures-v1/buildings/depot` und
`.../small_harbor`) und seit `prepare-magenta-sprites.mjs` im Spiel. Der
kleine Hafen kam gleich in **vier Blickrichtungen und ohne gemaltes
Wasser** — genau richtig, und dadurch der erste Bau, dessen Steg auch nach
Norden zeigen kann.

Eine Kleinigkeit fürs nächste Mal: beim Umschlagplatz schimmerte das
Magenta zwischen Dach und Pfosten durch. Das Freistellskript fängt das ab,
aber sauberer wäre, den Hintergrund auch in eingeschlossenen Flächen in
exakt derselben Farbe zu halten.

#### Häfen — vier Blickrichtungen statt vier Varianten

Bei den vorhandenen Hafensprites sind **Steg, Boot und ein Stück Wasser
fest ins Bild gemalt**, und zwar vorne links. Spiegeln deckt damit Wasser
im Osten ab, ungespiegelt Wasser im Westen und Süden — für Wasser im
**Norden** gibt es keine Darstellung, denn Drehen stellt das Dach auf den
Kopf. An einer Nordküste liegt deshalb ein Stück gemaltes Wasser auf der
Wiese.

Gebraucht wird der Hafen deshalb wie die Schiffe in **vier
Blickrichtungen** (Steg nach oben, unten, links, rechts) statt in vier
Gestaltungsvarianten. Und wichtiger noch:

> **Kein Wasser im Sprite.** Nur Gebäude, Steg und Poller auf
> transparentem Grund. Das Wasser kommt aus der Karte — gemaltes Wasser im
> Bild passt nie zur tatsächlichen Uferlinie.

Der kleine Hafen ist genau so geliefert worden und funktioniert — der
**große** Hafen fehlt noch in dieser Form.

#### Vorstufen — neu, mit Priorität

Diese beiden sind gerade ins Spiel gekommen und benutzen behelfsweise das
verkleinerte Bild ihrer Ausbaustufe. Sie sollen als **einfachere, ärmere
Vorstufe** desselben Gebäudes erkennbar sein — gleiche Palette, gleicher
Blickwinkel, aber sichtbar bescheidener. Wichtig ist der Kontrast zum
großen Gegenstück, nicht die Detailfülle.

7. **Umschlagplatz** — Vorstufe des Lagers, kostet nur Holz: offener
   Bretterunterstand mit Pultdach statt eines festen Hauses, ein paar
   Kisten und Säcke darunter, Handkarre daneben, kein Mauerwerk
8. **Kleiner Hafen** — Vorstufe des Hafens, kostet nur Holz: schmaler
   Holzsteg auf Pfählen, ein einzelner Poller, gestapelte Reusen und
   Netze, kein Bootshaus und kein Kran

### Schiffe — fehlen komplett

Wichtig: Schiffe brauchen **vier Blickrichtungen** (nach oben, unten,
links, rechts), nicht vier Gestaltungsvarianten.

9. **Handelsschiff** — bauchige Kogge mit einem Segel, Frachtkisten an Deck
10. **Kleines Kriegsschiff** — schlanker, Schilde am Rumpf, Segel gerefft

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

**Technisch geliefert mit `art/generated-textures-v2/`, aber visuell noch
nicht final.** Gemessen (mittlere
Farbdifferenz über die Kachelnaht im Verhältnis zu einem normalen
Nachbarschritt innerhalb der Kachel, 1.0 = unsichtbar):

| | bisher | v2 |
|---|---|---|
| Wiese | 1.47 | 0.87 |
| Sand | 1.84 | 0.86 |
| Wasser | 4.89 | 0.89 |
| Erdboden | 1.84 | 0.90 |
| Waldboden | 1.25 | 0.92 |

Die v2-Kacheln sind einzeln mit sich selbst nahtlos. Im Spiel zeigte sich
jedoch, dass sechs Varianten untereinander keine kompatiblen Randpixel haben;
zufälliges Mischen und Drehen machte deshalb erneut ein Kachelraster sichtbar.
Der Renderer verwendet bis zu einem echten Kanten-/Wang-Satz pro Bodenart nur
eine unveränderte Referenzkachel. Außerdem war das frühere 32→12-Downsampling
mit Glättung sichtbar verwaschen; es läuft jetzt pixelgenau über 16 Pixel.

Drei Punkte für den nächsten Satz:

1. **Varianten müssen denselben Grundton haben.** Geliefert unterschieden
   sie sich nicht nur in der Körnung, sondern im Farbton — beim Sand lagen
   zwischen der hellsten und der dunkelsten Variante 66 Helligkeitsstufen,
   beim Wasser 90. Nebeneinander gelegt ergibt das einen Flickenteppich
   statt einer Fläche. Das Skript zieht die Kacheln jetzt auf einen
   gemeinsamen Mittelwert, aber im Prompt gehört der Satz dazu: *alle
   Varianten einer Kategorie in exakt derselben Grundfarbe, es unterscheidet
   sich nur die Anordnung der Körnung*.
2. **Ausgabe in nativer Größe.** Die PNGs kommen mit 1254 x 1254, obwohl
   der Inhalt ein logisches 32er-Raster ist. Unschädlich (das Skript rechnet
   es exakt zurück), aber unnötig groß.
3. **Varianten müssen auch untereinander kantenkompatibel sein.** „Jede Datei
   ist mit sich selbst nahtlos“ reicht für zufällige Nachbarschaften nicht.
   Entweder alle Varianten teilen dieselben vier Randpixelreihen, oder sie
   werden als gerichteter Wang-Tile-Satz mit dokumentierten Kanten geliefert.

### Warensymbole

Kleine freistehende Symbole, je 1 Bild: **Fisch, Brot, Mehl, Getreide,
Kohle, Eisenbarren, Werkzeug, Fleisch**.

## Was schon da ist — nicht nochmal erzeugen

Aus dem v0.2-/v0.1-Bestand vorerst brauchbar: Holzfällerhütte, Sägewerk,
Lagerhaus und Eiche; Arbeiter, Holzfäller, Bauer und
**Soldat** (je 8 Bilder); Kuh, Schaf, Pferd, Huhn; Holz, Stein, Eisen,
Getreide, Beeren; Brücken; Klippen und Uferkanten; 21 Dekorationen.

Wichtig: Die vorhandenen Kiefernfragmente und frei gedrehten Kliff-Vollkacheln
sind aus dem aktiven Laufzeitsatz entfernt. Kliffs bleiben als
Kompositionsreferenz nützlich, sind aber keine spielfertigen Richtungsassets.
