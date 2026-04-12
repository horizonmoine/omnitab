/**
 * Regression tests for the MIDI → tab placement algorithms.
 *
 * These are the bits of the app where silent bugs hurt most — a bad Viterbi
 * cost tweak can ruin every transcription without any crash. Run with:
 *     npm run test
 */

import { describe, expect, it } from 'vitest';
import {
  assignGreedy,
  assignLowest,
  assignViterbi,
  groupChords,
  possiblePositions,
} from './midi-to-tab';
import { TUNINGS } from './guitarTunings';
import type { DetectedNote } from './types';

const std = TUNINGS.standard;

/** Shorthand for building a detected note. */
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

describe('possiblePositions', () => {
  it('returns all playable positions for E4 in standard tuning', () => {
    // E4 = MIDI 64. In standard (E2 A2 D3 G3 B3 E4) it can be played at:
    //   string 5 (E4) fret 0
    //   string 4 (B3) fret 5
    //   string 3 (G3) fret 9
    //   string 2 (D3) fret 14
    //   string 1 (A2) fret 19
    //   string 0 (E2) fret 24  ← beyond MAX_FRET (22) so excluded
    const positions = possiblePositions(64, std);
    expect(positions).toHaveLength(5);
    expect(positions).toContainEqual({ stringIndex: 5, fret: 0 });
    expect(positions).toContainEqual({ stringIndex: 4, fret: 5 });
    expect(positions).toContainEqual({ stringIndex: 3, fret: 9 });
  });

  it('returns empty for notes below the lowest string', () => {
    // D2 (MIDI 38) is below low E (MIDI 40) in standard tuning.
    expect(possiblePositions(38, std)).toEqual([]);
  });

  it('respects allowedStrings constraint', () => {
    // E4 restricted to low strings [0, 2] = low E, A, D. Only the high
    // positions on those strings qualify.
    const positions = possiblePositions(64, std, [0, 2]);
    expect(positions.every((p) => p.stringIndex >= 0 && p.stringIndex <= 2))
      .toBe(true);
    // E4 on D3 string is fret 14, on A2 fret 19 → both inside MAX_FRET.
    expect(positions).toContainEqual({ stringIndex: 2, fret: 14 });
    expect(positions).toContainEqual({ stringIndex: 1, fret: 19 });
  });

  it('allowedStrings = [3,5] excludes the bass register', () => {
    // C3 (MIDI 48) on the high strings [3,5] is not playable —
    // lowest pitch on string 3 (G3) is MIDI 55.
    expect(possiblePositions(48, std, [3, 5])).toEqual([]);
  });
});

describe('assignLowest', () => {
  it('picks the lowest fret for each note independently', () => {
    const notes = [n(64, 0), n(65, 0.5)]; // E4, F4
    const tabs = assignLowest(notes, std);
    expect(tabs).toHaveLength(2);
    // E4 on high E string, fret 0 is lowest.
    expect(tabs[0]).toMatchObject({ stringIndex: 5, fret: 0 });
    // F4 on high E string, fret 1.
    expect(tabs[1]).toMatchObject({ stringIndex: 5, fret: 1 });
  });

  it('drops notes that are not playable at all', () => {
    const notes = [n(20, 0), n(64, 0.25)]; // unplayable + E4
    const tabs = assignLowest(notes, std);
    expect(tabs).toHaveLength(1);
    expect(tabs[0].pitchMidi).toBe(64);
  });
});

describe('assignGreedy', () => {
  it('prefers staying on the same string when close', () => {
    // Playing E4 → G4 → A4: greedy should keep them on the high E string
    // rather than jumping across strings.
    const notes = [n(64, 0), n(67, 0.25), n(69, 0.5)];
    const tabs = assignGreedy(notes, std);
    expect(tabs).toHaveLength(3);
    expect(tabs[0].stringIndex).toBe(5);
    expect(tabs[1].stringIndex).toBe(5);
    expect(tabs[2].stringIndex).toBe(5);
  });
});

describe('assignViterbi', () => {
  it('returns an empty array for empty input', () => {
    expect(assignViterbi([], std)).toEqual([]);
  });

  it('finds a globally optimal placement on a simple melody', () => {
    // Same E4 → G4 → A4 run. Viterbi should also stay on the same string.
    const notes = [n(64, 0), n(67, 0.25), n(69, 0.5)];
    const tabs = assignViterbi(notes, std);
    expect(tabs).toHaveLength(3);
    // All three notes placed on the high E string (index 5) is optimal
    // because movement cost > string change cost in DEFAULT_COST_WEIGHTS.
    for (const t of tabs) {
      expect(t.stringIndex).toBe(5);
    }
  });

  it('prefers open strings when available', () => {
    // A single E4 — should pick the open high E string (fret 0).
    const tabs = assignViterbi([n(64, 0)], std);
    expect(tabs[0]).toMatchObject({ stringIndex: 5, fret: 0 });
  });

  it('falls back to lowest strategy when no notes are playable', () => {
    // All notes below low E → nothing is playable → empty result.
    const notes = [n(30, 0), n(32, 0.25)];
    expect(assignViterbi(notes, std)).toEqual([]);
  });

  it('respects allowedStrings = [3,5] for a melody', () => {
    // A scale run that would normally use low strings — force it high.
    const notes = [n(60, 0), n(62, 0.25), n(64, 0.5)]; // C4 D4 E4
    const tabs = assignViterbi(notes, std, undefined, [3, 5]);
    expect(tabs).toHaveLength(3);
    // Every note must be on strings 3, 4, or 5.
    for (const t of tabs) {
      expect(t.stringIndex).toBeGreaterThanOrEqual(3);
      expect(t.stringIndex).toBeLessThanOrEqual(5);
    }
  });

  it('respects allowedStrings = [0,2] for a bass line', () => {
    const notes = [n(45, 0), n(48, 0.5), n(50, 1)]; // A2 C3 D3
    const tabs = assignViterbi(notes, std, undefined, [0, 2]);
    expect(tabs).toHaveLength(3);
    for (const t of tabs) {
      expect(t.stringIndex).toBeGreaterThanOrEqual(0);
      expect(t.stringIndex).toBeLessThanOrEqual(2);
    }
  });

  it('preserves timing and pitch information on the output notes', () => {
    const tabs = assignViterbi([n(64, 1.5, 0.3)], std);
    expect(tabs[0].startTimeSeconds).toBe(1.5);
    expect(tabs[0].durationSeconds).toBe(0.3);
    expect(tabs[0].pitchMidi).toBe(64);
  });
});

describe('groupChords', () => {
  it('groups notes with near-simultaneous onsets', () => {
    const tabs = assignViterbi(
      [n(60, 0), n(64, 0.01), n(67, 0.02), n(72, 1.0)],
      std,
    );
    const groups = groupChords(tabs, 0.05);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveLength(3);
    expect(groups[1]).toHaveLength(1);
  });

  it('returns empty for empty input', () => {
    expect(groupChords([])).toEqual([]);
  });
});
