import { describe, expect, it } from 'vitest';
import { diffTabVsAudio, healerScore, type TabBeat } from './tab-healer';
import type { DetectedNote } from './types';

const note = (midi: number, t: number, dur = 0.25, amp = 0.8): DetectedNote => ({
  pitchMidi: midi,
  startTimeSeconds: t,
  durationSeconds: dur,
  amplitude: amp,
});

describe('tab-healer', () => {
  it('returns no flags when tab and audio agree', () => {
    const beats: TabBeat[] = [
      { timeSeconds: 0, midis: [60] },
      { timeSeconds: 0.5, midis: [64] },
    ];
    const detected: DetectedNote[] = [note(60, 0), note(64, 0.5)];
    expect(diffTabVsAudio(beats, detected)).toEqual([]);
  });

  it('flags a beat with no detected note as warning', () => {
    const beats: TabBeat[] = [{ timeSeconds: 1, midis: [67] }];
    const flags = diffTabVsAudio(beats, []);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('warning');
  });

  it('flags a complete pitch mismatch as error', () => {
    const beats: TabBeat[] = [{ timeSeconds: 0, midis: [60] }];
    const detected = [note(72, 0)]; // 12 semitones off
    const flags = diffTabVsAudio(beats, detected);
    expect(flags).toHaveLength(1);
    expect(flags[0].severity).toBe('error');
  });

  it('tolerates ±1 semitone pitch drift', () => {
    const beats: TabBeat[] = [{ timeSeconds: 0, midis: [60] }];
    const detected = [note(61, 0)];
    expect(diffTabVsAudio(beats, detected)).toEqual([]);
  });

  it('healerScore penalises errors more than info', () => {
    const errorScore = healerScore(10, [
      { timeSeconds: 0, severity: 'error', expectedMidis: [60], detectedMidis: [72], message: '' },
    ]);
    const infoScore = healerScore(10, [
      { timeSeconds: 0, severity: 'info', expectedMidis: [60], detectedMidis: [61, 64], message: '' },
    ]);
    expect(infoScore).toBeGreaterThan(errorScore);
  });
});
