# InfiniteSettler

Siedler-Klon auf einer prozedural erzeugten, praktisch unendlichen Karte
mit Kontinenten, Binnenseen, Gebirgszuegen und Wassertiefe.
Laeuft als statische Seite; die Simulation ist deterministisch aufgebaut,
damit spaeter Mehrspieler ueber Lockstep dazukommen kann.

## Loslegen

```bash
npm install
npm run dev
```

| Befehl | Wirkung |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm test` | Testsuite (inkl. Determinismus- und Grenztest) |
| `npm run build` | Typecheck + Produktionsbuild nach `dist/` |

## Steuerung

| Eingabe | Wirkung |
| --- | --- |
| Ziehen (linke Taste im Modus *Ansehen*), rechte Taste immer | Karte schieben, laeuft nach dem Loslassen weich aus |
| `W A S D` / Pfeiltasten | Karte schieben (mit Anlauf und Nachlauf) |
| `Shift` halten | dreifache Scrollgeschwindigkeit |
| Mausrad | Zoomen; der Punkt unter dem Cursor bleibt stehen |
| `1`–`8` | Werkzeug waehlen |
| `I` | Detailfeld ein-/ausblenden |
| Ziehen im Modus *Strasse* / *Abreissen* | mehrere Tiles auf einmal |
| Zwei Finger (Touch) | schieben und zoomen, auch im Baumodus |

Auf dem Handy ist die Zwei-Finger-Geste die einzige Art zu schieben, weil es
weder rechte Maustaste noch Tastatur gibt. Setzt man den zweiten Finger auf,
wird ein bereits ausgeloester Bau wieder zurueckgenommen.

## Spielprinzip

Der Kreis, um den sich alles dreht:

> **Wohnhaeuser brauchen Nahrung → versorgte Haeuser stellen Siedler →
> Siedler betreiben die Betriebe → die Betriebe erzeugen die Nahrung.**

Jeder Betrieb (Holzfaeller, Saegewerk, Steinbruch, Fischerhuette,
Getreidefeld, Muehle, Baeckerei) braucht **einen Siedler**, um zu
arbeiten. Gibt es weniger Siedler als Arbeitsplaetze, stehen die
**zuletzt gebauten** Betriebe still - die Kachel ganz links in der
Warenleiste zeigt `Siedler/Arbeitsplaetze` und faerbt sich rot, sobald es
knapp wird.

Siedler kommen aus Wohnhaeusern, und ein Wohnhaus zaehlt nur, solange
Nahrung darin liegt. Traeger liefern sie an wie jede andere Ware. Es gibt
zwei Sorten:

| Nahrung | Woher | Haelt vor |
|---|---|---|
| Fisch | Fischerhuette am Wasser | 400 Ticks (20 s) |
| Brot | Getreidefeld → Muehle → Baeckerei | 900 Ticks (45 s) |

Fisch ist der schnelle Einstieg (die Huette kostet nur Holz), Brot der
lohnende Ausbau: dreimal so lange Wirkung, dafuer drei Gebaeude.

Damit der Start keine Sackgasse ist, gibt es **drei Siedler von Anfang an**
- die Gruendergruppe. Sie reichen genau fuer Holzfaeller, Saegewerk und
eine Fischerhuette. Alles darueber hinaus muss erst wohnen.

Der Hafen fischt bewusst **nicht** mehr selbst: ein Umschlagplatz, der
nebenbei Nahrung erzeugt, haette die ganze Kette ueberfluessig gemacht.

## Bauen

Gebaeude kosten Waren und stehen sofort - die Kosten werden beim Setzen aus
den Lagerbestaenden abgebucht. Reicht der Vorrat nicht, ist der Knopf im
Bau-Overlay ausgegraut. Jedes Gebaeude belegt 2x2 Kacheln.
Zwei Regeln verhindern Sackgassen:
der **allererste Bau** einer Welt ist geschenkt und - wenn es ein Lager ist -
mit Startvorrat gefuellt (Holz, Bretter, Stein), und ein **Lager ist
kostenlos, solange keines steht** (dann aber leer). Der **Holzfaeller kostet
nichts** und das **Saegewerk kostet Holz statt Bretter**, damit sich die
Kette aus dem Nichts starten kann.

`#seed=123` in der URL waehlt eine bestimmte Welt. Der Spielstand wird alle
10 Sekunden automatisch in IndexedDB gesichert.

Die Warenanzeige oben zeigt als grosse Zahl, was **im Lager** liegt. Ein
kleines `+N` daneben ist gebunden: in Gebaeudepuffern oder gerade von einem
Traeger unterwegs. Der Tooltip schluesselt es auf. Ohne diese Trennung wirkt
eine voll ausgelastete Kette faelschlich leer, weil Holz direkt im Saegewerk
landet und nie im Lager ankommt.

In der Browserkonsole gibt `__settler.hash()` den Zustands-Hash aus — ab M5
der schnellste Weg, einen Desync zwischen zwei Clients einzukreisen.

## Grafik

Der Client laedt ein kuratiertes, rund 520 KB grosses Sprite-Set aus
`src/assets/medieval/manifest.json`. Terrainvarianten werden deterministisch
aus Seed und Weltkoordinaten gewaehlt; Gebaeudevarianten aus ihrer stabilen Id.
Dadurch flackert nichts zwischen Frames und zwei Clients duerfen trotzdem
unterschiedlich rendern, ohne den Simulationszustand zu veraendern.

Terrain wird einmal je Chunk in einen Detail-Cache gerendert. Baeume, Felsen,
Gebaeude und Traeger werden am unteren Mittelpunkt ihrer logischen Kachel
verankert und nach Welt-y sortiert. Fehlt eine PNG, bleibt das Spiel mit den
bisherigen Farbformen benutzbar.

Das lokale Rohpaket unter `texture pack/` ist absichtlich ignoriert. Das
Werkzeug `node tools/extract-atlas.mjs --out <ziel>` kann die Ausgangsbilder
neu erzeugen; ins Spielmanifest gelangen nur visuell gepruefte Dateien.

## Deployment

Der Workflow in `.github/workflows/deploy.yml` baut bei jedem Push auf `main`
und veroeffentlicht nach GitHub Pages.

**Einmalig noetig:** im Repo unter *Settings → Pages* die Source auf
**GitHub Actions** stellen. Das kann der Workflow nicht selbst.

`vite.config.ts` setzt `base: '/InfiniteSettler/'`, weil Projekt-Pages unter
einem Unterpfad liegen. Bei anderem Repo-Namen dort anpassen.

## Architektur

Details und Begruendungen in [PLAN.md](PLAN.md). Die kurze Fassung:

`src/sim` ist deterministisch, headless und browserfrei — Integer-Arithmetik
statt Float, alle Zustandsaenderungen laufen ueber Commands. `src/client`
zeichnet und nimmt Eingaben entgegen, schreibt aber nie direkt in den
Weltzustand. `test/boundary.test.ts` prueft diese Trennung automatisch.
