# Generated Textures v1

> Hinweis: Die Bodenkacheln unter `game-ready/terrain` wurden nachtraeglich
> gemittelt und gespiegelt. Sie sind durch den nativen Pixel-Satz unter
> `art/generated-textures-v2/terrain` ersetzt und sollten nicht integriert
> werden. Gebaeude, Schiffe und Warensymbole aus v1 bleiben gueltig.

Dieser Satz wurde mit dem eingebauten OpenAI-ImageGen-Modell als einzelne
Bilddateien erzeugt. Es wurden keine Atlas- oder Uebersichtsblaetter als Quelle
verwendet.

## Inhalt

- 32 Gebaeude: Hafen, Steinbruch, Bergwerk, Fischerhuette, Muehle und
  Baeckerei sowie die neuen Vorstufen Umschlagplatz und Kleiner Hafen
- Umschlagplatz: vier Gestaltungsvarianten unter `buildings/depot/`
- Kleiner Hafen: vier Blickrichtungen unter `buildings/small_harbor/`;
  bewusst ohne gemaltes Wasser, Ufer oder Bootshaus
- 24 Schiffe: Handelsschiff, kleines Kriegsschiff und Fischkutter, jeweils
  in acht Blickrichtungen
- 36 Bodentexturen: Wiese, Sand, Wasser, Waldboden, Fels und Erdboden,
  jeweils sechs Varianten
- 8 Warensymbole: Fisch, Brot, Mehl, Getreide, Kohle, Eisenbarren, Werkzeug
  und Fleisch

Die hochaufgeloesten ImageGen-Quellen liegen in den Kategorieordnern. Die
kompakten Fassungen unter `game-ready/` wurden aus diesen Quellen erzeugt:

- Gebaeude: 192 x 192 Pixel, transparent
- Schiffe: 128 x 128 Pixel, transparent
- Warensymbole: 32 x 32 Pixel, transparent
- Bodentexturen: 32 x 32 Pixel, deckend und an allen vier Kanten pixelgenau
  nahtlos

## Prompt-Regeln

Gemeinsamer Stil: warmes, handgemaltes Pixel-Art fuer ein mittelalterliches
Aufbauspiel, orthografische Spielansicht, klare Silhouette und lesbare Details.

Gebaeude und Symbole wurden mit diesen verbindlichen Ausschluessen erzeugt:
ein einzelnes Motiv auf Magenta, keine Beschriftung, kein Rahmen, kein Raster,
kein Atlas und kein Uebersichtsblatt. Die Magenta-Quellen werden erst bei der
Aufbereitung freigestellt. Bei Schiffen und dem kleinen Hafen wurde zusaetzlich
dieselbe Konstruktion fuer alle Blickrichtungen verlangt.

Fuer jede Bodentextur wurde ein einzelnes, vollflaechiges Quadrat ohne Objekte,
Rahmen oder Text verlangt, dessen Details ueber gegenueberliegende Kanten
fortlaufen. Die Aufbereitung in `tools/prepare-generated-textures.mjs` erzwingt
zusaetzlich mathematisch identische Gegenkanten und laesst die Quellen
unveraendert.

## Erneute Aufbereitung

```sh
node tools/prepare-generated-textures.mjs
```
