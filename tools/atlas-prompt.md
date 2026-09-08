# Prompt für ein zweites Sprite-Blatt

Zum Weiterleiten an einen Bildgenerator. Die harten Regeln stehen oben,
weil an genau ihnen das erste Blatt gescheitert ist: die Beschriftungen
klebten in den Zellen und landeten mit im Zuschnitt, und das Raster war
unregelmäßig.

Nach Erhalt: Blatt neben `preview/atlas_reference.png` legen und in
`tools/extract-atlas.mjs` einen Eintrag in `CATEGORIES` ergänzen.

---

## Prompt (ab hier kopieren)

Erstelle ein einzelnes Sprite-Sheet als PNG für ein mittelalterliches
Aufbauspiel im Stil von "Die Siedler".

**Harte Anforderungen — bitte strikt einhalten:**

1. **Keinerlei Text im Bild.** Keine Beschriftungen, Überschriften,
   Zeilennamen, Zahlen oder Wasserzeichen. Auch nicht neben oder unter
   den Motiven.
2. **Regelmäßiges Raster.** Alle Zellen exakt gleich groß, gleichmäßige
   Abstände, mindestens 10 Pixel sichtbarer Zwischenraum zwischen zwei
   Zellen. Kein Motiv berührt seinen Zellrand.
3. **Ein Motiv pro Zelle**, und rundherum mindestens **8 Pixel freier
   Rand** innerhalb der Zelle. Das Motiv darf den Zellrand nirgends
   berühren — auch nicht mit Bodenplatte, Zaun, Beiwerk oder Schatten.
   Genau daran krankt das erste Blatt: die Gebäude füllen ihre Zellen
   randlos, weshalb im Spiel Pflasterflächen, Zäune und Wasserläufe
   sichtbar abgeschnitten enden.
4. **Keine überlappenden Objekte** aus Nachbarzellen.
5. **Einfarbiger dunkler Hintergrund**, durchgehend gleich
   (dunkles Blaugrau, etwa #1b2430). Kein Verlauf, kein Muster, keine
   Rahmen oder Kästen um die Zellen.

**Stil:**

- Pixel-Art, leicht schräge Draufsicht (3/4), Gebäude von vorne-oben
  gesehen — **nicht** isometrisch gekippt.
- Licht von oben links, Schatten konsistent nach rechts unten.
- Warme, leicht entsättigte Palette: Holzbraun, Strohgelb, Dachziegelrot,
  Moosgrün, Steingrau.
- Gebäude etwa 96 Pixel breit und 70–95 Pixel hoch, also breiter als hoch.
- Kleine Symbole etwa 32×32 Pixel.

**Zeilen (je 4 Varianten desselben Motivs, sichtbar unterschiedlich):**

1. **Hafen** — Steg ins Wasser, Anleger mit Pollern, kleines Boot,
   gestapelte Kisten und Fässer, Bootshaus mit Schindeldach
2. **Steinbruch** — Abbaugrube mit behauenen Steinblöcken, Holzkran,
   Loren, Steinstaub, Werkzeug an der Wand
3. **Bergwerk** — Stolleneingang im Fels, Holzverbau am Eingang,
   Loren auf Schienen, Erzhaufen
4. **Mühle** — Windmühle mit Flügeln bzw. Wassermühle mit Rad,
   Mehlsäcke davor
5. **Bäckerei** — Fachwerkhaus mit Steinofen und rauchendem Schornstein,
   Brotregal
6. **Fischerhütte** — kleine Hütte am Ufer, Netze zum Trocknen,
   Holzgestelle, Fischkörbe
7. **Baustelle** — Gerüst aus Stangen, gestapelte Bretter, halbfertige
   Mauern; die vier Varianten zeigen zunehmenden Baufortschritt

**Achte Zeile — kleine Warensymbole, je 32×32, freistehend:**
Fisch, Brotlaib, Mehlsack, Getreidegarbe, Kohlebrocken, Eisenbarren,
Werkzeug (Hammer und Zange), Fleischstück.

## Stilreferenzen aus dem vorhandenen Paket

Die neuen Motive sollen dazu passen. Diese Dateien als Vorlage anhängen:

| Datei | Größe | wofür |
| --- | --- | --- |
| `src/assets/medieval/buildings/warehouse/warehouse_01.png` | 96×74 | Gebäudestil, Proportion, Dach |
| `src/assets/medieval/buildings/sawmill/sawmill_02.png` | 96×70 | Gebäude mit Nebenanlage am Wasser |
| `src/assets/medieval/buildings/lumberjack_hut/lumberjack_hut_01.png` | 96×75 | kleines Wirtschaftsgebäude |
| `src/assets/medieval/terrain/dirt_01.png` | 32×32 | Bodenpalette |
| `src/assets/medieval/trees/pine_02.png` | 25×64 | Vegetationsstil |
| `src/assets/medieval/resources/iron_01.png` | 29×32 | Stil der Warensymbole |
| `src/assets/medieval/units/worker_01.png` | 18×32 | Figurenstil und Größenverhältnis |

Alternativ als Gesamtüberblick:
`texture pack/medieval_texture_pack_v0.1/preview/atlas_reference.png`
— aber **ohne** dessen Beschriftungen und Panelrahmen nachzubauen.
