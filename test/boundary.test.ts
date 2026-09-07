/**
 * Macht die Trennung von Simulation und Rendering mechanisch pruefbar
 * statt zu einer Frage der Disziplin.
 *
 * Jede hier verbotene Konstruktion wuerde die Simulation entweder
 * nicht-deterministisch machen (Math.random, Date.now, engine-abhaengige
 * Mathematik) oder sie an den Browser binden und damit sowohl Tests als
 * auch eine spaetere Portierung verhindern.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIM_DIR = join(import.meta.dirname, '..', 'src', 'sim');

const FORBIDDEN: Array<{ re: RegExp; why: string }> = [
  { re: /\bMath\.random\b/, why: 'nicht seedbar' },
  { re: /\bDate\.now\b/, why: 'Wanduhrzeit ist nicht reproduzierbar' },
  { re: /\bnew Date\b/, why: 'Wanduhrzeit ist nicht reproduzierbar' },
  { re: /\bperformance\.now\b/, why: 'Wanduhrzeit ist nicht reproduzierbar' },
  {
    re: /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|pow|exp|log|log2|log10|sqrt|cbrt|hypot)\b/,
    why: 'in ECMAScript nur als Naeherung spezifiziert, weicht zwischen Engines ab',
  },
  { re: /\bdocument\b/, why: 'Browser-API' },
  { re: /\bwindow\b/, why: 'Browser-API' },
  { re: /\brequestAnimationFrame\b/, why: 'Browser-API' },
  { re: /\blocalStorage\b/, why: 'Browser-API' },
  { re: /\bindexedDB\b/, why: 'Browser-API' },
  { re: /from '\.\.\/client/, why: 'Simulation darf den Client nicht kennen' },
];

/** Zeilenkommentare entfernen, damit die Erklaertexte nicht selbst anschlagen. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('sim/client-grenze', () => {
  const files = readdirSync(SIM_DIR).filter((f: string) => f.endsWith('.ts'));

  it('findet ueberhaupt Dateien', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(file + ' bleibt deterministisch und browserfrei', () => {
      const code = stripComments(readFileSync(join(SIM_DIR, file), 'utf8'));
      for (const { re, why } of FORBIDDEN) {
        const hit = re.exec(code);
        expect(hit === null, `${file}: "${hit?.[0]}" ist verboten (${why})`).toBe(true);
      }
    });
  }
});
