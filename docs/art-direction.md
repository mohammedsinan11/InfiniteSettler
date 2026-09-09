# Infinite Settler – verbindliche Grafikrichtung

Stand: 9. September 2026. Diese Regeln gelten für neue und überarbeitete
Spielgrafiken. Die zusammenhängende Stilreferenz ist `texture pack/image.png`;
Umschlagplatz und kleiner Hafen sind technische Referenzen für saubere Alpha-
Kanten und wasserfreie Richtungsbilder.

## Zielbild

Warme, leicht entsättigte Pixel-Art in einer leicht schrägen Draufsicht. Die
Welt soll wie ein lebendiges Diorama auf einem Kartentisch wirken: klare
Silhouetten, kleine handgesetzte Details und ruhige, gut lesbare Flächen.
Gebäude dürfen reich sein; Terrain bleibt zurückhaltender und bildet eine
lesbare Bühne.

## Gemeinsame Regeln

- Licht kommt immer von oben links, Schatten fallen kompakt nach rechts unten.
- Ein Motiv pro PNG. Keine Kontaktblätter, Labels, Rahmen oder zweite Ansicht.
- Gebäude, Vegetation und Einheiten haben echten Alphahintergrund.
- Kein gemaltes Wasser, Gras oder Sand in Gebäude- und Schiffsprites.
- Pro Gruppe gleiche Palette, Pixeldichte, sichtbare Grundbreite und
  Detailstärke.
- Keine bilineare Glättung für Sprites oder Texturkörnung. Nur
  großflächige Farb- und Reliefmasken dürfen weich interpoliert werden.
- Saisonale Motive werden nicht zufällig in normale Gruppen gemischt.

## Exportprofile

### Gebäude

- Leinwand: 192×192 RGBA
- 2×2-Footprint: sichtbare Höhe ungefähr 2,2–2,7 Kacheln
- 3×3-Footprint: gleiche Pixeldichte, nicht einfach ein 2×2-Motiv aufblasen
- 6–10 transparente Pixel Sicherheitsrand
- definierter Fußpunkt an der unteren Motivkante
- Häfen: vier echte Richtungen `up`, `down`, `left`, `right`

### Terrain

- logisches Raster: 32×32 Pixel, orthografische Draufsicht
- keine Lichtkante oder Schattenrichtung an den Bildrändern
- Varianten einer Bodenart teilen Grundton und Randdefinition
- bevorzugt gerichteter Wang-Satz; alternativ identische Randpixelreihen
- mindestens ein 4×4-Kacheltest ohne sichtbares Gitter vor der Integration

Der aktuelle Renderer hält bei allen sechs Varianten den Rand der ersten,
sicher nahtlosen Referenzkachel fest und mischt die übrigen Motive nur im
Inneren ein. Eine weltkoordinatenfeste Makrofarbmaske erzeugt darüber trockene,
feuchte, helle und dunkle Partien über mehrere Dutzend Kacheln. Materialkanten
folgen einer eindeutigen Hierarchie; nur eine Seite greift in die andere. Die
Wald-/Wiesenmaske wird ausschließlich für die Darstellung geglättet, damit
kleine Schachbrett-Inseln verschwinden, ohne Spielstände oder Bauplätze zu
verändern.

### Bäume und Kliffs

- Bäume: vollständige Silhouette mit Stammfuß; Breite:Höhe etwa 0,45–0,75
- Wald entsteht durch Gruppen und Lichtungen, nicht durch einen Baum je Kachel
- Kliffs: gerichtete Kanten, Innen- und Außenkurven; niemals ein perspektivisch
  bemaltes Volltile frei drehen

## Aktive Referenzqualität

- **Behalten:** Holzfäller, Lager, vollständige Eichen, Umschlagplatz, kleiner
  Hafen, Waren- und Handelsschiffsymbole.
- **Übergangslösung:** saubere v0.1-Wohnhäuser, ein Getreidefeld, vollständige
  v0.1-Kiefern, zusammengesetzter großer Hafen.
- **Neu zeichnen:** großer Hafen in vier Richtungen, drei weitere Feldstadien,
  gerichtete Kliffs, finaler untereinander kantenkompatibler Terrain-Satz.
- **Nur Kandidaten:** ältere reiche Gras-/Waldbodenmotive unter
  `art/candidates/legacy-terrain`.
- **Nicht wieder aktivieren:** Dateien unter
  `art/archive/rejected-runtime-assets`.

Die vollständige Herkunfts- und Qualitätsinventur steht in
`docs/asset-audit.md`; die konkreten Einzelprompts in `tools/atlas-prompt.md`.
