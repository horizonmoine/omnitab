/**
 * Regression tests for transcriptionToAlphaTex().
 *
 * Silent bugs in this converter are catastrophic: every AI-transcribed tab
 * depends on it, and a malformed alphaTex string renders as a blank staff
 * with no error (AlphaTab just gives up).
 */

import { describe, expect, it } from 'vitest';
import { transcriptionToAlphaTex } from './alpha-tab-converter';
import { TUNINGS } from './guitarTunings';
import type { TabNote, Transcription } from './types';

const std = TUNINGS.standard;

const tn = (
  stringIndex: number,
  fret: number,
  pitchMidi: number,
  startTimeSeconds: number,
  durationSeconds = 0.5,
): TabNote => ({
  stringIndex,
  fret,
  pitchMidi,
  startTimeSeconds,
  durationSeconds,
});

const baseTranscription = (notes: TabNote[]): Transcription => ({
  notes,
  tuning: std,
  capo: 0,
  durationSeconds: 10,
  tempoBpm: 120,
});

describe('transcriptionToAlphaTex', () => {
  it('emits header lines with title, subtitle, tempo, tuning, track', () => {
    const tex = transcriptionToAlphaTex(
      baseTranscription([tn(5, 0, 64, 0)]),
      'My Song',
      'My Band',
    );
    expect(tex).toContain('\\title "My Song"');
    expect(tex).toContain('\\subtitle "My Band"');
    expect(tex).toContain('\\tempo 120');
    expect(tex).toContain('\\tuning');
    expect(tex).toContain('\\track "Guitar"');
  });

  it('emits standard tuning in high → low order, wrapped in parens', () => {
    const tex = transcriptionToAlphaTex(baseTranscription([tn(5, 0, 64, 0)]));
    // Standard is E2 A2 D3 G3 B3 E4. alphaTex wants high → low: E4 B3 G3 D3 A2 E2.
    // Modern alphaTex requires metadata args in parentheses (warning AT301
    // otherwise — the parser was tightened in AlphaTab 1.5+).
    expect(tex).toContain('\\tuning(e4 b3 g3 d3 a2 e2)');
  });

  it('produces a rest-only body for an empty transcription', () => {
    const tex = transcriptionToAlphaTex(baseTranscription([]));
    expect(tex).toContain(':4 r');
    // Track terminator must be present.
    expect(tex.trim().endsWith('.')).toBe(true);
  });

  // Regression: AT202 "Unexpected 'Ident' token" was thrown by AlphaTab when
  // a TabNote with NaN/undefined fret or stringIndex slipped through —
  // template literal `${NaN}.${stringIndex}` produces "NaN.X" which the
  // parser reads as an identifier where it expected a number. Filter them.
  it('drops notes with NaN/undefined fret or stringIndex (no AT202)', () => {
    const goodNote = tn(5, 0, 64, 0);
    // Cast away type safety to simulate upstream Viterbi corruption.
    const nanFret = { ...tn(5, 0, 64, 0.5), fret: NaN } as TabNote;
    const undefString = { ...tn(5, 0, 64, 1.0), stringIndex: undefined as unknown as number } as TabNote;
    const tex = transcriptionToAlphaTex(
      baseTranscription([goodNote, nanFret, undefString]),
    );
    // None of the bad-data placeholders should leak through.
    expect(tex).not.toMatch(/NaN/);
    expect(tex).not.toMatch(/undefined/);
    // The one valid note still produces output.
    expect(tex).toMatch(/0\.1/);
  });

  it('coerces fractional fret/stringIndex to integers', () => {
    // basic-pitch can produce slightly non-integer pitches; Viterbi may
    // pass them through as fractional frets. alphaTex would mis-parse
    // "5.7.6" so we round before emitting.
    const fractional = { ...tn(5, 0, 64, 0), fret: 5.7 } as TabNote;
    const tex = transcriptionToAlphaTex(baseTranscription([fractional]));
    expect(tex).toMatch(/6\.1/); // 5.7 rounds to 6
    expect(tex).not.toMatch(/5\.7\.1/);
  });

  it('terminates tracks with a period on its own line', () => {
    const tex = transcriptionToAlphaTex(
      baseTranscription([tn(5, 0, 64, 0), tn(5, 2, 66, 0.5)]),
    );
    // alphaTex requires a trailing "." to close the track block.
    expect(tex.trim().endsWith('.')).toBe(true);
  });

  it('converts internal stringIndex 0 (low E) to alphaTex string 6', () => {
    // Single note on string index 0 (lowest) = alphaTex "fret.6"
    const tex = transcriptionToAlphaTex(
      baseTranscription([tn(0, 3, 43, 0)]),
    );
    expect(tex).toMatch(/3\.6/);
  });

  it('converts internal stringIndex 5 (high E) to alphaTex string 1', () => {
    const tex = transcriptionToAlphaTex(
      baseTranscription([tn(5, 0, 64, 0)]),
    );
    expect(tex).toMatch(/0\.1/);
  });

  it('groups simultaneous notes as a chord in parentheses', () => {
    // Three notes starting at nearly the same time → chord
    const tex = transcriptionToAlphaTex(
      baseTranscription([
        tn(5, 0, 64, 0.0),
        tn(4, 0, 59, 0.01),
        tn(3, 0, 55, 0.02),
      ]),
    );
    // Expected: (0.1 0.2 0.3) — three open strings
    expect(tex).toMatch(/\(.*0\.1.*0\.2.*0\.3.*\)/);
  });

  it('emits rests for gaps between notes', () => {
    // Gap of 1 s between two quarter notes at 120 BPM = half rest.
    const tex = transcriptionToAlphaTex(
      baseTranscription([
        tn(5, 0, 64, 0, 0.25),
        tn(5, 2, 66, 1.5, 0.25),
      ]),
    );
    // There should be a rest marker between the two notes.
    expect(tex).toMatch(/:\d+ r/);
  });

  it('maps note duration to alphaTex duration codes', () => {
    // At 120 BPM, a quarter note = 0.5 s → duration marker should be :4
    const tex = transcriptionToAlphaTex(
      baseTranscription([tn(5, 0, 64, 0, 0.5)]),
    );
    expect(tex).toContain(':4 0.1');
  });

  it('respects the tempoBpm field', () => {
    const tex = transcriptionToAlphaTex({
      ...baseTranscription([tn(5, 0, 64, 0)]),
      tempoBpm: 180,
    });
    expect(tex).toContain('\\tempo 180');
  });

  it('defaults tempoBpm to 120 when absent', () => {
    const { tempoBpm: _ignore, ...rest } = baseTranscription([
      tn(5, 0, 64, 0),
    ]);
    void _ignore;
    const tex = transcriptionToAlphaTex(rest as Transcription);
    expect(tex).toContain('\\tempo 120');
  });

  it('escapes double quotes in title and artist', () => {
    const tex = transcriptionToAlphaTex(
      baseTranscription([tn(5, 0, 64, 0)]),
      'Say "Hi"',
      'O"Toole',
    );
    // Quotes inside the title must be backslash-escaped for alphaTex parser.
    expect(tex).toContain('\\title "Say \\"Hi\\""');
    expect(tex).toContain('\\subtitle "O\\"Toole"');
  });

  it('handles a long melody without crashing and produces one line per chunk', () => {
    // 20 sequential quarter notes → the converter chunks beats into lines of 8.
    const notes: TabNote[] = [];
    for (let i = 0; i < 20; i++) {
      notes.push(tn(5, i % 12, 64 + (i % 12), i * 0.5, 0.5));
    }
    const tex = transcriptionToAlphaTex(baseTranscription(notes));
    const bodyLines = tex
      .split('\n')
      .filter((l) => /^:\d+/.test(l.trim()));
    // 20 beats / 8 per line = 3 lines (8 + 8 + 4).
    expect(bodyLines.length).toBeGreaterThanOrEqual(3);
  });
});
