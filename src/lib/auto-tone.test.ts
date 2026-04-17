import { describe, expect, it } from 'vitest';
import { suggestEq } from './auto-tone';

describe('auto-tone / suggestEq', () => {
  it('returns 0 dB in all bands for a perfectly flat analysis', () => {
    const eq = suggestEq({ bassEnergy: 1 / 3, midEnergy: 1 / 3, trebleEnergy: 1 / 3 });
    expect(eq.bass).toBeCloseTo(0, 5);
    expect(eq.mid).toBeCloseTo(0, 5);
    expect(eq.treble).toBeCloseTo(0, 5);
  });

  it('boosts the under-represented band and cuts the dominant one', () => {
    // Mid-heavy input (60% mid, 20% bass, 20% treble) — we expect:
    //  - mid   : positive dB (above neutral 1/3)
    //  - bass  : negative dB (below neutral 1/3)
    //  - treble: negative dB (below neutral 1/3)
    const eq = suggestEq({ bassEnergy: 0.2, midEnergy: 0.6, trebleEnergy: 0.2 });
    expect(eq.mid).toBeGreaterThan(0);
    expect(eq.bass).toBeLessThan(0);
    expect(eq.treble).toBeLessThan(0);
  });

  it('clamps extreme cuts to −12 dB (reachable: bass = 0)', () => {
    // A band at 0 energy would compute to −∞ dB — must clamp.
    const eq = suggestEq({ bassEnergy: 0, midEnergy: 0.5, trebleEnergy: 0.5 });
    expect(eq.bass).toBe(-12);
  });

  it('clamps defensively at +12 dB when input exceeds normalised 0..1', () => {
    // suggestEq expects normalised inputs; if a caller hands us raw
    // magnitudes > 1/3·reference, we clamp instead of returning +∞ dB.
    const eq = suggestEq({ bassEnergy: 10, midEnergy: 0.0001, trebleEnergy: 0.0001 });
    expect(eq.bass).toBe(12);
    expect(eq.mid).toBe(-12);
  });

  it('is symmetric in sign: doubling a band gives ~+6 dB', () => {
    const eq = suggestEq({ bassEnergy: 2 / 3, midEnergy: 1 / 6, trebleEnergy: 1 / 6 });
    // 20*log10(2) ≈ 6.02
    expect(eq.bass).toBeGreaterThan(5.5);
    expect(eq.bass).toBeLessThan(6.5);
  });
});
