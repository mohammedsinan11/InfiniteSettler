# InfiniteSettler — Plan

Siedler-Klon auf theoretisch unendlicher Karte. Der Client ist eine statische
Seite (GitHub Pages), Mehrspieler kommt spaeter ueber Deterministic Lockstep
mit einem kleinen Relay daneben — nicht auf Pages selbst, denn statisches
Hosting kann per Definition nichts weiterleiten.

Stand: **M0–M4 und Grafikpass fertig.** M5 und M6 offen.

---

## Die zwei Entscheidungen, die nicht revidierbar sind

### 1. Fixed-Point statt Float in der Simulation

Alle Sim-Zahlen sind int32 im 16.16-Format (`FP_ONE = 65536`), siehe
`src/sim/fixed.ts`.

Bei Lockstep wandern nur Befehle ueber die Leitung, die Welt rechnet jeder
Client selbst aus. Weichen zwei Clients im letzten Bit ab, driften die
Zustaende auseinander — lautlos, ohne Fehlermeldung.

Float ist dabei nicht pauschal schuld: `+ - * /` sind durch IEEE-754 exakt
festgelegt. Die Killer sind `Math.sin/cos/pow/exp/log`, die ECMAScript
ausdruecklich nur als Naeherung spezifiziert und die sich real zwischen
Engines unterscheiden. Integer-Arithmetik (`|0`, `Math.imul`, Shifts) ist
lueckenlos festgelegt.

*Nicht nachruestbar*, weil es kein Typ-Tausch ist, sondern jede Formel
betrifft — inklusive aller Balancing-Werte.

**Bekannte Grenze:** 16.16 reicht nur bis ±32768. Das betrifft
Traegerpositionen, nicht die Karte (die laeuft auf int32-Tiles). Wer weiter
draussen siedeln will, splittet die Position in Tile + Subtile-Offset.
`test/fixed.test.ts` haelt dieses Verhalten explizit fest.

### 2. Simulation strikt getrennt vom Rendering

`src/sim` ist im Kern `step(state, commands) → state`. Keine Browser-API,
kein `Math.random`, kein `Date.now`.

Drei Dinge, die man spaeter nicht nachruesten kann: die Sim laeuft headless
in Tests (erst das macht den Determinismus-Test moeglich), sie ist bei Bedarf
nach Rust/WASM portierbar, und — der eigentliche Grund — Rendering kann den
Spielzustand nicht beeinflussen. Der klassische Bug ist, dass Kameraposition,
Zoom oder Framerate in die Simulation durchsickern; dann bekommt der Spieler
mit dem schnelleren Rechner eine andere Welt. Unter Lockstep ist das ein
sofortiger Desync.

Deshalb prueft `test/boundary.test.ts` diese Regel mechanisch statt sie zur
Disziplinfrage zu machen.

---

## Struktur

```
src/sim/       Simulation — deterministisch, headless, browserfrei
  fixed.ts     16.16-Arithmetik
  hash.ts      Ortshash (Math.imul) + FNV-1a fuer Zustands-Hashes
  rng.ts       geseedeter PRNG, Zustand serialisierbar
  noise.ts     Value-Noise + FBM, komplett in Fixed-Point
  terrain.ts   Hoehenfeld -> Terrainart
  chunks.ts    LRU-Cache fuer generiertes Terrain (nie mutiert)
  coords.ts    Tile-/Chunk-Koordinaten und Schluessel
  types.ts     Waren, Gebaeudetypen, Traeger
  state.ts     WorldState + World
  commands.ts  die einzige Art, den Zustand zu aendern
  pathfind.ts  A* auf Strassen
  economy.ts   Produktion, Auftragsvergabe, Traegerbewegung
  tick.ts      step() bei fester Rate
  serialize.ts Snapshot + Zustands-Hash
src/client/    Rendering, Eingabe, HUD, Persistenz
test/          fixed, noise, determinism, boundary
```

---

## Meilensteine

### M0 — Skelett und Deployment ✅
Vite + TypeScript, GitHub-Actions-Workflow nach Pages (`base: /InfiniteSettler/`).
Deployment bewusst zuerst, damit es nie ein grosses Ereignis wird.

### M1 — Unendliche Karte ✅
Fixed-Point, Integer-Noise, Chunks à 64×64 mit LRU, Canvas2D-Renderer mit
Offscreen-Chunk-Cache (ein Draw-Call pro Chunk statt 4096), Kamera mit
Viewport-Culling.

Die Karte ist rein prozedural: `f(seed, x, y)`. Nichts wird gespeichert, was
sich neu berechnen laesst. Reichweite int32 ≈ ±2 Mrd. Tiles.

*Erfahrung aus dem Tuning:* Die Noise-Schwellwerte sind an der **gemessenen**
Verteilung ausgerichtet, nicht geraten. Der erste Versuch (Basiszelle 512
Tiles, Persistenz 0.5) sah auf dem Papier "kontinentaler" aus, erzeugte aber
Regionen, die ueber einen ganzen Bildschirm hinweg nur aus Wasser oder nur aus
Land bestanden — Wasseranteil je Fenster schwankte zwischen 0 % und 46 %.
Mit Basiszelle 128 und Persistenz 0.65 liegt er stabil bei 8–35 %.

### M2 — Bauen und Persistenz ✅
Spielerveraenderungen als Deltas (`terrainOverride`) ueber dem generierten
Terrain. Ein Spielstand bleibt damit klein, egal wie weit gescrollt wurde.
Autosave in IndexedDB alle 10 s und beim Verlassen der Seite.

### M3 — Wirtschaft ✅
Holzfaeller → (Holz) → Saegewerk → (Bretter) → Lager. A* auf Strassen,
Traeger mit Transportauftraegen, Tickrate 20 Hz entkoppelt vom Rendering.

Ueberall, wo die Reihenfolge das Ergebnis beeinflusst, wird explizit ueber
**sortierte Ids** iteriert — nie ueber Map-Einfuegereihenfolge. Die waere
zwar auch deterministisch, ist aber eine Falle, sobald irgendwo umsortiert wird.

### M4 — Commands und Determinismus-Test ✅
Jede Zustandsaenderung ist ein Command. `test/determinism.test.ts` spielt ein
festes Command-Log zweimal ab und vergleicht die Hash-Folge Tick fuer Tick;
zusaetzlich wird geprueft, dass Speichern → Laden → Weiterrechnen dieselbe
Folge ergibt.

Bewusst **vor** dem Netzwerk: ein Desync ist in einer kleinen headless
Simulation in Minuten zu finden, im Zusammenspiel zweier Clients ueber ein
Netzwerk in Tagen.

Der Test prueft ausserdem, dass ueberhaupt etwas simuliert wird (Bretter im
Lager, abgeholzter Wald, laufende Traeger) — sonst waere eine tote Simulation
trivial deterministisch und der Test wertlos.

### Grafikpass ✅

Kuratierte Atlas-Sprites fuer Terrain, Strassen, die drei vorhandenen
Gebaeudetypen, Wald, Fels und Traeger. Die Bilder werden zentral und mit
Fallback geladen. Terrain liegt im Chunk-Cache; Weltobjekte sind
bottom-center verankert und nach Welt-y sortiert. Variantenauswahl ist rein
visuell und stabil aus Weltkoordinate beziehungsweise Objekt-Id abgeleitet.

### M5 — Netzwerk (offen)
Cloudflare Worker mit Durable Object als Signaling und Relay. Raum-Code zuerst,
Lobby danach. Lockstep mit Input-Delay: ein Command bei Tick T wird erst bei
T+3 ausgefuehrt — dieses Fenster ist die Zeit, in der das Paket ankommt.
Regelmaessig Zustands-Hashes mitschicken, damit ein Desync sofort auffaellt.

Die Eingabewarteschlange in `src/client/input.ts` hat schon die richtige Form:
dort werden Commands gesammelt und pro Tick abgeholt. Fuer M5 kommt zwischen
Sammeln und Ausfuehren nur die Leitung.

### M6 — Lobby und Politur (offen)
Lobby-DO mit Heartbeat/TTL gegen Geisterraeume, Rate-Limit gegen Spam.
Fuer eine oeffentliche Lobby den Worker als vollen Relay laufen lassen statt
P2P: bei Lockstep sind das ein paar hundert Byte pro Sekunde, und die Spieler
sehen sich dann nicht gegenseitig die IP-Adresse.

---

## Weitere Gebaeude integrieren

Der Hafen war der Testfall dafuer, wie teuer ein neues Gebaeude ist. Zwei
Dinge, die vorher fest im Code standen, sind jetzt Eigenschaften der Bauart:
**wo** ein Gebaeude stehen darf (`placement`) und **woraus** es seinen
Rohstoff zieht (`harvestTile` / `harvestConsumes`). Damit kostet ein
Gebaeude, das in dieses Schema passt, nur noch einen Eintrag.

### Rezept

1. **`src/sim/types.ts`** - Eintrag in `BuildingType`, Eintrag in
   `BUILDING_SPECS`. Braucht es eine neue Ware, auch `Good`, `GOOD_COUNT`
   und `GOOD_NAMES`.
2. **`src/client/colors.ts`** - Farbe fuer Gebaeude und ggf. Ware. Der
   Compiler erzwingt beides ueber `Record<BuildingType, …>`, man kann es
   also nicht vergessen.
3. **`src/client/input.ts`** - `Mode`, `MODE_LABELS`, `BUILD_TYPE`.
4. **`src/assets/medieval/manifest.json`** + `assets.ts` - Sprites.
5. **Test** in `test/placement.test.ts`.

Nur wenn eine **neue Lagebedingung** dazukommt (z. B. "an einem Berg"),
braucht `Placement` einen zusaetzlichen Wert und `canPlaceBuilding` einen
Zweig. Alles andere ist Konfiguration.

### Wenn eine Ware dazukommt

`GOOD_COUNT` waechst, und aeltere Spielstaende haben zu kurze Warenarrays.
`deserialize` fuellt sie auf - ohne das liefe der Zugriff auf den neuen
Index auf `undefined` und die Bestaende wuerden zu `NaN`, was erst Minuten
spaeter als "Traeger holen nichts mehr" auffiele.

### Was das Schema NICHT abdeckt

- **Mehrfeldrige Gebaeude.** Die Sprites werden mit `zoom * 3.15`
  gezeichnet, logisch belegt jedes Gebaeude aber eine einzige Kachel. Man
  kann deshalb eine Strasse mitten durch ein sichtbares Haus bauen. Das zu
  beheben heisst: Grundflaeche in `BuildingSpec`, `buildingAt` ueber
  mehrere Kacheln, Platzierungspruefung ueber die ganze Flaeche, und die
  Entscheidung, welche Felder fuer Traeger begehbar sind (Vorschlag: nur
  das Ankerfeld, sonst laufen sie durchs Haus).
- **Gebaeude mit zwei Eingangswaren.** `consumes` ist ein einzelner Wert.
  Fuer eine Baeckerei (Mehl + Wasser) muesste daraus eine Liste werden.

---

## Naechste Wirtschaftskreislaeufe

Drei Moeglichkeiten, nach Aufwand sortiert. Sie schliessen sich nicht aus.

### A. Steinbruch - der billige Beweis

Ein Eintrag in `BUILDING_SPECS`: `harvestTile: Tile.Stone`,
`harvestConsumes: true`, `produces: Good.Stone`. Keine neue
Platzierungsregel noetig - dass der Steinbruch am Fels stehen muss, ergibt
sich von selbst daraus, dass er sonst nichts findet.

Zeigt, ob die Verallgemeinerung wirklich traegt, und liefert den zweiten
Grundstoff, den Baukosten brauchen.

### B. Baukosten - der eigentlich fehlende Kreis

**Das ist die wichtigste Luecke im Spiel.** Bauen ist derzeit kostenlos,
also ist die gesamte Produktionskette ohne Zweck: Bretter herzustellen
erreicht nichts. Erst wenn ein Gebaeude Bretter und Steine kostet, die aus
einem Lager kommen muessen, wird aus "Zahlen steigen" ein Spiel.

Umsetzung: `BuildingSpec.cost`, und der Bau-Command legt statt des
fertigen Gebaeudes eine **Baustelle** an, die wie ein Verbraucher Waren
anfordert. Ist sie beliefert, wird daraus das Gebaeude. Das nutzt das
vorhandene Transportsystem vollstaendig weiter - eine Baustelle ist
schlicht ein Gebaeude mit `consumes` und ohne `produces`.

Nebenwirkung, die man mitdenken muss: das erste Lager muss geschenkt sein,
sonst kann man nicht anfangen.

### C. Hafen v2 - Schiffe

Der jetzige Hafen fischt nur. Der interessante Hafen verbindet zwei
Strassennetze ueber Wasser.

Der Trick, mit dem das ohne neues Routing auskommt: **jede Etappe bleibt
ein eigener Auftrag.** Ein Hafen verhaelt sich landseitig wie ein Lager
(nimmt an) und wie ein Erzeuger (gibt ab). Dazwischen fahren Schiffe
zwischen zwei Haefen - das ist derselbe Traegercode mit einer anderen
Begehbarkeitsregel (`Tile.Water` statt Strassen) und A* darauf. Die
bestehende Auftragsvergabe deckt Etappe 1 und 3 unveraendert ab.

Voraussetzung ist allerdings, dass es ueberhaupt etwas zu verbinden gibt -
also Inseln oder Siedlungen ueber einen See hinweg. Mit den jetzigen
grossen Seen ist das plausibel, aber es ist der Punkt, an dem sich der
Aufwand erst mit einem Gegenueber lohnt (siehe KI).

### Empfehlung

**A, dann B.** Zusammen sind sie ueberschaubar und geben dem Spiel zum
ersten Mal ein Ziel. C lohnt sich danach, und es ist ohnehin der natuerliche
Vorlaeufer der KI - ein zweites Volk am anderen Ufer ist genau der Grund,
warum ein Hafen existieren will.

### Blocker, der vorher weg muss

`assignJobs` in `src/sim/economy.ts` ist dreifach verschachtelt ueber alle
Gebaeude (Traeger x Gebaeude x Gebaeude x Waren). Bei drei Gebaeuden
irrelevant, bei mehreren Voelkern mit je 50 Gebaeuden sind das 125 000
Kombinationen pro Traeger und Tick. Vor C oder der KI muss das raus.

---

## Nicht enthalten

- Die Perspektive bleibt ein orthogonales Raster mit 3/4-Sprites. Echte
  Isometrik waere weiterhin reine Renderer-Sache, solange die Sim
  gitterbasiert bleibt.
- `state.roads` und `state.buildings` werden beim Zeichnen komplett
  durchlaufen und gecullt. Bei sehr grossen Siedlungen braucht das einen
  raeumlichen Index.
