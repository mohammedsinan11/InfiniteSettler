# InfiniteSettler

Siedler-Klon auf einer prozedural erzeugten, praktisch unendlichen Karte.
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
| Ziehen (linke Taste im Modus *Ansehen*), rechte Taste immer | Karte schieben |
| `W A S D` / Pfeiltasten | Karte schieben |
| Mausrad | Zoomen |
| `1`–`6` | Werkzeug waehlen |
| Ziehen im Modus *Strasse* / *Abreissen* | mehrere Tiles auf einmal |

`#seed=123` in der URL waehlt eine bestimmte Welt. Der Spielstand wird alle
10 Sekunden automatisch in IndexedDB gesichert.

In der Browserkonsole gibt `__settler.hash()` den Zustands-Hash aus — ab M5
der schnellste Weg, einen Desync zwischen zwei Clients einzukreisen.

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
