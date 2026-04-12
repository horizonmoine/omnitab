/**
 * Tempo detection from note onsets.
 *
 * Once basic-pitch has given us a list of DetectedNote with startTimeSeconds,
 * we can estimate the tempo WITHOUT re-analyzing the raw audio. The idea:
 *
 *   1. Compute inter-onset intervals (IOIs): time between each pair of
 *      consecutive attacks.
 *   2. Build a histogram weighted by IOI multiples — if the true beat is
 *      0.5s, we should see clusters at 0.25, 0.5, 1.0 (eighth, quarter, half).
 *   3. Convert the dominant period to BPM.
 *
 * This is cheap (O(n²) over notes, usually < 1000 of them) and produces
 * reasonable results for most monophonic or lightly polyphonic material.
 * For complex mixes with rubato, it degrades gracefully to the 120 default.
 *
 * Reference: the "simple autocorrelation of onsets" approach described in
 *   Dixon, "Automatic Extraction of Tempo and Beat From Expressive
 *   Performances" (2001), §3.
 */

import type { DetectedNote } from './types';

/** Tempo range we consider plausible for guitar recordings. */
const MIN_BPM = 60;
const MAX_BPM = 200;

/** Histogram bin width in seconds (5 ms = fine enough for 120 BPM ± 1). */
const BIN_WIDTH = 0.005;

export interface TempoResult {
  /** Best-guess tempo in beats per minute. */
  bpm: number;
  /** Confidence score 0..1 — below ~0.2 means "fall back to the default". */
  confidence: number;
}

/**
 * Estimate tempo from a list of detected notes.
 *
 * Returns { bpm: 120, confidence: 0 } for empty / single-note / silent input
 * so callers can just use it blindly and get a sane default.
 */
export function detectTempo(notes: DetectedNote[]): TempoResult {
  if (notes.length < 4) {
    return { bpm: 120, confidence: 0 };
  }

  // Sort onsets (basic-pitch usually returns them in order, but don't trust it).
  const onsets = notes
    .map((n) => n.startTimeSeconds)
    .sort((a, b) => a - b);

  // Compute pairwise intervals up to ~3 seconds apart. Longer intervals rarely
  // carry tempo info and blow up the histogram.
  const intervals: number[] = [];
  const maxPair = Math.min(onsets.length, 200); // cap at first 200 onsets
  for (let i = 0; i < maxPair; i++) {
    for (let j = i + 1; j < maxPair; j++) {
      const dt = onsets[j] - onsets[i];
      if (dt > 3) break;
      if (dt < 60 / MAX_BPM / 2) continue; // shorter than a 32nd at 200bpm
      intervals.push(dt);
    }
  }

  if (intervals.length === 0) {
    return { bpm: 120, confidence: 0 };
  }

  // Build a histogram of intervals, adding weight to the integer-multiple
  // interpretation (if 0.5 appears, 1.0 also votes for 0.5 as the base).
  const minPeriod = 60 / MAX_BPM;
  const maxPeriod = 60 / MIN_BPM;
  const numBins = Math.ceil((maxPeriod - minPeriod) / BIN_WIDTH) + 1;
  const hist = new Float32Array(numBins);

  for (const iv of intervals) {
    // For each observed interval, vote for the interval itself as the beat
    // period, plus each simple subdivision (iv could be 2× or 3× the beat).
    // Each interpretation gets equal weight — inflating the halving
    // interpretation would bias the estimator toward slower tempos.
    const candidates = [iv, iv / 2, iv / 3, iv / 4];
    for (const cand of candidates) {
      if (cand < minPeriod || cand > maxPeriod) continue;
      const bin = Math.round((cand - minPeriod) / BIN_WIDTH);
      if (bin >= 0 && bin < numBins) {
        hist[bin] += 1;
      }
    }
  }

  // Find the peak bin.
  let maxBin = 0;
  let maxVal = 0;
  let total = 0;
  for (let i = 0; i < hist.length; i++) {
    total += hist[i];
    if (hist[i] > maxVal) {
      maxVal = hist[i];
      maxBin = i;
    }
  }

  if (maxVal === 0 || total === 0) {
    return { bpm: 120, confidence: 0 };
  }

  const period = minPeriod + maxBin * BIN_WIDTH;
  const bpm = Math.round(60 / period);

  // Confidence = peak height / total histogram mass. A sharp single spike
  // → high confidence. A flat histogram (random onsets) → low.
  const confidence = Math.min(1, (maxVal / total) * 5);

  return { bpm, confidence };
}

/**
 * Quantize a time value to the nearest subdivision of a beat.
 *
 * Used by the alphaTex converter to "snap" note starts onto a regular grid so
 * the rendered tab doesn't show microscopic rests between notes that are
 * nominally simultaneous.
 */
export function quantizeToGrid(
  timeSeconds: number,
  bpm: number,
  subdivision = 16,
): number {
  const gridSeconds = 60 / bpm / (subdivision / 4);
  return Math.round(timeSeconds / gridSeconds) * gridSeconds;
}
