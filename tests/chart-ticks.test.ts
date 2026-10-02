import { describe, it, expect } from 'vitest';
import {
  niceTicks,
  logTicks,
  formatTick,
  formatLogTick,
  tickLabelText,
  decimalsForStep,
  formatReadout,
} from '../src/chart/ticks';

describe('niceTicks', () => {
  it('produces 1-2-5 steps within range and limit', () => {
    const r = niceTicks(0, 50, 6);
    expect(r.step).toBe(10);
    expect(r.ticks).toEqual([0, 10, 20, 30, 40, 50]);
    expect(r.ticks.length).toBeLessThanOrEqual(6);
  });

  it('never exceeds maxTicks for assorted ranges', () => {
    for (const [a, b] of [[0, 1], [0.0123, 0.0987], [-3.3, 7.1], [1e5, 9.9e5], [-2e-4, -1e-5], [0, 49.9]]) {
      for (const n of [2, 3, 5, 8, 12]) {
        const r = niceTicks(a, b, n);
        expect(r.ticks.length).toBeLessThanOrEqual(n);
        if (n >= 5) expect(r.ticks.length).toBeGreaterThanOrEqual(1);
        for (const t of r.ticks) {
          expect(t).toBeGreaterThanOrEqual(a - 1e-9 * (b - a));
          expect(t).toBeLessThanOrEqual(b + 1e-9 * (b - a));
        }
      }
    }
  });

  it('avoids floating point noise', () => {
    const r = niceTicks(0, 0.3, 4);
    expect(r.ticks).toEqual([0, 0.1, 0.2, 0.3]);
  });

  it('handles negative ranges and ranges that cross zero', () => {
    const r = niceTicks(-0.2, 1, 8);
    expect(r.ticks).toContain(0);
    expect(r.ticks).toContain(1);
    expect(r.ticks[0]).toBeCloseTo(-0.2);
  });

  it('minor ticks do not coincide with major ticks and lie within range', () => {
    const r = niceTicks(0, 50, 6);
    expect(r.minor.length).toBeGreaterThan(0);
    for (const m of r.minor) {
      expect(r.ticks).not.toContain(m);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(50);
    }
    // 5 subdivisions of a step of 10 -> minor every 2
    expect(r.minor).toContain(2);
  });

  it('is robust to degenerate input', () => {
    expect(niceTicks(5, 5, 6).ticks).toEqual([5]);
    expect(niceTicks(NaN, 1, 6).ticks).toEqual([]);
    expect(niceTicks(0, Infinity, 6).ticks).toEqual([]);
    expect(niceTicks(10, 0, 6).ticks.length).toBeGreaterThan(1); // swapped
    expect(niceTicks(0, 1, 0).ticks.length).toBeLessThanOrEqual(2);
  });

  it('works for tiny and huge magnitudes', () => {
    const t = niceTicks(1e-9, 5e-9, 5);
    expect(t.ticks.length).toBeGreaterThanOrEqual(3);
    const h = niceTicks(0, 3e8, 6);
    expect(h.ticks[h.ticks.length - 1]).toBeLessThanOrEqual(3e8);
  });
});

describe('logTicks', () => {
  it('returns decades with minor 2..9 ticks', () => {
    const r = logTicks(1, 1000);
    expect(r.linear).toBe(false);
    expect(r.ticks).toEqual([1, 10, 100, 1000]);
    expect(r.minor).toContain(2);
    expect(r.minor).toContain(900);
    expect(r.minor).not.toContain(10);
    expect(r.minor.length).toBe(8 * 3);
  });

  it('only includes decades inside the range', () => {
    const r = logTicks(3, 5000);
    expect(r.ticks).toEqual([10, 100, 1000]);
    expect(r.minor).toContain(3);
    expect(r.minor).toContain(5000);
    expect(r.minor).not.toContain(2);
    expect(r.minor).not.toContain(6000);
  });

  it('thins decade labels over many decades', () => {
    const r = logTicks(1e-20, 1e20, 8);
    expect(r.ticks.length).toBeLessThanOrEqual(8);
    expect(r.minor).toEqual([]);
  });

  it('uses 1-2-5 labels in less than two decades', () => {
    const r = logTicks(1.5, 60);
    expect(r.ticks).toEqual([2, 5, 10, 20, 50]);
  });

  it('falls back to linear for very narrow ranges', () => {
    const r = logTicks(1.2, 1.3);
    expect(r.linear).toBe(true);
    expect(r.ticks.length).toBeGreaterThan(1);
  });

  it('rejects non-positive ranges', () => {
    expect(logTicks(0, 10).ticks).toEqual([]);
    expect(logTicks(-1, 10).ticks).toEqual([]);
  });
});

describe('formatTick', () => {
  const s = (v: number, step: number) => tickLabelText(formatTick(v, step));

  it('uses at least one decimal', () => {
    expect(s(0, 10)).toBe('0.0');
    expect(s(10, 10)).toBe('10.0');
    expect(s(30, 10)).toBe('30.0');
    expect(s(1, 1)).toBe('1.0');
    expect(s(0.5, 0.5)).toBe('0.5');
    expect(s(1.5, 0.5)).toBe('1.5');
  });

  it('derives decimals from the step', () => {
    expect(s(0.035, 0.005)).toBe('0.035');
    expect(s(0.055, 0.005)).toBe('0.055');
    expect(s(0.05, 0.005)).toBe('0.050');
    expect(s(0.008, 0.002)).toBe('0.008');
    expect(s(0.2, 0.2)).toBe('0.2');
    expect(s(0.25, 0.25)).toBe('0.25');
    expect(s(12, 2)).toBe('12.0');
  });

  it('handles negatives and avoids -0.0', () => {
    expect(s(-0.5, 0.5)).toBe('-0.5');
    expect(s(-1e-17, 0.5)).toBe('0.0');
    expect(s(-0, 1)).toBe('0.0');
  });

  it('uses mantissa form for small values', () => {
    expect(formatTick(-2.5e-4, 5e-5)).toEqual({ mantissa: '-2.5x10', exponent: '-4' });
    expect(formatTick(-2e-4, 5e-5)).toEqual({ mantissa: '-2.0x10', exponent: '-4' });
    expect(formatTick(2.5e-4, 5e-5)).toEqual({ mantissa: '2.5x10', exponent: '-4' });
    expect(formatTick(1.25e-4, 2.5e-5).mantissa).toBe('1.25x10');
    expect(formatTick(5e-7, 1e-7)).toEqual({ mantissa: '5.0x10', exponent: '-7' });
  });

  it('uses mantissa form for large values', () => {
    expect(formatTick(1e5, 1e5)).toEqual({ mantissa: '1.0x10', exponent: '5' });
    expect(formatTick(2.5e5, 5e4)).toEqual({ mantissa: '2.5x10', exponent: '5' });
    expect(formatTick(3e8, 1e8)).toEqual({ mantissa: '3.0x10', exponent: '8' });
    expect(formatTick(-1e6, 1e6)).toEqual({ mantissa: '-1.0x10', exponent: '6' });
  });

  it('switches at the documented thresholds', () => {
    expect(formatTick(99999, 1).exponent).toBeUndefined();
    expect(formatTick(100000, 1).exponent).toBe('5');
    expect(formatTick(0.001, 0.001).exponent).toBeUndefined();
    expect(s(0.001, 0.001)).toBe('0.001');
    expect(formatTick(0.00099, 0.0001).exponent).toBe('-4');
  });

  it('renormalises mantissas that round up to 10', () => {
    const l = formatTick(9.99e-5, 1e-3);
    expect(l.exponent).toBe('-4');
    expect(Number(l.mantissa.replace('x10', ''))).toBeLessThan(10);
  });

  it('does not throw on non-finite values', () => {
    expect(() => formatTick(NaN, 1)).not.toThrow();
    expect(() => formatTick(Infinity, 1)).not.toThrow();
    expect(() => formatTick(1, 0)).not.toThrow();
  });
});

describe('formatLogTick', () => {
  it('labels decades as 1.0x10^k', () => {
    expect(formatLogTick(1)).toEqual({ mantissa: '1.0x10', exponent: '0' });
    expect(formatLogTick(1000)).toEqual({ mantissa: '1.0x10', exponent: '3' });
    expect(formatLogTick(1e-3)).toEqual({ mantissa: '1.0x10', exponent: '-3' });
    expect(formatLogTick(1e5)).toEqual({ mantissa: '1.0x10', exponent: '5' });
  });
  it('labels 2 and 5 multiples', () => {
    expect(formatLogTick(2e4)).toEqual({ mantissa: '2.0x10', exponent: '4' });
    expect(formatLogTick(5e-2)).toEqual({ mantissa: '5.0x10', exponent: '-2' });
  });
});

describe('misc helpers', () => {
  it('decimalsForStep', () => {
    expect(decimalsForStep(10)).toBe(1);
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(0.05)).toBe(2);
    expect(decimalsForStep(0.0005)).toBe(4);
  });
  it('formatReadout', () => {
    expect(formatReadout(0)).toBe('0');
    expect(formatReadout(21.3456789)).toBe('21.3457');
    expect(formatReadout(1.5e-5)).toBe('1.500e-5');
  });
});
