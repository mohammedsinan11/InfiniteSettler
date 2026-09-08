/**
 * A* auf der 4er-Nachbarschaft. Begehbar sind Strassen- und Gebaeudetiles.
 *
 * Determinismus: die Nachbarn werden immer in derselben Reihenfolge
 * expandiert und der Heap bricht Gleichstaende ueber einen aufsteigenden
 * Zaehler auf. Damit ist der gefundene Pfad bei gleicher Eingabe immer
 * exakt derselbe - nicht nur gleich lang.
 */

import { NEIGHBORS, tileKey } from './coords';
import { isWalkable, type World } from './state';

const MAX_NODES = 6000;

interface HeapItem {
  f: number;
  seq: number;
  x: number;
  y: number;
}

class MinHeap {
  private a: HeapItem[] = [];

  get size(): number {
    return this.a.length;
  }

  push(item: HeapItem): void {
    const a = this.a;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (less(a[i], a[p])) {
        const t = a[i];
        a[i] = a[p];
        a[p] = t;
        i = p;
      } else break;
    }
  }

  pop(): HeapItem | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop() as HeapItem;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
        if (m === i) break;
        const t = a[i];
        a[i] = a[m];
        a[m] = t;
        i = m;
      }
    }
    return top;
  }
}

const less = (a: HeapItem, b: HeapItem): boolean =>
  a.f !== b.f ? a.f < b.f : a.seq < b.seq;

const manhattan = (ax: number, ay: number, bx: number, by: number): number =>
  Math.abs(ax - bx) + Math.abs(ay - by);

/**
 * Liefert den Pfad als flaches [x0,y0,x1,y1,...] inklusive Start und Ziel,
 * oder null wenn keine Verbindung existiert.
 */
export function findPath(
  world: World,
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  /**
   * Was als begehbar gilt. Standard sind Strassen und Gebaeude; Schiffe
   * reichen stattdessen eine Wasserpruefung herein. Dadurch teilen sich
   * Land- und Seewege dieselbe Wegfindung - nur die Frage "darf ich hier
   * lang" unterscheidet sich.
   */
  passable: (world: World, x: number, y: number) => boolean = isWalkable,
): number[] | null {
  if (sx === tx && sy === ty) return [sx, sy];
  if (!passable(world, sx, sy) || !passable(world, tx, ty)) return null;

  const startKey = tileKey(sx, sy);
  const goalKey = tileKey(tx, ty);

  const gScore = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, string>();
  const closed = new Set<string>();
  const open = new MinHeap();

  let seq = 0;
  let expanded = 0;
  open.push({ f: manhattan(sx, sy, tx, ty), seq: seq++, x: sx, y: sy });

  while (open.size > 0) {
    const cur = open.pop() as HeapItem;
    const curKey = tileKey(cur.x, cur.y);
    if (closed.has(curKey)) continue;
    closed.add(curKey);

    if (curKey === goalKey) return rebuild(cameFrom, curKey);

    if (++expanded > MAX_NODES) return null;

    const g = gScore.get(curKey) as number;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const nKey = tileKey(nx, ny);
      if (closed.has(nKey)) continue;
      if (!passable(world, nx, ny)) continue;

      const ng = g + 1;
      const known = gScore.get(nKey);
      if (known !== undefined && known <= ng) continue;

      gScore.set(nKey, ng);
      cameFrom.set(nKey, curKey);
      open.push({ f: ng + manhattan(nx, ny, tx, ty), seq: seq++, x: nx, y: ny });
    }
  }

  return null;
}

function rebuild(cameFrom: Map<string, string>, goalKey: string): number[] {
  const keys: string[] = [goalKey];
  let cur = goalKey;
  for (;;) {
    const prev = cameFrom.get(cur);
    if (prev === undefined) break;
    keys.push(prev);
    cur = prev;
  }
  keys.reverse();

  const out: number[] = [];
  for (const k of keys) {
    const i = k.indexOf(',');
    out.push(Number(k.slice(0, i)), Number(k.slice(i + 1)));
  }
  return out;
}
