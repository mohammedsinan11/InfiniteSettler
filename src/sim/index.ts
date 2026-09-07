/**
 * Oeffentliche Schnittstelle der Simulation.
 *
 * Regeln fuer alles unter src/sim (mechanisch geprueft in test/boundary.test.ts):
 *   - keine Browser-API (window, document, canvas, ...)
 *   - kein Math.random, kein Date.now
 *   - keine engine-abhaengige Mathematik (sin, cos, pow, exp, log, sqrt)
 *   - keine Floats im Weltzustand
 *
 * Bekannte Grenze: Traegerpositionen liegen im 16.16-Format und damit im
 * Bereich +/-32768 Tiles um den Ursprung. Die KARTE ist davon nicht
 * betroffen (int32-Tiles), nur bewegte Einheiten. Wer weiter draussen
 * siedeln will, splittet die Position in Tile (int32) + Subtile-Offset.
 */

export * from './fixed';
export * from './hash';
export * from './rng';
export * from './coords';
export * from './noise';
export * from './terrain';
export * from './chunks';
export * from './types';
export * from './state';
export * from './pathfind';
export * from './economy';
export * from './commands';
export * from './tick';
export * from './serialize';
