/**
 * Regression tests for detectTempo() and quantizeToGrid().
 *
 * These guard against silent regressions in the onset-histogram tempo
 * estimator — the kind of bug that would make every transcription off
 * by a factor of 2 without crashing.
 */

import { describe, expect, it } from 'vitest';
import { detectTempo, quantizeToGrid } from './tempo-detection';
import type { DetectedNote } from './types';

const n = (pitchMidi: number, startTimeSeconds: number): DetectedNote => ({
  pitchMidi,
  startTimeSeconds,
  durationSeconds: 0.25,
  amplitude: 0.8,
});

describe('detectTempo', () => {
  it('returns default 120 BPM with zero confidence for empty input', () => {
    expect(detectTempo([])).toEqual({ bpm: 120, confidence: 0 });
  });

  it('returns default for very short sequences (< 4 notes)', () => {
    const notes = [n(60, 0), n(62, 0.5), n(64, 1.0)];
    const { bpm, confidence } = detectTempo(notes);
    expect(bpm).toBe(120);
    expect(confidence).toBe(0);
  });

  it('detects 120 BPM from perfectly spaced quarter notes', () => {
    // 8 quarter notes at 0.5 s apart = 120 BPM.
    const notes: DetectedNote[] = [];
    for (let i = 0; i < 8; i++) {
      notes.push(n(60 + i, i * 0.5));
    }
    const { bpm, confidence } = detectTempo(notes);
    // Allow ±2 BPM for histogram bin granularity.
    expect(bpm).toBeGreaterThanOrEqual(118);
    expect(bpm).toBeLessThanOrEqual(122);
    expect(confidence).toBeGreaterThan(0.2);
  });

  it('detects 90 BPM from quarter notes at 0.6667 s apart', () => {
    const notes: DetectedNote[] = [];
    for (let i = 0; i < 10; i++) {
      notes.push(n(60, i * (60 / 90)));
    }
    const { bpm, confidence } = detectTempo(notes);
    expect(bpm).toBeGreaterThanOrEqual(88);
    expect(bpm).toBeLessThanOrEqual(92);
    expect(confidence).toBeGreaterThan(0.2);
  });

  it('clamps detected tempo inside 60..200 BPM range', () => {
    // Very fast onsets every 0.1 s (600 BPM if taken literally).
    // Algorithm should pick a submultiple (150 or 300 → rejected → 150).
    const notes: DetectedNote[] = [];
    for (let i = 0; i < 16; i++) {
      notes.push(n(60, i * 0.1));
    }
    const { bpm } = detectTempo(notes);
    expect(bpm).toBeGreaterThanOrEqual(60);
    expect(bpm).toBeLessThanOrEqual(200);
  });

  it('returns low confidence for random onsets', () => {
    const notes: DetectedNote[] = [];
    // Deterministic pseudo-random times to keep the test reproducible.
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t += 0.1 + ((i * 7) % 11) * 0.05;
      notes.push(n(60, t));
    }
    const { confidence } = detectTempo(notes);
    // Should be clearly lower than the 0.2 threshold for a clean melody.
    expect(confidence).toBeLessThan(0.6);
  });
});

describe('quantizeToGrid', () => {
  it('snaps to the nearest 16th note at 120 BPM', () => {
    // 16th at 120 BPM = 0.125 s.
    expect(quantizeToGrid(0.13, 120, 16)).toBeCloseTo(0.125, 5);
    expect(quantizeToGrid(0.12, 120, 16)).toBeCloseTo(0.125, 5);
    expect(quantizeToGrid(0.2, 120, 16)).toBeCloseTo(0.25, 5);
  });

  it('passes through exact grid times', () => {
    expect(quantizeToGrid(0, 120, 16)).toBe(0);
    expect(quantizeToGrid(0.5, 120, 16)).toBeCloseTo(0.5, 5);
  });

  it('respects custom subdivisions', () => {
    // 8th at 120 BPM = 0.25 s grid.
    expect(quantizeToGrid(0.2, 120, 8)).toBeCloseTo(0.25, 5);
    // 0.14 is closer to 0.25 than to 0 (midpoint = 0.125).
    expect(quantizeToGrid(0.14, 120, 8)).toBeCloseTo(0.25, 5);
    // 0.12 is closer to 0 — should snap down.
    expect(quantizeToGrid(0.12, 120, 8)).toBeCloseTo(0, 5);
  });

  it('handles different tempos correctly', () => {
    // 16th at 60 BPM = 0.25 s.
    expect(quantizeToGrid(0.26, 60, 16)).toBeCloseTo(0.25, 5);
    expect(quantizeToGrid(0.5, 60, 16)).toBeCloseTo(0.5, 5);
  });
});
