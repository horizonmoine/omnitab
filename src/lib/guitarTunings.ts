import type { Tuning } from './types';

/**
 * Guitar tunings. Strings are ordered from 6 (low/bass) → 1 (high/treble).
 *
 * MIDI cheat sheet:
 *   E2 = 40   F2 = 41   G2 = 43   A2 = 45   B2 = 47
 *   C3 = 48   D3 = 50   E3 = 52   F3 = 53   G3 = 55
 *   A3 = 57   B3 = 59   C4 = 60   D4 = 62   E4 = 64
 */
export const TUNINGS: Record<string, Tuning> = {
  standard: {
    id: 'standard',
    name: 'Standard (E A D G B E)',
    strings: [40, 45, 50, 55, 59, 64],
  },
  dropD: {
    id: 'dropD',
    name: 'Drop D (D A D G B E)',
    strings: [38, 45, 50, 55, 59, 64],
  },
  dropC: {
    id: 'dropC',
    name: 'Drop C (C G C F A D)',
    strings: [36, 43, 48, 53, 57, 62],
  },
  halfStepDown: {
    id: 'halfStepDown',
    name: 'Half step down (Eb Ab Db Gb Bb Eb)',
    strings: [39, 44, 49, 54, 58, 63],
  },
  fullStepDown: {
    id: 'fullStepDown',
    name: 'Full step down (D G C F A D)',
    strings: [38, 43, 48, 53, 57, 62],
  },
  openG: {
    id: 'openG',
    name: 'Open G (D G D G B D)',
    strings: [38, 43, 50, 55, 59, 62],
  },
  openD: {
    id: 'openD',
    name: 'Open D (D A D F# A D)',
    strings: [38, 45, 50, 54, 57, 62],
  },
  dadgad: {
    id: 'dadgad',
    name: 'DADGAD (D A D G A D)',
    strings: [38, 45, 50, 55, 57, 62],
  },
};

export const DEFAULT_TUNING = TUNINGS.standard;
export const MAX_FRET = 22;

/** Apply a capo by raising every open-string MIDI value by `capoFret`. */
export function applyCapo(tuning: Tuning, capoFret: number): Tuning {
  if (capoFret <= 0) return tuning;
  return {
    id: `${tuning.id}+capo${capoFret}`,
    name: `${tuning.name} + Capo ${capoFret}`,
    strings: tuning.strings.map((midi) => midi + capoFret),
  };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES[midi % 12];
  return `${name}${octave}`;
}

export function midiToFrequency(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export function frequencyToMidi(freq: number, a4 = 440): number {
  return 69 + 12 * Math.log2(freq / a4);
}

/** Nearest note name + cents deviation for a given frequency. */
export function analyzeFrequency(
  freq: number,
  a4 = 440,
): { midi: number; note: string; cents: number } {
  const exactMidi = frequencyToMidi(freq, a4);
  const nearestMidi = Math.round(exactMidi);
  const cents = Math.round((exactMidi - nearestMidi) * 100);
  return {
    midi: nearestMidi,
    note: midiToNoteName(nearestMidi),
    cents,
  };
}
