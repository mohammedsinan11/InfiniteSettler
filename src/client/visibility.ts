import { tileKey } from '../sim/coords';

/**
 * Ein grober Fog-Block darf nur dann offen bleiben, wenn JEDE enthaltene
 * Kachel entdeckt wurde. Bei weitem Zoom werden mehrere Tiles gemeinsam
 * gezeichnet; nur die linke obere Kachel zu prüfen würde dabei unbekanntes
 * Gelände an den übrigen Stellen verraten.
 */
export function fogBlockFullyExplored(
  explored: ReadonlySet<string>,
  x: number,
  y: number,
  size: number,
): boolean {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      if (!explored.has(tileKey(x + dx, y + dy))) return false;
    }
  }
  return true;
}
