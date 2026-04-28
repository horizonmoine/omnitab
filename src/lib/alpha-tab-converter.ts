/**
 * Convert our internal Transcription type into alphaTex — the text format
 * AlphaTab consumes natively.
 *
 * alphaTex quick reference (what we use here):
 *   \title "Song"                 Song title
 *   \subtitle "Artist"             Artist / subtitle
 *   \tempo 120                    BPM
 *   \tuning (E4 B3 G3 D3 A2 E2)   Tuning (high → low, note names in parens)
 *   \track "Guitar"               Track header
 *   .                             Separates tracks
 *   :4 3.3 5.3 7.3                Quarter notes on string 3, frets 3/5/7
 *   :8 (3.3 5.2).4                Eighth notes, chord on strings 3+2
 *
 * Full spec: https://www.alphatab.net/docs/alphatex/introduction
 */

import type { TabNote, Transcription, Tuning } from './types';
import { groupChords } from './midi-to-tab';
import { quantizeToGrid } from './tempo-detection';

const NOTE_NAMES_SHARP = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

/** Convert a MIDI number to alphaTex note format (e.g. 64 → "E4"). */
function midiToAlphaTexNote(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = NOTE_NAMES_SHARP[midi % 12];
  // alphaTex uses lowercase for sharps — "c#" not "C#"
  return `${name.toLowerCase()}${octave}`;
}

/** Convert a tuning to alphaTex `\tuning` notation (high → low order). */
function tuningToAlphaTex(tuning: Tuning): string {
  // alphaTex wants strings from highest to lowest, space-separated.
  return tuning.strings
    .slice()
    .reverse()
    .map(midiToAlphaTexNote)
    .join(' ');
}

/**
 * Validate a TabNote before we emit it as alphaTex. Returns false (and logs
 * once) when fret or stringIndex isn't a finite number — a bad note would
 * render as `:4 NaN.6` and trip AlphaTab's parser with the error
 * `AT202 Unexpected 'Ident' token. Expected one of following: Number`.
 *
 * This guard is cheap insurance against upstream bugs in the Viterbi
 * tab-placement algorithm where a candidate's stringIndex/fret could be
 * undefined when the input MIDI lies outside the guitar tessitura on a
 * non-standard tuning.
 */
function isEmittableNote(n: TabNote): boolean {
  return (
    Number.isFinite(n.fret) &&
    Number.isFinite(n.stringIndex) &&
    n.fret >= 0 &&
    n.stringIndex >= 0 &&
    n.stringIndex <= 5
  );
}

/**
 * Quantize a time in seconds to the nearest sixteenth-note duration, given
 * a tempo. Returns the alphaTex duration marker (1/2/4/8/16/32).
 */
function quantizeDuration(seconds: number, bpm: number): number {
  const sixteenthSeconds = 60 / bpm / 4;
  const sixteenths = Math.max(1, Math.round(seconds / sixteenthSeconds));
  // alphaTex durations: 1 = whole, 2 = half, 4 = quarter, 8 = eighth, 16 = sixteenth
  if (sixteenths >= 16) return 1;
  if (sixteenths >= 8) return 2;
  if (sixteenths >= 4) return 4;
  if (sixteenths >= 2) return 8;
  return 16;
}

/**
 * Build an alphaTex string from a Transcription.
 *
 * This is intentionally simple — we emit one long melodic line without barring
 * or measure divisions. AlphaTab will render it on a single staff and the user
 * can edit it further. For production-quality output you'd want to:
 *   - detect beats / bars
 *   - emit rests for gaps between notes
 *   - handle overlapping notes as chords properly
 *
 * We handle chords (notes with near-identical onsets) via `groupChords()`.
 */
export function transcriptionToAlphaTex(
  transcription: Transcription,
  title = 'Untitled',
  artist = 'Transcribed',
): string {
  const { notes, tuning, tempoBpm = 120 } = transcription;
  const tuningStr = tuningToAlphaTex(tuning);

  const lines: string[] = [];
  lines.push(`\\title "${escapeAlphaTex(title)}"`);
  lines.push(`\\subtitle "${escapeAlphaTex(artist)}"`);
  lines.push(`\\tempo ${Math.round(tempoBpm)}`);
  lines.push(`\\tuning ${tuningStr}`);
  lines.push(`\\track "Guitar"`);
  lines.push('.');
  lines.push('');
  // Drop any malformed notes BEFORE the chord-grouping pass — a single bad
  // note in a chord would corrupt the entire chord output and AlphaTab
  // would reject the whole file.
  const validNotes = notes.filter(isEmittableNote);
  if (validNotes.length < notes.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[alphatex] dropped ${notes.length - validNotes.length} malformed note(s) ` +
        `(out of ${notes.length}) — likely fret/stringIndex undefined from upstream`,
    );
  }

  if (validNotes.length === 0) {
    lines.push(':4 r');
    lines.push('.');
    return lines.join('\n');
  }

  // Snap note onsets to a 16th-note grid so that near-simultaneous notes
  // collapse into proper chords and micro-rests don't show up between them.
  // Also coerce fret to an integer — basic-pitch can produce fractional
  // pitches that propagate through Viterbi as fractional frets, which
  // alphaTex's parser doesn't accept (`5.7.6` would be ambiguous).
  const snappedNotes: TabNote[] = validNotes.map((n) => ({
    ...n,
    fret: Math.round(n.fret),
    stringIndex: Math.round(n.stringIndex),
    startTimeSeconds: quantizeToGrid(n.startTimeSeconds, tempoBpm, 16),
  }));
  const chords = groupChords(snappedNotes);
  const beats: string[] = [];

  let prevEnd = 0;
  for (const chord of chords) {
    const first = chord[0];
    // Insert a rest for any gap >= 1/16th note.
    const gap = first.startTimeSeconds - prevEnd;
    if (gap > 0.05) {
      const restDur = quantizeDuration(gap, tempoBpm);
      beats.push(`:${restDur} r`);
    }

    const dur = quantizeDuration(first.durationSeconds, tempoBpm);
    if (chord.length === 1) {
      // Single note
      const n = chord[0];
      beats.push(`:${dur} ${n.fret}.${stringIndexToAlphaTex(n.stringIndex)}`);
    } else {
      // Chord — emit as (fret.string fret.string ...)
      const parts = chord
        .map((n) => `${n.fret}.${stringIndexToAlphaTex(n.stringIndex)}`)
        .join(' ');
      beats.push(`:${dur} (${parts})`);
    }

    prevEnd = first.startTimeSeconds + first.durationSeconds;
  }

  // Wrap beats in per-line chunks for readability.
  const CHUNK = 8;
  for (let i = 0; i < beats.length; i += CHUNK) {
    lines.push(beats.slice(i, i + CHUNK).join(' '));
  }
  const result = lines.join('\n');

  // Debug aid: emit the generated alphaTex to the console so that when
  // AlphaTab rejects it (AT202 etc), we can inspect what was actually
  // produced. Cheap — runs once per pipeline, not per beat. Keep around
  // until the converter is bullet-proof against every basic-pitch output.
  // eslint-disable-next-line no-console
  console.log(
    '[alphatex] generated source (%d notes → %d beats):\n%s',
    notes.length,
    beats.length,
    result,
  );

  return result;
}

/**
 * alphaTex numbers strings 1 (highest) → 6 (lowest), while our internal
 * representation uses 0 (lowest) → 5 (highest). Convert.
 */
function stringIndexToAlphaTex(stringIndex: number): number {
  return 6 - stringIndex;
}

function escapeAlphaTex(s: string): string {
  return s.replace(/"/g, '\\"');
}
