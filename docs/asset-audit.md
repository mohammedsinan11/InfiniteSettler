# InfiniteSettler – visuelle und technische Asset-Inventur

Stand: 2026-09-09. Untersucht wurden alle PNG-Dateien unter
`src/assets/medieval`, `art/generated-textures-v1`,
`art/generated-textures-v2` und `texture pack`. Die Einstufung beruht auf
Dateimaßen, Alpha-Kanälen, exakten MD5-Inhaltsvergleichen, Sichtprüfung und
der tatsächlichen Verwendung durch Manifest und Renderer.

## Direkt nach dem Audit umgesetzt

Der folgende Arbeitsstand ist bereits in der noch nicht eingecheckten
Overhaul-Änderung enthalten:

- Wohnhaus: vier saubere, unbeschriftete v0.1-Motive unter
  `buildings/house/house_clean_01..04.png` aktiviert; die fehlerhaften
  Spalten bleiben nur noch als inaktive Quelle erhalten.
- Getreidefeld: `farm_clean_01.png` als einzige belastbare Übergangsgrafik
  aktiviert; weitere Wachstumsvarianten müssen neu gezeichnet werden.
- Kiefern: vier vollständige `pine_full_01..04.png` mit erkennbarem Stamm
  aktiviert; Fragmente bleiben inaktiv erhalten.
- Kliffs: die ungeeigneten rotierenden Vollkacheln aus dem Manifest genommen,
  aber nicht gelöscht. Sie werden erst durch gerichtete Kanten ersetzt.
- Großer Hafen: die vier wasserhaltigen Varianten aus dem Laufzeitsatz
  genommen. Bis vier neue Richtungsbilder vorliegen, zeichnet der Renderer
  eine wasserfreie Übergangsdarstellung aus Richtungssteg und Umschlagplatz.
- Terrain: internes Raster 12 → 16 Pixel, Pixel-Art-Downsampling ohne
  Glättung, nahtlose Ebene deckend, keine inkompatible Rotation oder Mischung
  der sechs Varianten und schmalere Materialübergänge.
- Küste: Sand greift nur noch in die Wasserseite; Wasser malt nicht mehr in
  den Strand zurück.

Damit sind die sichtbar kaputten Platzhalter aus dem aktiven Satz entfernt.
Der große Hafen und ein neues gerichtetes Kliffsystem bleiben echte
Neuzeichnungsaufgaben. Die Rohdateien werden bis dahin bewusst nicht gelöscht.

## Kurzfazit

Das Problem ist nicht, dass generell schlechte Bilder fehlen oder dass der
Umschlagplatz als einziger ein PNG wäre. Sämtliche derzeitigen Spielgrafiken
sind PNGs. Der sichtbare Qualitätsbruch entsteht aus vier verschiedenen
Asset-Pipelines, sehr unterschiedlichen Zuschnitten und zusätzlicher
Verkleinerung im Renderer:

1. Die aktuellen Wohnhäuser und Getreidefelder sind keine sauber
   freigestellten Sprites, sondern schmale, beschriftete Ausschnitte aus dem
   v0.2-Atlas. Sie müssen ersetzt werden.
2. Die sechs aktuell verwendeten Bodenkacheln je Bodenart werden von 32 auf
   nur 12 Renderpixel mit aktivierter Glättung verkleinert. Damit wird selbst
   scharfe Pixel-Art sichtbar weich.
3. Der große Hafen enthält in allen vier Varianten opakes, blaues Wasser. Er
   kann nur gespiegelt, nicht in vier echten Richtungen dargestellt werden.
4. Die Kiefern sind Kronenfragmente; die Kliffs sind fast vollflächige,
   perspektivische Geländekacheln, die der Renderer beliebig dreht. Beides
   kann geometrisch nicht sauber wirken.

Die stärkste ungenutzte Stilreferenz ist `texture pack/image.png`. Dieser
Atlas enthält genau die detailreiche, warme Pixel-Art, die zu Holzfäller,
Sägewerk und Lager im Spiel passt. Er enthält unter anderem bessere Häuser,
vollständige Bäume und reichere Bodenmotive, wurde aber nicht sauber in die
aktuelle Auswahl überführt.

## Umfang und aktuelle Verwendung

| Bestand | PNGs | Technischer Charakter |
| --- | ---: | --- |
| `src/assets/medieval` | 176 vor / 123 nach Bereinigung | Laufzeitbestand |
| `art/generated-textures-v1` | 222 | große ImageGen-Quellen plus 109 `game-ready`-Dateien |
| `art/generated-textures-v2` | 36 | nur hochaufgelöste, grob gerasterte Bodentexturen |
| `texture pack` | 562 | zwei Atlas-Pakete, Rohatlanten, Ausschnitte und Vorschauen |

Zum Auditzeitpunkt enthielt das Manifest 142 PNG-Verweise auf 136 verschiedene
Dateien; 40 der 176 PNGs in `src/assets/medieval` waren gar nicht referenziert.
Nach der Umsetzung enthält der Laufzeitordner exakt die 123 unterschiedlichen
Dateien des kuratierten Manifests (129 Verweise einschließlich gewollter
Mehrfachnutzung). Es gibt dort keine unreferenzierten PNGs mehr. Die sechs
Mehrfachverweise sind:

- `buildings/small_harbor/down.png`, `left.png`, `right.png`, `up.png` werden
  jeweils sowohl als Gebäudegruppe als auch als Richtungsansichten geladen.
- `resources/stone_01.png` und `resources/stone_02.png` werden sowohl als Ware
  als auch als Weltressource geladen.

Die 40 zuvor unreferenzierten Basis-Terrainbilder liegen jetzt unter
`art/candidates/legacy-terrain`; nur `terrain/road_01..08.png` blieb im
Laufzeitordner.

### Technische Formate des aktiven Bestands

- `src/assets/medieval/ground`: 36 Dateien, alle 32×32 RGBA, effektiv zu 100 %
  opak.
- `src/assets/medieval/terrain`: acht aktive Straßenbilder. Die 40
  ungenutzten Bodenbilder liegen jetzt außerhalb des Builds.
- `src/assets/medieval/buildings`: 35 aktive Dateien. Beschriftete
  Haus-/Farm-Ausschnitte und wasserhaltige Häfen liegen im Archiv.
- `src/assets/medieval/trees`: acht vollständige Bäume; vier Eichen und vier
  neu ausgewählte Kiefern mit Stamm.
- `src/assets/medieval/shore`: derzeit keine aktive Datei. Die sechs früheren
  Vollkacheln liegen im Archiv, bis gerichtete Kanten existieren.

## Exakte Duplikate und Herkunft

Die folgenden zum Auditzeitpunkt aktiven beziehungsweise danach archivierten
Dateien sind bytegleich mit anderen Beständen:

- `src/assets/medieval/buildings/house/house_01.png` bis `house_04.png` sind
  exakt die v0.2-Ausschnitte unter
  `texture pack/medieval_city_builder_texture_pack_v0.2/assets/buildings/house/`.
- `src/assets/medieval/buildings/farm/farm_01.png` bis `farm_04.png` sind exakt
  die v0.2-Ausschnitte unter
  `texture pack/medieval_city_builder_texture_pack_v0.2/assets/buildings/farm/`.
- Die aktiven Varianten von Bäckerei, Fischerhütte, großem Hafen, Mühle und
  Steinbruch sind jeweils exakt identisch mit den entsprechenden Dateien
  unter `art/generated-textures-v1/game-ready/buildings/`.
- `src/assets/medieval/goods/{bread,fish,flour,grain}.png` sind exakt die
  entsprechenden v1-`game-ready`-Symbole.
- `src/assets/medieval/ships/trade_{up,down,left,right}.png` sind exakt die
  vier Hauptrichtungen aus
  `art/generated-textures-v1/game-ready/ships/trade_ship/`.
- Die aktiven Arbeiter `units/worker_{01,02,03,07}.png` sowie die meisten
  Stein-, Eisen- und Holzressourcen sind exakt Kopien aus
  `texture pack/medieval_texture_pack_v0.1/extracted/`.
- Kritischer interner Fehler: jedes
  `src/assets/medieval/terrain/sand_01..08.png` ist bytegleich mit dem
  gleich nummerierten `terrain/dirt_01..08.png`. Der scheinbare alte
  Sandbestand ist also achtmal Erde, nicht Sand.

Die aktuellen Varianten von Umschlagplatz und kleinem Hafen sind keine
bytegleichen Kopien ihrer `art/generated-textures-v1/game-ready`-Vorstufen.
Sie besitzen inzwischen teiltransparente Randpixel und wirken technisch
sauberer freigestellt.

## Keep / Fix / Replace

### KEEP – direkt weiterverwendbar

#### Umschlagplatz

- `src/assets/medieval/buildings/depot/depot_01.png`
- `src/assets/medieval/buildings/depot/depot_02.png`
- `src/assets/medieval/buildings/depot/depot_03.png`
- `src/assets/medieval/buildings/depot/depot_04.png`

Alle vier sind echte transparente 192×192-Sprites ohne gemalten Boden oder
Wasser. Der transparente Anteil liegt bei etwa 46–55 %, weitere 2–3 % sind
teiltransparent und ergeben brauchbare Kanten. Inhaltlich und technisch sind
sie der beste aktuelle Gebäudesatz. Sie sollten bleiben, aber in einem
späteren Stilpass einen gemeinsamen Bodenkontakt/Schatten und dieselbe
Detaildichte wie die übrigen Gebäude erhalten.

#### Kleiner Hafen

- `src/assets/medieval/buildings/small_harbor/down.png`
- `src/assets/medieval/buildings/small_harbor/left.png`
- `src/assets/medieval/buildings/small_harbor/right.png`
- `src/assets/medieval/buildings/small_harbor/up.png`

Das sind vier tatsächliche Richtungen, transparent und ohne eingebranntes
Wasser. Dieses Konstruktionsprinzip sollte als Vorlage für den großen Hafen
dienen. Die Bilder sind an manchen Leinwandkanten eng zugeschnitten; vor dem
finalen Export sollte ein einheitlicher transparenter Sicherheitsrand ergänzt
werden.

#### Solide Kern-Sprites

- `src/assets/medieval/buildings/lumberjack_hut/woodcutter_01.png`
- `src/assets/medieval/buildings/lumberjack_hut/woodcutter_02.png`
- `src/assets/medieval/buildings/warehouse/warehouse_01.png`
- `src/assets/medieval/buildings/warehouse/warehouse_02.png`
- `src/assets/medieval/trees/oak_01.png` bis `oak_04.png`
- `src/assets/medieval/terrain/road_01.png` bis `road_08.png`
- `src/assets/medieval/goods/*.png`
- `src/assets/medieval/ships/*.png`

Diese Gruppen sind lesbar und weitgehend sauber freigestellt. Die vier Eichen
sind vollständige Silhouetten. Herbst- und Blüteneiche sollten allerdings nur
bewusst als Biome/Jahreszeitenvariation erscheinen, nicht zufällig in jedem
normalen Wald.

### FIX – gute Grundlage, aber nicht final

#### Terrain-Rendering, nicht nur Terrain-Dateien

Das Manifest verwendet die 36 Dateien unter
`src/assets/medieval/ground/ground_{grass,dirt,sand,water,forest_ground,rock}_01..06.png`.
Sie sind 32×32 und opak. Der Renderer reduziert sie jedoch bereits beim Bau
des Chunk-Canvas auf `TERRAIN_PX = 12` (`src/client/renderer.ts:50`) und setzt
dabei in `detailTile` `imageSmoothingEnabled = true`
(`src/client/renderer.ts:280-303`). Auch die Übergangskachel wird bei der
Reduktion geglättet (`src/client/renderer.ts:328-356`). Das ist eine direkte
technische Ursache für den verwaschenen Eindruck.

Empfehlung:

1. Terrain intern mindestens mit 16, besser 24 oder 32 Pixeln pro Kachel
   backen, oder bewusst native 12×12-Motive erstellen.
2. Für Pixel-Art beim Downsampling nearest-neighbor verwenden. Wenn ein
   weicher Stil gewünscht ist, muss er für Gebäude und Terrain gemeinsam
   gelten; die aktuelle Mischform funktioniert nicht.
3. `DETAIL_ALPHA_SEAMLESS = 0.88` und die darübergelegte weiche Reliefebene
   separat beurteilen. Die Textur wird gegen eine prozedurale Grundfarbe
   gemischt und danach nochmals weich beschattet; dadurch ändern sich
   Kontrast und Farbe zusätzlich.
4. Die v2-Motive nicht automatisch als final ansehen. Sie sind zwar als
   grobes logisches 32×32-Raster erzeugt, enthalten aber teils sehr große
   Muster: diagonale Sandrillen, große Steine und grobe Felsblöcke. Das ist
   ein Maßstabsbruch zu den fein gezeichneten Gebäuden.

Die alten, ungenutzten Bilder
`src/assets/medieval/terrain/grass_01..08.png` und
`forest_ground_01..08.png` sind deutlich motivreicher und passen stilistisch
besser zu den alten Gebäuden. Sie haben jedoch gemalte Ränder und sind nicht
nahtlos; sie eignen sich als Referenz oder nach einer gezielten
Seamless-Aufbereitung, nicht als blinder Manifest-Tausch.

#### Strand/Wasser

Der zuvor beobachtete Wechsel „Strand–Wasser–Strand–Wasser“ hatte eine klare
Renderer-Ursache: an jeder Materialgrenze malte jede Seite die Textur ihres
Nachbarn bis zu 70 % in die eigene Kachel (`EDGE_REACH = 0.7`). Im aktuellen,
noch nicht eingecheckten Arbeitsstand existiert bereits eine sinnvolle
Einweg-Sonderregel in `src/client/renderer.ts:587-602`: Sand darf in Wasser
greifen, Wasser aber nicht zurück in den Strand.

Diese Änderung sollte visuell geprüft und beibehalten werden. Danach sollte
`EDGE_REACH` für Küsten separat und deutlich kleiner als 0,7 sein. Langfristig
sind gerichtete Küstenkacheln besser als eine Zufallsmaske. Gute
Quellkompositionen dafür liegen in:

- `src/assets/medieval/terrain/water_05.png` bis `water_08.png`
- `texture pack/medieval_city_builder_texture_pack_v0.2/reference/source_atlas.png`

Die Dateien `water_05..08` enthalten Strand bereits im Bild und dürfen deshalb
nicht als normales Wasser zufällig verteilt werden; sie sind nur als
gerichtete Übergänge sinnvoll.

#### Sägewerk und küstengebundene Gebäude

- `src/assets/medieval/buildings/sawmill/sawmill_01.png`
- `src/assets/medieval/buildings/sawmill/sawmill_02.png`
- `src/assets/medieval/buildings/fisher_hut/fisher_hut_01.png` bis
  `fisher_hut_04.png`

Das Sägewerk enthält beim Wasserrad einen blauen Wasserlauf, obwohl die
Spielregel das Gebäude überall an Land zulässt. Die Fischerhütten enthalten
ebenfalls eigene Wasserflächen. Entweder werden diese Flächen sauber entfernt
und nur Steg/Rad behalten, oder die Platzierung und Küstenausrichtung müssen
das Bild wirklich deckungsgleich auf vorhandenes Wasser setzen.

#### Übrige v1-Gebäude

- `src/assets/medieval/buildings/bakery/*.png`
- `src/assets/medieval/buildings/mill/*.png`
- `src/assets/medieval/buildings/quarry/*.png`

Diese 192×192-Sätze sind technisch transparent und gut lesbar, haben aber
harte 0/255-Alpha-Masken ohne teiltransparente Randpixel sowie unterschiedlich
große, mitgemalte Vegetations- und Bodenbasen. Sie können vorerst bleiben,
sollten aber in denselben Exportpass wie Umschlagplatz, Haus und Hafen gehen:
gleiche Leinwand, gleicher Schatten, gleiche Pixelgröße und definierter
Bodenkontakt.

### REPLACE – nicht weiter als aktive Grafik verwenden

#### Wohnhaus

- `src/assets/medieval/buildings/house/house_01.png`
- `src/assets/medieval/buildings/house/house_02.png`
- `src/assets/medieval/buildings/house/house_03.png`
- `src/assets/medieval/buildings/house/house_04.png`

Die Dateien sind 75–76 Pixel breit, aber 142–159 Pixel hoch. Sie enthalten
Atlasüberschrift, Dateiname, Linien/Randreste und viel Abstand statt einer
normalisierten Sprite-Leinwand. Nichttransparente Pixel berühren alle
Bildränder. Da `drawOnFootprint` die Breite auf den 2×2-Footprint normalisiert
und die Höhe nur aus dem Seitenverhältnis berechnet, werden diese Bilder
rechnerisch etwa 5,0–5,7 Kacheln hoch. Die übrigen Gebäude liegen ungefähr bei
1,8–2,7 Kacheln. Der Maßstabsbruch ist damit im Asset fest eingebaut.

Bessere Quellen zum Neu-Extrahieren sind:

- `texture pack/image.png` – vier saubere, unbeschriftete Häuser in der
  Gebäudereihe und beste Stilkohärenz zum aktuellen Holzfäller/Lager.
- `texture pack/medieval_texture_pack_v0.1/extracted/buildings/house/house_01.png`
  bis `house_04.png` – Motivzuschnitte ohne Überschriften, aber noch mit
  dunklem/semitransparentem Atlasgrund; nur als Quelle, nicht direkt.

Ziel: vier 192×192-RGBA-Dateien, gleiche sichtbare Grundbreite, transparenter
Rand, keine Beschriftung und eine effektive Bildhöhe von etwa 2,2–2,7
Kacheln.

#### Getreidefeld/Farm

- `src/assets/medieval/buildings/farm/farm_01.png`
- `src/assets/medieval/buildings/farm/farm_02.png`
- `src/assets/medieval/buildings/farm/farm_03.png`
- `src/assets/medieval/buildings/farm/farm_04.png`

Es ist derselbe fehlerhafte Atlas-Spaltenzuschnitt wie bei den Häusern. Die
Dateien werden etwa 5,0–5,65 Kacheln hoch gezeichnet. Zusätzlich ist
`farm_04.png` semantisch eine Windmühle, obwohl es im Spiel bereits die eigene
Gebäudeart Mühle gibt. Für ein „Getreidefeld“ ist nur die zweite Variante
inhaltlich nah am Ziel.

Bessere Quellen:

- `texture pack/medieval_texture_pack_v0.1/extracted/buildings/farm/farm_02.png`
  zeigt ein Haus mit klar lesbarem, goldenem Getreidefeld.
- `texture pack/medieval_texture_pack_v0.1/extracted/buildings/farm/farm_03.png`
  zeigt Hof und gelagerte Stämme/Beete und kann nach Reinigung als Variante
  dienen.
- `texture pack/medieval_texture_pack_v0.1/preview/atlas_reference.png` enthält
  die vollständige Farmreihe als visuelle Referenz.

`extracted/farm_01.png` hat unten einen Beschriftungsrest;
`extracted/farm_04.png` ist wieder eine Windmühle. Beide nicht als
Getreidefeld übernehmen. Sinnvoller als vier völlig verschiedene Höfe wäre
eine klare Entwicklungsreihe: unbestelltes Feld, Saat, wachsendes Getreide,
erntereifes Feld – mit einem separaten kleinen Bauernhof als Mittelpunkt.

#### Großer Hafen

- `src/assets/medieval/buildings/harbor/harbor_01.png`
- `src/assets/medieval/buildings/harbor/harbor_02.png`
- `src/assets/medieval/buildings/harbor/harbor_03.png`
- `src/assets/medieval/buildings/harbor/harbor_04.png`

Die Dateien sind durchaus transparente PNGs. Das Problem ist nicht das
Dateiformat, sondern dass der sichtbare Motivbereich jeweils eine opake
Wasserfläche unter Steg und Pfählen enthält. Der Renderer bestätigt diese
Einschränkung selbst in `src/client/renderer.ts:1035-1072`: Der große Hafen
hat keine echten Richtungsansichten, wird nur gespiegelt und kann eine
Nordküste nicht korrekt bedienen.

Ersetzen durch vier echte, wasserfreie Richtungen nach dem Prinzip des kleinen
Hafens. Gebäude, Pfähle und Steg gehören in das Sprite; Wasser, Schaum und
Strand gehören ausschließlich in Terrain/Übergangsebenen.

#### Kiefern

- `src/assets/medieval/trees/pine_01.png`
- `src/assets/medieval/trees/pine_02.png`
- `src/assets/medieval/trees/pine_03.png`
- `src/assets/medieval/trees/pine_04.png`

Die aktuellen Bilder sind überwiegend einzelne Kronen- oder Astfragmente und
zeigen keinen stabilen Stamm/Bodenkontakt. Mit 65–73 Pixel Breite bei nur
62–89 Pixel Höhe sind sie beinahe quadratisch. Der Renderer setzt alle Bäume
auf 2,65 Kacheln Höhe; dadurch werden die Kiefern zusätzlich viel zu breit.

Bessere, vollständige Quellformen:

- `texture pack/medieval_texture_pack_v0.1/extracted/trees/pine_04.png`
- `texture pack/medieval_texture_pack_v0.1/extracted/trees/pine_05.png`
- `texture pack/medieval_texture_pack_v0.1/extracted/trees/pine_06.png`
- `texture pack/medieval_texture_pack_v0.1/extracted/trees/pine_07.png`
- optional `texture pack/medieval_texture_pack_v0.1/extracted/trees/pine_tall_05.png`
- die vollständige Baumreihe in `texture pack/image.png`

Die Einzeldateien besitzen noch dunklen/semitransparenten Atlasgrund. Sie
müssen neu freigestellt und auf eine gemeinsame Leinwand gesetzt werden. Ziel
ist ungefähr ein Verhältnis Breite:Höhe von 0,45–0,65 und ein klarer Stammfuß.

#### Kliffs

- `src/assets/medieval/shore/cliff_01.png` bis `cliff_06.png`

Diese Dateien sind zu 90–95 % opake, quadratische Terrainstücke mit Gras-,
Fels-, teilweise Sand- und Wasseranteilen. Der Renderer malt sie als 1,5
Kacheln große Szenenobjekte und dreht dasselbe perspektivische Motiv für Nord,
Ost, Süd und West (`src/client/renderer.ts:895-915` und `1180-1196`). Dabei
drehen sich Licht, Grasoberkante und Felswand mit; die Bilder können weder
sauber aneinander anschließen noch eine stabile Perspektive bilden.

Ersetzen durch ein gerichtetes Kanten-/Wang-Tile-System mit mindestens:

- vier geraden Kanten,
- vier Außenkurven,
- vier Innenkurven,
- Enden/Einzelkanten,
- getrennten Gras–Wasser- und Sand–Wasser-Sätzen.

Als Quelle/Kompositionsreferenz dienen die 18 Motive unter
`texture pack/medieval_city_builder_texture_pack_v0.2/assets/cliffs_shore/`
beziehungsweise der besser überschaubare Rohatlas
`texture pack/medieval_city_builder_texture_pack_v0.2/reference/source_atlas.png`.
Die 18 Einzeldateien sind selbst eng und teils mit Atlasrand ausgeschnitten;
sie sollten nicht ungeprüft direkt ins Manifest.

## UNUSED-GOOD – gute, derzeit ungenutzte Kandidaten

### Höchster Wert

1. `texture pack/image.png`
   - beste zusammenhängende Stilreferenz;
   - enthält acht reiche Grasflächen, acht Waldböden, acht Erdböden, acht
     Straßen, acht Wasser-/Küstenmotive, vier vollständige Eichen, vier
     vollständige Kiefern und vier gute Häuser;
   - ist ein opaker 1536×1024-Atlas und muss sauber neu extrahiert werden.
2. `src/assets/medieval/terrain/grass_01..08.png`
   - deutlich reichere Grasdetails als der aktive, feinkörnige 32×32-Satz;
   - nach Randbereinigung/seamless pass ein guter Kandidat.
3. `src/assets/medieval/terrain/forest_ground_01..08.png`
   - farblich und motivisch passend zu den bestehenden Eichen und Gebäuden;
   - ebenfalls zuerst Rand/Naht prüfen.
4. `src/assets/medieval/terrain/water_01..04.png`
   - kräftiges, gut lesbares Wasser ohne Strandanteil;
   - die Varianten 05–08 separat nur als gerichtete Küstenübergänge nutzen.
5. `texture pack/medieval_texture_pack_v0.1/extracted/trees/pine_04..07.png`
   - vollständige Kiefern mit Stamm; nach sauberer Freistellung klar besser
     als die aktiven Fragmente.
6. `texture pack/medieval_texture_pack_v0.1/extracted/buildings/house/house_01..04.png`
   und `.../farm/farm_02.png`, `farm_03.png`
   - gute Motive, aber noch kein fertiges Alpha/Canvas.

### Bereits game-ready, aber noch nicht spielseitig genutzt

- `art/generated-textures-v1/game-ready/buildings/mine/mine_01.png` bis
  `mine_04.png`: gut lesbare Bergwerkvarianten; passend für eine spätere
  Mine am Berg.
- `art/generated-textures-v1/game-ready/goods/coal.png`
- `art/generated-textures-v1/game-ready/goods/iron_ingot.png`
- `art/generated-textures-v1/game-ready/goods/meat.png`
- `art/generated-textures-v1/game-ready/goods/tools.png`
- alle acht Richtungen unter
  `art/generated-textures-v1/game-ready/ships/fishing_cutter/`
- alle acht Richtungen unter
  `art/generated-textures-v1/game-ready/ships/warship/`
- die vier diagonalen Handelsschiffe `trade_ship/{up_left,up_right,down_left,down_right}.png`

Diese Schiffe und Symbole sind echte transparente Einzeldateien. Sie sollten
aufbewahrt und erst dann ins Manifest genommen werden, wenn Simulation/UI die
entsprechenden Typen kennt.

### Nur bedingt gut

- `art/generated-textures-v1/game-ready/roads/cobblestone/*.png` und
  `roads/field/*.png` sind technisch sauber, visuell aber sehr flach und
  kontrastarm. Sie eignen sich als Platzhalter oder UI-Materialprobe, nicht
  als Zielqualität.
- `art/generated-textures-v1/game-ready/terrain/*` sollte laut eigener
  `README.md` nicht integriert werden: dieser Satz wurde stark gemittelt und
  gespiegelt und ist genau die weichere v1-Vorstufe.
- Die v0.2-Einzeldateien unter
  `texture pack/medieval_city_builder_texture_pack_v0.2/assets` sind fast
  durchgehend sehr enge Atlas-Ausschnitte. Die Rohmotive sind nützlich, die
  vorhandenen Zuschnitte häufig nicht.

## Stil- und Maßstabsbrüche

| Gruppe | Stil/Problem | Wirkung im Spiel |
| --- | --- | --- |
| Aktives Terrain (`ground`) | feinkörnige bzw. grob gerasterte Vollflächen, 32→12 weich verkleinert | matt/verwaschen, andere Pixeldichte als Gebäude |
| Holzfäller/Lager/Sägewerk | detailreiche Atlas-Pixel-Art, viel Vegetation, freie Seitenverhältnisse | gute Kernästhetik, aber kleinere sichtbare Höhe |
| v1-Gebäude | quadratische 192er Leinwand, größere Einzelmotive und Bodeninseln | wirken wie aufgesetzte Illustrationen |
| Umschlagplatz | saubere, isolierte Konstruktion ohne Umgebung | technisch gut, aber zu „nackt“ neben begrünten Gebäuden |
| Haus/Farm | schmale Atlas-Spalten mit Text/Rand | 5–5,7 Kacheln hoch, klar kaputt |
| Eichen | vollständige breite Kronen | brauchbar |
| Kiefern | fast quadratische Astfragmente | wirken wie schwebende Kronen/Sträucher |
| Kliffs | ganze perspektivische Bodenblöcke, beliebig gedreht | überlappen Terrain und brechen Perspektive |

Die aktuelle Größenformel macht die Unterschiede messbar: Bei einem
2×2-Footprint und `SPRITE_OVERHANG = 1.35` ergibt sich die sichtbare Höhe aus
`2.7 × Bildhöhe / Bildbreite` Kacheln. Daraus folgen:

- Sägewerk: etwa 1,77–1,84 Kacheln hoch,
- Holzfäller/Lager: etwa 2,21–2,27,
- quadratische 192er-Sätze: 2,70,
- Farm: etwa 4,98–5,65,
- Haus: etwa 5,04–5,72.

Vor einem finalen Art-Pass sollte daher ein verbindliches Exportprofil gelten:
192×192 RGBA für 2×2-Gebäude, 6–10 Pixel transparenter Rand, definierter
Fußpunkt, einheitliche sichtbare Grundbreite, konsistente Lichtquelle und eine
gemeinsame Ziel-Pixelgröße.

## Empfohlene Kontaktübersichten

Keine Übersicht sollte die Bilder nur auf Weiß zeigen; Alpha- und
Maßstabsfehler bleiben dann unsichtbar. Sinnvoll sind fünf getrennte Sheets:

1. **`terrain-source-comparison.png`**
   - Zeilen: aktiv `src/.../ground`, ungenutzt `src/.../terrain`, v1
     `game-ready`, v2-Quelle, v0.1-Atlas;
   - Spalten: Gras, Erde, Sand, Wasser, Waldboden, Fels;
   - jede Kachel einmal 1:1 und einmal als 4×4-Wiederholung ohne Glättung.
2. **`buildings-on-footprint.png`**
   - alle aktiven Gebäude auf demselben 2×2-Raster, gleicher Zoom;
   - darunter Dateimaß, Alpha-Bounds und errechnete Höhe in Kacheln;
   - unbedingt auf Gras, Erde und einem neutralen dunklen Grund zeigen.
3. **`alpha-contamination.png`**
   - Sprite links auf Magenta, rechts auf Cyan, daneben reine Alpha-Maske;
   - macht Textreste, dunkle Halos, Löcher, Wasser- und Bodenreste sichtbar.
4. **`coast-cliff-directions.png`**
   - jede Küsten-/Kliffgrafik in allen Richtungen auf einem echten
     Sand–Wasser- und Gras–Wasser-Testfeld;
   - gerade Kante, Innenkurve, Außenkurve und Einzeltile getrennt prüfen.
5. **`trees-scale-density.png`**
   - jede Baumvariante einzeln auf einem 1×1-Raster sowie als 3×3- und
     7×7-Waldgruppe;
   - zeigt sofort fehlende Stämme, harte Ausschnitte, falsche Kronenbreite
     und Dichteprobleme.

## Empfohlene Reihenfolge des Grafik-Overhauls

1. Haus und Getreidefeld aus dem aktiven Manifest ersetzen; bis dahin lieber
   je eine saubere Übergangsgrafik als vier kaputte Varianten verwenden.
2. Terrain-Downsampling/Glättung korrigieren und die bestehende einseitige
   Sand-Wasser-Regel visuell prüfen.
3. Großen Hafen als vier wasserfreie Richtungen neu zeichnen.
4. Kiefern aus vollständigen Quellmotiven neu freistellen; Eichen zunächst
   behalten.
5. Kliffs nicht weiter als rotierte Szenenobjekte behandeln, sondern als
   gerichtetes Küsten-/Höhenkanten-System neu aufbauen.
6. Umschlagplatz, kleiner Hafen und übrige Gebäude in einen gemeinsamen
   Export- und Stilpass geben.
7. Erst danach ungenutzte Bergwerke, Schiffe und Warensymbole integrieren.

Bis diese Reihenfolge abgeschlossen ist, sollten keine Bestände gelöscht
werden. Insbesondere `texture pack/image.png`, beide Referenzatlanten und die
v0.1-`extracted`-Ordner sind noch wertvolle Quellen für eine saubere
Neufreistellung.
