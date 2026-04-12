/**
 * Générateur chant + accompagnement.
 *
 * Deux points d'entrée :
 *
 *   • `extractMelodyAndAccompaniment()` — 100% automatique à partir d'une
 *     liste de notes détectées par basic-pitch. Utilise une heuristique
 *     "voix la plus haute / note la plus grave par tranche de temps" pour
 *     séparer la mélodie de l'accompagnement. C'est ce qui est utilisé par
 *     le mode "Chant + accords" du Transcriber.
 *
 *   • `generateChordMelody()` — pour les cas avancés où l'utilisateur
 *     connaît déjà la grille d'accords et la mélodie séparément (par exemple
 *     via Demucs + analyse manuelle). Non exposé dans l'UI pour rester simple.
 */

import { Chord, Note } from 'tonal';
import type { DetectedNote, TabNote, Transcription, Tuning } from './types';
import { assignViterbi, possiblePositions } from './midi-to-tab';

// ─────────────────────────────────────────────────────────────────────────
// Extraction automatique mélodie + basse depuis un flot de notes
// ─────────────────────────────────────────────────────────────────────────

export interface MelodyAndAccompaniment {
  /** La voix supérieure — ce que tu chanterais. */
  melody: DetectedNote[];
  /** La ligne de basse rythmique — fondamentale des accords. */
  bass: DetectedNote[];
}

/**
 * Sépare automatiquement mélodie et accompagnement à partir de notes
 * détectées par basic-pitch sur un audio entier.
 *
 * Algorithme :
 *   1. On découpe le temps en fenêtres de `windowSeconds` (~ une double-croche
 *      à 120 BPM).
 *   2. Dans chaque fenêtre, la note la PLUS AIGUË devient une note de mélodie
 *      (si elle est au-dessus de `melodyMinMidi` = C4 par défaut).
 *   3. La note la PLUS GRAVE devient une note de basse (on la ramène dans
 *      le registre grave de la guitare — en dessous de G3).
 *   4. Les fenêtres vides sont ignorées (pas de "rests" forcés, le
 *      convertisseur alphaTex s'en occupe).
 *
 * Limite connue : si la mélodie descend temporairement sous la ligne de
 * basse (contrepoint jazz), l'algo peut confondre les deux. Pour 95% de la
 * pop/rock/variété, c'est robuste.
 */
export function extractMelodyAndAccompaniment(
  notes: DetectedNote[],
  options: {
    /** Durée d'une fenêtre d'analyse en secondes. 0.25 ≈ croche à 120 BPM. */
    windowSeconds?: number;
    /** Pitch MIDI minimum pour qu'une note compte comme mélodie. C4 = 60. */
    melodyMinMidi?: number;
    /** Pitch MIDI maximum pour la basse. G3 = 55 = corde 4 à vide. */
    bassMaxMidi?: number;
  } = {},
): MelodyAndAccompaniment {
  const windowSeconds = options.windowSeconds ?? 0.25;
  const melodyMinMidi = options.melodyMinMidi ?? 60; // C4
  const bassMaxMidi = options.bassMaxMidi ?? 55; // G3

  if (notes.length === 0) return { melody: [], bass: [] };

  const sorted = [...notes].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds,
  );
  const totalDuration = Math.max(
    ...sorted.map((n) => n.startTimeSeconds + n.durationSeconds),
  );

  const melody: DetectedNote[] = [];
  const bass: DetectedNote[] = [];

  // Petit curseur pour éviter d'itérer toutes les notes à chaque fenêtre.
  let cursor = 0;

  for (let t = 0; t < totalDuration; t += windowSeconds) {
    const windowEnd = t + windowSeconds;

    // Collecte les notes qui ATTAQUENT dans cette fenêtre.
    const inWindow: DetectedNote[] = [];
    while (
      cursor < sorted.length &&
      sorted[cursor].startTimeSeconds < windowEnd
    ) {
      if (sorted[cursor].startTimeSeconds >= t) {
        inWindow.push(sorted[cursor]);
      }
      cursor++;
    }
    // Rewind cursor so notes that span multiple windows aren't skipped.
    while (
      cursor > 0 &&
      sorted[cursor - 1].startTimeSeconds >= t
    ) {
      cursor--;
    }

    if (inWindow.length === 0) continue;

    // Voix la plus haute = mélodie (si dans le bon registre).
    const top = inWindow.reduce((a, b) =>
      a.pitchMidi > b.pitchMidi ? a : b,
    );
    if (top.pitchMidi >= melodyMinMidi) {
      melody.push({ ...top });
    }

    // Note la plus basse = candidat basse. On la transpose dans le registre grave.
    const bottom = inWindow.reduce((a, b) =>
      a.pitchMidi < b.pitchMidi ? a : b,
    );
    if (bottom !== top) {
      let bassMidi = bottom.pitchMidi;
      while (bassMidi > bassMaxMidi) bassMidi -= 12;
      while (bassMidi < 40) bassMidi += 12; // E2 minimum (corde 6 à vide)
      bass.push({
        startTimeSeconds: t,
        durationSeconds: windowSeconds,
        pitchMidi: bassMidi,
        amplitude: bottom.amplitude * 0.9,
      });
    }
  }

  return { melody, bass };
}

// ─────────────────────────────────────────────────────────────────────────
// Génération chord-melody à partir d'une grille d'accords (mode avancé)
// ─────────────────────────────────────────────────────────────────────────

export interface ChordEvent {
  /** E.g. "Am", "F", "C7", "G/B" — anything tonal.Chord.get() understands. */
  symbol: string;
  startTimeSeconds: number;
  durationSeconds: number;
}

export type DifficultyLevel = 'beginner' | 'intermediate' | 'advanced';

export interface ChordMelodyInput {
  /** Melody line (typically the extracted vocal stem after basic-pitch). */
  melody: DetectedNote[];
  /** Chord progression (from audio analysis or manual entry). */
  chords: ChordEvent[];
  tuning: Tuning;
  difficulty: DifficultyLevel;
  /** Target tempo in BPM. */
  tempoBpm: number;
}

/**
 * Generate a fingerstyle arrangement.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ALGORITHM (default implementation below):
 *
 * 1. Constrain melody to strings 1–3 (high E, B, G). Transpose by ±12
 *    semitones if the original voice is out of range.
 * 2. For each chord, emit a bass note (root) on strings 4–6.
 * 3. The bass pattern depends on difficulty:
 *      beginner      → root on beat 1 only
 *      intermediate  → root on 1, fifth on 3 (alternating bass)
 *      advanced      → walking bass with passing tones
 * 4. Merge bass + melody into a single note list.
 * 5. Run assignViterbi() for final fret placement.
 * 6. Caller converts the result to alphaTex.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * TODO (contribution welcome — see README):
 * The rhythmic pattern of the bass line (step 3) is where taste lives. The
 * current impl is dumb: one root note per chord change. Try instead:
 *   - Match the rhythm of the chord progression itself
 *   - Match the rhythm of the melody (bass as counterpoint)
 *   - Use a preset "pattern bank" indexed by time signature + difficulty
 */
export function generateChordMelody(input: ChordMelodyInput): Transcription {
  const { melody, chords, tuning, difficulty, tempoBpm } = input;

  // 1. Constrain melody to upper register (strings 1–3).
  const melodyRange = constrainToUpperStrings(melody, tuning);

  // 2 + 3. Bass line per chord.
  const bass = buildBassLine(chords, difficulty, tuning);

  // 4. Merge.
  const merged: DetectedNote[] = [...bass, ...melodyRange].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds,
  );

  // 5. Assign fret positions via Viterbi (globally optimal).
  const tabNotes: TabNote[] = assignViterbi(merged, tuning);

  // 6. Return as a transcription.
  return {
    notes: tabNotes,
    tuning,
    capo: 0,
    durationSeconds:
      merged.length > 0
        ? Math.max(
            ...merged.map((n) => n.startTimeSeconds + n.durationSeconds),
          )
        : 0,
    tempoBpm,
  };
}

/**
 * Shift any melody notes that can only be played below string 3 (G) up by an
 * octave, so the whole melody lives on strings 1–3.
 */
function constrainToUpperStrings(
  melody: DetectedNote[],
  tuning: Tuning,
): DetectedNote[] {
  // Lowest playable pitch on string 3 (open) = tuning.strings[3].
  const minUpperMidi = tuning.strings[3];
  return melody.map((n) => {
    let midi = n.pitchMidi;
    while (midi < minUpperMidi) midi += 12;
    // If still not playable, cap at max.
    while (midi > tuning.strings[5] + 20) midi -= 12;
    return { ...n, pitchMidi: midi };
  });
}

/**
 * Build a bass line from a chord progression.
 *
 * Uses `tonal` to parse chord symbols and extract roots/fifths.
 */
function buildBassLine(
  chords: ChordEvent[],
  difficulty: DifficultyLevel,
  tuning: Tuning,
): DetectedNote[] {
  const bass: DetectedNote[] = [];

  for (const chord of chords) {
    const parsed = Chord.get(chord.symbol);
    if (!parsed.tonic) continue;

    // Find a bass-range root note (between low E on string 6 and string 4 open).
    const rootMidi = pickBassMidi(parsed.tonic, tuning);
    if (rootMidi === null) continue;

    const rootStart = chord.startTimeSeconds;

    if (difficulty === 'beginner') {
      // Just the root, full chord duration.
      bass.push({
        startTimeSeconds: rootStart,
        durationSeconds: chord.durationSeconds,
        pitchMidi: rootMidi,
        amplitude: 0.9,
      });
    } else if (difficulty === 'intermediate') {
      // Alternating root / fifth
      const half = chord.durationSeconds / 2;
      const fifthName =
        parsed.notes[2] ?? Note.transpose(parsed.tonic, '5P');
      const fifthMidi = pickBassMidi(fifthName, tuning) ?? rootMidi;
      bass.push({
        startTimeSeconds: rootStart,
        durationSeconds: half,
        pitchMidi: rootMidi,
        amplitude: 0.9,
      });
      bass.push({
        startTimeSeconds: rootStart + half,
        durationSeconds: half,
        pitchMidi: fifthMidi,
        amplitude: 0.85,
      });
    } else {
      // advanced — walking bass: root, fifth, octave, passing tone.
      // This is a rough sketch; production impl would consider the NEXT chord
      // to pick smooth passing tones.
      const quarter = chord.durationSeconds / 4;
      const fifthName =
        parsed.notes[2] ?? Note.transpose(parsed.tonic, '5P');
      const fifthMidi = pickBassMidi(fifthName, tuning) ?? rootMidi;
      const octaveMidi = rootMidi + 12;
      bass.push({
        startTimeSeconds: rootStart,
        durationSeconds: quarter,
        pitchMidi: rootMidi,
        amplitude: 0.9,
      });
      bass.push({
        startTimeSeconds: rootStart + quarter,
        durationSeconds: quarter,
        pitchMidi: fifthMidi,
        amplitude: 0.85,
      });
      bass.push({
        startTimeSeconds: rootStart + quarter * 2,
        durationSeconds: quarter,
        pitchMidi: octaveMidi,
        amplitude: 0.9,
      });
      bass.push({
        startTimeSeconds: rootStart + quarter * 3,
        durationSeconds: quarter,
        pitchMidi: fifthMidi + 2, // rough chromatic passing
        amplitude: 0.7,
      });
    }
  }

  return bass;
}

/**
 * Pick a MIDI pitch for `noteName` that lives in the guitar bass register
 * (strings 4–6). Returns null if not playable.
 */
function pickBassMidi(noteName: string, tuning: Tuning): number | null {
  const midi = Note.midi(`${noteName}2`); // try octave 2 first
  if (midi == null) return null;

  // Ensure it's playable on strings 4–6 (indices 0–2).
  const minMidi = tuning.strings[0];
  const maxMidi = tuning.strings[2] + 12;
  let candidate = midi;
  while (candidate < minMidi) candidate += 12;
  while (candidate > maxMidi) candidate -= 12;
  if (candidate < minMidi || candidate > maxMidi) return null;

  // Sanity check: must have at least one playable position on strings 4–6.
  const positions = possiblePositions(candidate, tuning).filter(
    (p) => p.stringIndex <= 2,
  );
  if (positions.length === 0) return null;

  return candidate;
}
