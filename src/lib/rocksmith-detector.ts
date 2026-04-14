/**
 * Rocksmith-style real-time pitch feedback.
 *
 * Listens to the mic via pitchy and diffs the detected note against the
 * "currently expected" note from the AlphaTab beat. Emits HIT/MISS events
 * the TabViewer renders as green/red overlay.
 *
 * Design notes:
 *   - AlphaTab's beat changes come via `api.playedBeatChanged`. Each beat
 *     has `notes[]` with MIDI values. We compare against the lowest note
 *     of the current beat (simple monophonic matching — chords are lenient).
 *   - We keep a 250 ms window after each beat to register a hit, then
 *     timeout → miss.
 *   - Detection uses the same pitchy approach as the Tuner at a lower
 *     minClarity (0.85) because guitar through an amp is noisier than
 *     an acoustic source.
 */

import { PitchDetector } from 'pitchy';
import { requestMicStream, getAudioContext } from './audio-engine';

export interface RocksmithEvent {
  /** MIDI note that was expected at this beat. */
  expectedMidi: number;
  /** MIDI note detected on the mic, or null if none clear. */
  detectedMidi: number | null;
  /** Was the attempt within ±1 semitone of the target. */
  hit: boolean;
  /** When the beat hit (ms since page load). */
  timeMs: number;
}

/** Convert frequency to the closest MIDI note number. */
function freqToMidi(freq: number, a4 = 440): number {
  return Math.round(69 + 12 * Math.log2(freq / a4));
}

export interface RocksmithDetector {
  start(): Promise<void>;
  stop(): void;
  /** Call this when AlphaTab advances the beat. */
  onBeat(expectedMidi: number): void;
  /** Event listener for hit/miss results. */
  onEvent(cb: (e: RocksmithEvent) => void): void;
  /** Stats since start(). */
  getStats(): { hits: number; total: number };
}

const HIT_WINDOW_MS = 300;
const PITCH_TOLERANCE_SEMITONES = 1;

export function createRocksmithDetector(
  ctx: AudioContext = getAudioContext(),
  a4 = 440,
): RocksmithDetector {
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let detector: PitchDetector<Float32Array<ArrayBuffer>> | null = null;
  let buffer: Float32Array<ArrayBuffer> | null = null;
  let raf = 0;

  let expected: number | null = null;
  let expectedAt = 0;
  let resolved = false;

  let hits = 0;
  let total = 0;
  let callback: ((e: RocksmithEvent) => void) | null = null;

  const loop = () => {
    if (!analyser || !detector || !buffer) return;
    analyser.getFloatTimeDomainData(buffer);
    const [freq, clarity] = detector.findPitch(buffer, ctx.sampleRate);

    const now = performance.now();

    // Window resolution: if beat is pending and we detect a clear note.
    if (expected !== null && !resolved && clarity > 0.85 && freq > 60 && freq < 2000) {
      const midi = freqToMidi(freq, a4);
      if (Math.abs(midi - expected) <= PITCH_TOLERANCE_SEMITONES) {
        hits++;
        resolved = true;
        callback?.({
          expectedMidi: expected,
          detectedMidi: midi,
          hit: true,
          timeMs: now,
        });
      }
    }

    // Window expired without resolution → miss.
    if (expected !== null && !resolved && now - expectedAt > HIT_WINDOW_MS) {
      resolved = true;
      callback?.({
        expectedMidi: expected,
        detectedMidi: null,
        hit: false,
        timeMs: now,
      });
    }

    raf = requestAnimationFrame(loop);
  };

  return {
    async start() {
      stream = await requestMicStream();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      detector = PitchDetector.forFloat32Array(analyser.fftSize);
      buffer = new Float32Array(new ArrayBuffer(detector.inputLength * 4));
      raf = requestAnimationFrame(loop);
    },

    stop() {
      cancelAnimationFrame(raf);
      try {
        source?.disconnect();
        analyser?.disconnect();
        stream?.getTracks().forEach((t) => t.stop());
      } catch { /* ignore */ }
      stream = null;
      source = null;
      analyser = null;
      detector = null;
      buffer = null;
      expected = null;
      resolved = false;
    },

    onBeat(expectedMidi) {
      // Finalize previous beat if still pending → counts as miss.
      if (expected !== null && !resolved) {
        callback?.({
          expectedMidi: expected,
          detectedMidi: null,
          hit: false,
          timeMs: performance.now(),
        });
      }
      expected = expectedMidi;
      expectedAt = performance.now();
      resolved = false;
      total++;
    },

    onEvent(cb) {
      callback = cb;
    },

    getStats() {
      return { hits, total };
    },
  };
}
