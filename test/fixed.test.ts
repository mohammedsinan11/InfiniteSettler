import { describe, expect, it } from 'vitest';
import {
  FP_ONE,
  div,
  fromFloat,
  fromInt,
  isqrt,
  lerp,
  mul,
  smoothstep,
  toInt,
} from '../src/sim/fixed';

describe('fixed point', () => {
  it('konvertiert ganze Zahlen verlustfrei', () => {
    for (const n of [0, 1, -1, 7, -7, 1000, -1000]) {
      expect(toInt(fromInt(n))).toBe(n);
    }
  });

  it('multipliziert korrekt, auch negativ', () => {
    expect(mul(FP_ONE, FP_ONE)).toBe(FP_ONE);
    expect(mul(FP_ONE, FP_ONE / 2)).toBe(FP_ONE / 2);
    expect(mul(FP_ONE / 2, FP_ONE / 2)).toBe(FP_ONE / 4);
    expect(mul(-FP_ONE, FP_ONE)).toBe(-FP_ONE);
    expect(mul(-FP_ONE / 2, FP_ONE)).toBe(-FP_ONE / 2);
    expect(mul(-FP_ONE / 2, -FP_ONE / 2)).toBe(FP_ONE / 4);
  });

  it('haelt mul bei grossen Operanden exakt', () => {
    // 300 * 100: das Zwischenprodukt der Rohwerte ist ~1.3e15 und wuerde bei
    // naiver Multiplikation die exakte Ganzzahlreichweite von double sprengen.
    expect(toInt(mul(fromInt(300), fromInt(100)))).toBe(30000);
    expect(toInt(mul(fromInt(-300), fromInt(100)))).toBe(-30000);
    expect(toInt(mul(fromInt(181), fromInt(181)))).toBe(32761);
  });

  it('laeuft ausserhalb von +/-32768 sauber ueber', () => {
    // 16.16 kann nur +/-32768 darstellen. Der Ueberlauf ist kein Bug, sondern
    // die Formatgrenze - er muss aber auf jeder Engine gleich passieren,
    // sonst waere er eine Desync-Quelle.
    expect(mul(fromInt(300), fromInt(200))).toBe(mul(fromInt(300), fromInt(200)));
    expect(toInt(mul(fromInt(300), fromInt(200)))).toBe(60000 - 65536);
  });

  it('dividiert korrekt', () => {
    expect(div(FP_ONE, FP_ONE)).toBe(FP_ONE);
    expect(div(fromInt(10), fromInt(4))).toBe(fromFloat(2.5));
    expect(div(fromInt(-10), fromInt(4))).toBe(fromFloat(-2.5));
    expect(div(FP_ONE, 0)).toBe(0);
  });

  it('lerp trifft die Endpunkte', () => {
    const a = fromInt(10);
    const b = fromInt(20);
    expect(lerp(a, b, 0)).toBe(a);
    expect(lerp(a, b, FP_ONE)).toBe(b);
    expect(lerp(a, b, FP_ONE / 2)).toBe(fromInt(15));
  });

  it('smoothstep ist an den Raendern 0 und 1', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(FP_ONE)).toBe(FP_ONE);
    expect(smoothstep(FP_ONE / 2)).toBe(FP_ONE / 2);
  });

  it('isqrt ist exakt und ohne Math.sqrt', () => {
    for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 9999, 1 << 20, 2 ** 40]) {
      const r = isqrt(n);
      expect(r * r).toBeLessThanOrEqual(n);
      expect((r + 1) * (r + 1)).toBeGreaterThan(n);
    }
  });
});
