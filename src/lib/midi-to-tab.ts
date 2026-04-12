/**
 * Convert detected MIDI notes into guitar fret positions.
 *
 * The hard problem: any MIDI note can be played at multiple positions on a
 * guitar. E.g. E4 (MIDI 64) can be played on:
 *   - String 1 (high E) open
 *   - String 2 (B) fret 5
 *   - String 3 (G) fret 9
 *   - String 4 (D) fret 14
 *   - String 5 (A) fret 19
 *
 * Choosing the "right" position depends on context — where the hand was, what
 * comes next, chord shapes, open-string preference, etc.
 *
 * This file provides THREE strategies:
 *   1. `assignLowest` — naive: lowest fret for each note, independently.
 *   2. `assignGreedy` — greedy with memory: minimize movement from prev note.
 *   3. `assignViterbi` — dynamic programming, globally optimal per cost model.
 *
 * The Viterbi strategy is the production default. The greedy one is a useful
 * baseline for debugging. The lowest one is a sanity check.
 */

import type { DetectedNote, FretPosition, TabNote, Tuning } from './types';
import { MAX_FRET } from './guitarTunings';

// ───── Cost weights ─────
// These control how the algorithm trades off different concerns. Tweaking them
// changes the "feel" of the output significantly. See assignViterbi() for use.
export interface FretCostWeights {
  /** Penalty per fret of movement from the previous note. */
  movement: number;
  /** Penalty for changing string (rewards sequences on the same string). */
  stringChange: number;
  /** Penalty per fret above fret 5 (prefers low positions). */
  highFretPenalty: number;
  /** Bonus (negative cost) for open strings. */
  openStringBonus: number;
  /** Penalty for notes that can't be played at all. */
  impossiblePenalty: number;
}

export const DEFAULT_COST_WEIGHTS: FretCostWeights = {
  movement: 1.0,
  stringChange: 0.6,
  highFretPenalty: 0.15,
  openStringBonus: -1.5,
  impossiblePenalty: 1000,
};

/**
 * All fret positions that can produce `pitchMidi` on the given tuning.
 *
 * Optional `allowedStrings` = [min, max] restricts the search to a specific
 * range of strings (useful for chord-melody arrangements where the melody
 * lives on the high strings and the bass on the low strings). String indices
 * follow our convention: 0 = low/thick (string 6), 5 = high/thin (string 1).
 */
export function possiblePositions(
  pitchMidi: number,
  tuning: Tuning,
  allowedStrings?: [number, number],
): FretPosition[] {
  const out: FretPosition[] = [];
  const minString = allowedStrings?.[0] ?? 0;
  const maxString = allowedStrings?.[1] ?? tuning.strings.length - 1;
  for (let stringIndex = minString; stringIndex <= maxString; stringIndex++) {
    const fret = pitchMidi - tuning.strings[stringIndex];
    if (fret >= 0 && fret <= MAX_FRET) {
      out.push({ stringIndex, fret });
    }
  }
  return out;
}

/** Strategy 1: pick the lowest-fret playable position, independently per note. */
export function assignLowest(
  notes: DetectedNote[],
  tuning: Tuning,
): TabNote[] {
  const out: TabNote[] = [];
  for (const note of notes) {
    const candidates = possiblePositions(note.pitchMidi, tuning);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => a.fret - b.fret);
    const chosen = candidates[0];
    out.push({
      ...chosen,
      startTimeSeconds: note.startTimeSeconds,
      durationSeconds: note.durationSeconds,
      pitchMidi: note.pitchMidi,
    });
  }
  return out;
}

/** Strategy 2: greedy with memory — minimize fret distance from previous note. */
export function assignGreedy(
  notes: DetectedNote[],
  tuning: Tuning,
  weights: FretCostWeights = DEFAULT_COST_WEIGHTS,
): TabNote[] {
  const out: TabNote[] = [];
  let lastPos: FretPosition | null = null;

  for (const note of notes) {
    const candidates = possiblePositions(note.pitchMidi, tuning);
    if (candidates.length === 0) continue;

    let best = candidates[0];
    let bestCost = Infinity;
    for (const c of candidates) {
      const cost = positionCost(lastPos, c, weights);
      if (cost < bestCost) {
        bestCost = cost;
        best = c;
      }
    }

    out.push({
      ...best,
      startTimeSeconds: note.startTimeSeconds,
      durationSeconds: note.durationSeconds,
      pitchMidi: note.pitchMidi,
    });
    lastPos = best;
  }

  return out;
}

/**
 * Strategy 3: Viterbi — dynamic programming over the whole sequence.
 *
 * For each note, each possible position is a state. We find the globally
 * optimal sequence of states that minimizes the sum of transition costs.
 *
 * Complexity: O(n × k²) where k ≤ 6 positions per note. For a 10 000-note
 * transcription that's ~360k ops — runs in <50ms on any device.
 */
export function assignViterbi(
  notes: DetectedNote[],
  tuning: Tuning,
  weights: FretCostWeights = DEFAULT_COST_WEIGHTS,
  allowedStrings?: [number, number],
): TabNote[] {
  if (notes.length === 0) return [];

  // Precompute candidates for each note. The `allowedStrings` range lets the
  // caller force a note onto a subset of strings (e.g. melody on strings 1-3,
  // bass on strings 4-6).
  const candidates = notes.map((n) =>
    possiblePositions(n.pitchMidi, tuning, allowedStrings),
  );

  // dp[i][j] = min cost to reach position j of note i.
  // back[i][j] = index of the best predecessor position at note i-1.
  const dp: number[][] = [];
  const back: number[][] = [];

  // Initialize with position-only cost for the first note.
  dp[0] = candidates[0].map((c) => positionCost(null, c, weights));
  back[0] = candidates[0].map(() => -1);

  // Forward pass.
  for (let i = 1; i < notes.length; i++) {
    const prevCands = candidates[i - 1];
    const currCands = candidates[i];
    dp[i] = new Array(currCands.length).fill(Infinity);
    back[i] = new Array(currCands.length).fill(-1);

    for (let j = 0; j < currCands.length; j++) {
      for (let k = 0; k < prevCands.length; k++) {
        const cost =
          dp[i - 1][k] + positionCost(prevCands[k], currCands[j], weights);
        if (cost < dp[i][j]) {
          dp[i][j] = cost;
          back[i][j] = k;
        }
      }
    }
  }

  // Backtrack from the cheapest final state.
  const last = dp[notes.length - 1];
  if (!last || last.length === 0) {
    // No playable notes at all — fall back to the naive strategy.
    return assignLowest(notes, tuning);
  }
  let bestFinal = 0;
  for (let j = 1; j < last.length; j++) {
    if (last[j] < last[bestFinal]) bestFinal = j;
  }

  const chosenIdx: number[] = new Array(notes.length).fill(0);
  chosenIdx[notes.length - 1] = bestFinal;
  for (let i = notes.length - 1; i > 0; i--) {
    chosenIdx[i - 1] = back[i][chosenIdx[i]];
  }

  return notes
    .map((note, i) => {
      const cands = candidates[i];
      if (cands.length === 0) return null;
      const pos = cands[chosenIdx[i]];
      return {
        ...pos,
        startTimeSeconds: note.startTimeSeconds,
        durationSeconds: note.durationSeconds,
        pitchMidi: note.pitchMidi,
      };
    })
    .filter((n): n is TabNote => n !== null);
}

/**
 * Cost of transitioning from `prev` to `curr`. `prev === null` for the first
 * note in the sequence (no movement cost, only position-only terms apply).
 */
function positionCost(
  prev: FretPosition | null,
  curr: FretPosition,
  w: FretCostWeights,
): number {
  let cost = 0;

  // Position-only terms.
  if (curr.fret === 0) {
    cost += w.openStringBonus;
  } else if (curr.fret > 5) {
    cost += (curr.fret - 5) * w.highFretPenalty;
  }

  // Movement terms (only if we have a previous note).
  if (prev) {
    cost += Math.abs(curr.fret - prev.fret) * w.movement;
    if (prev.stringIndex !== curr.stringIndex) {
      cost += w.stringChange;
    }
  }

  return cost;
}

/** Group TabNotes by simultaneous onset (for chord detection). */
export function groupChords(
  notes: TabNote[],
  toleranceSeconds = 0.04,
): TabNote[][] {
  if (notes.length === 0) return [];
  const sorted = [...notes].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds,
  );
  const groups: TabNote[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = groups[groups.length - 1][0];
    if (
      Math.abs(sorted[i].startTimeSeconds - prev.startTimeSeconds) <=
      toleranceSeconds
    ) {
      groups[groups.length - 1].push(sorted[i]);
    } else {
      groups.push([sorted[i]]);
    }
  }
  return groups;
}
