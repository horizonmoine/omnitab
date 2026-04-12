/**
 * Regression tests for extractMelodyAndAccompaniment() — the heart of the
 * Transcriber Mode B pipeline. Silent misbehaviour here would make every
 * "Chant + accords" tab sound wrong.
 */

import { describe, expect, it } from 'vitest';
import { extractMelodyAndAccompaniment } from './chord-melody';
import type { DetectedNote } from './types';

const n = (
  pitchMidi: number,
  startTimeSeconds: number,
  durationSeconds = 0.25,
): DetectedNote => ({
  pitchMidi,
  startTimeSeconds,
  durationSeconds,
  amplitude: 0.8,
});

describe('extractMelodyAndAccompaniment', () => {
  it('returns empty structure for empty input', () => {
    expect(extractMelodyAndAccompaniment([])).toEqual({
      melody: [],
      bass: [],
    });
  });

  it('picks the highest note per window as melody', () => {
    // Three-note chord at t=0: C3, E4, G4.
    //   G4 (67) is the highest → melody.
    //   C3 (48) is the lowest → bass (transposed if needed).
    const notes = [n(48, 0), n(64, 0), n(67, 0)]; // C3, E4, G4
    const { melody, bass } = extractMelodyAndAccompaniment(notes, {
      windowSeconds: 0.25,
    });
    expect(melody).toHaveLength(1);
    expect(melody[0].pitchMidi).toBe(67);
    expect(bass).toHaveLength(1);
    // C3 (MIDI 48) is already <= bassMaxMidi (55) and >= 40, so stays put.
    expect(bass[0].pitchMidi).toBe(48);
  });

  it('drops melody candidates below melodyMinMidi', () => {
    // All notes below C4 = no melody at all.
    const notes = [n(50, 0), n(52, 0.25), n(55, 0.5)];
    const { melody } = extractMelodyAndAccompaniment(notes);
    expect(melody).toHaveLength(0);
  });

  it('transposes high bass candidates down to the guitar bass register', () => {
    // A single-note window with A4 = MIDI 69 — no melody/bass distinction,
    // bass should still be empty because top === bottom.
    let result = extractMelodyAndAccompaniment([n(69, 0)]);
    expect(result.bass).toHaveLength(0);

    // Two-note window: high F5 melody + high E4 "bass" candidate.
    // E4 = 64, above bassMaxMidi (55) → algo subtracts octaves until ≤ 55.
    // 64 - 12 = 52 → in range.
    result = extractMelodyAndAccompaniment([n(77, 0), n(64, 0)]); // F5, E4
    expect(result.bass).toHaveLength(1);
    expect(result.bass[0].pitchMidi).toBe(52); // E4 → E3
  });

  it('transposes very low bass candidates up to at least E2', () => {
    // Melody high, "bass" very low (MIDI 24 = C1).
    // Algo: 24 is already < bassMaxMidi (55), but also < 40 → add 12 until ≥ 40.
    //   24 + 12 = 36 (< 40)
    //   36 + 12 = 48 (✓)
    const result = extractMelodyAndAccompaniment([n(72, 0), n(24, 0)]);
    expect(result.bass).toHaveLength(1);
    expect(result.bass[0].pitchMidi).toBe(48);
  });

  it('groups notes into their own time windows', () => {
    // Two well-separated attacks should produce two windows.
    const notes = [
      n(48, 0.0),
      n(72, 0.0), // window 1: bass C3 + melody C5
      n(50, 1.0),
      n(74, 1.0), // window 2: bass D3 + melody D5
    ];
    const result = extractMelodyAndAccompaniment(notes, {
      windowSeconds: 0.25,
    });
    expect(result.melody).toHaveLength(2);
    expect(result.bass).toHaveLength(2);
    expect(result.melody[0].pitchMidi).toBe(72);
    expect(result.melody[1].pitchMidi).toBe(74);
  });

  it('does not emit a bass note when the highest and lowest note are the same', () => {
    // Single high note → counts as melody only, no bass counterpart.
    const result = extractMelodyAndAccompaniment([n(72, 0)]);
    expect(result.melody).toHaveLength(1);
    expect(result.bass).toHaveLength(0);
  });

  it('accepts custom window size and thresholds', () => {
    const notes = [n(60, 0), n(48, 0)]; // C4, C3
    // Raise melodyMinMidi so C4 no longer qualifies.
    const result = extractMelodyAndAccompaniment(notes, {
      melodyMinMidi: 72,
    });
    expect(result.melody).toHaveLength(0);
    // C3 still counts as bass since bottom !== top.
    expect(result.bass).toHaveLength(1);
  });
});
