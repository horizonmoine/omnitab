/**
 * Tab Healer — flag potential errors in a human-written tab by comparing it
 * to an IA transcription of the reference audio.
 *
 * The idea:
 *   1. User has a tab (e.g. from Songsterr) they suspect is wrong in places.
 *   2. They provide the original audio.
 *   3. We run basic-pitch on the audio → list of DetectedNote.
 *   4. We compare beat-by-beat: for each tab note, does a detected note of
 *      the same MIDI value land within ±100 ms?
 *
 * Output: a list of Flag objects with a confidence score the UI renders as a
 * tooltip overlay on the AlphaTab cursor.
 *
 * Non-goals:
 *   - Correcting the tab. Just flagging.
 *   - Chord recognition. Monophonic lowest-note matching, like Rocksmith mode.
 */

import type { DetectedNote } from './types';

export interface TabBeat {
  /** Time offset from start of song (seconds). */
  timeSeconds: number;
  /** MIDI numbers of all notes on this beat. */
  midis: number[];
  /**
   * Opaque reference to the underlying AlphaTab Beat. Carried through the
   * healer pipeline so the overlay can call `api.boundsLookup.findBeat(ref)`
   * to position flag markers directly on the rendered score. Not every
   * producer will populate this (it's optional for unit tests).
   */
  beatRef?: unknown;
}

export type FlagSeverity = 'info' | 'warning' | 'error';

export interface HealerFlag {
  timeSeconds: number;
  severity: FlagSeverity;
  /** What the tab says was played. */
  expectedMidis: number[];
  /** What basic-pitch heard, if anything. */
  detectedMidis: number[];
  /** Human-readable blurb. */
  message: string;
  /** Opaque AlphaTab Beat, forwarded from `TabBeat` for overlay positioning. */
  beatRef?: unknown;
}

const TIME_TOLERANCE_S = 0.15;
const PITCH_TOLERANCE_SEMITONES = 1;

/**
 * Compare a tab's beat grid to an IA detection of the same audio. Returns a
 * list of flags at the beats where the tab and the detection disagree.
 */
export function diffTabVsAudio(
  tabBeats: TabBeat[],
  detected: DetectedNote[],
): HealerFlag[] {
  const flags: HealerFlag[] = [];

  for (const beat of tabBeats) {
    // All detected notes active in the ±tolerance window around this beat.
    const nearby = detected.filter((n) => {
      const start = n.startTimeSeconds;
      const end = n.startTimeSeconds + n.durationSeconds;
      return (
        start <= beat.timeSeconds + TIME_TOLERANCE_S &&
        end >= beat.timeSeconds - TIME_TOLERANCE_S
      );
    });

    const detectedMidis = nearby.map((n) => n.pitchMidi);

    if (beat.midis.length === 0) continue; // rest beats are unverifiable

    if (detectedMidis.length === 0) {
      flags.push({
        timeSeconds: beat.timeSeconds,
        severity: 'warning',
        expectedMidis: beat.midis,
        detectedMidis: [],
        message: 'Aucune note détectée dans l\'audio ici — la tab joue-t-elle vraiment quelque chose ?',
        beatRef: beat.beatRef,
      });
      continue;
    }

    // For each expected note, is there a detected note within ±1 semitone?
    const unmatched = beat.midis.filter(
      (m) => !detectedMidis.some((d) => Math.abs(d - m) <= PITCH_TOLERANCE_SEMITONES),
    );

    if (unmatched.length === beat.midis.length) {
      flags.push({
        timeSeconds: beat.timeSeconds,
        severity: 'error',
        expectedMidis: beat.midis,
        detectedMidis,
        message: `Désaccord complet : tab → ${beat.midis.join(',')} vs audio → ${detectedMidis.join(',')}.`,
        beatRef: beat.beatRef,
      });
    } else if (unmatched.length > 0) {
      flags.push({
        timeSeconds: beat.timeSeconds,
        severity: 'info',
        expectedMidis: beat.midis,
        detectedMidis,
        message: `Partiellement différent : ${unmatched.length}/${beat.midis.length} notes non trouvées.`,
        beatRef: beat.beatRef,
      });
    }
  }

  return flags;
}

/**
 * Small summary used by the UI to show a "fiabilité: 87%" badge.
 */
export function healerScore(beatsTotal: number, flags: HealerFlag[]): number {
  if (beatsTotal === 0) return 1;
  const weight = (f: HealerFlag) =>
    f.severity === 'error' ? 1 : f.severity === 'warning' ? 0.5 : 0.25;
  const penalty = flags.reduce((acc, f) => acc + weight(f), 0);
  return Math.max(0, 1 - penalty / beatsTotal);
}
