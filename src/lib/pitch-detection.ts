/**
 * Real-time pitch detection for the tuner.
 *
 * Uses `pitchy` (McLeod Pitch Method / autocorrelation) running off a raw
 * AnalyserNode buffer. pitchy is ~150 LOC, ±1 cent accuracy, zero dependencies.
 *
 * Usage:
 *   const detector = createTunerDetector(audioContext);
 *   await detector.start();
 *   detector.onReading((r) => updateUI(r));
 *   // later: detector.stop();
 */

import { PitchDetector } from 'pitchy';
import { analyzeFrequency } from './guitarTunings';
import { requestMicStream } from './audio-engine';
import type { TunerReading } from './types';

export interface TunerDetector {
  start(): Promise<void>;
  stop(): void;
  onReading(cb: (r: TunerReading) => void): void;
}

export function createTunerDetector(
  ctx: AudioContext,
  a4 = 440,
  minClarity = 0.92,
): TunerDetector {
  let stream: MediaStream | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let detector: PitchDetector<Float32Array<ArrayBuffer>> | null = null;
  let frameId = 0;
  let callback: ((r: TunerReading) => void) | null = null;
  let input: Float32Array<ArrayBuffer> | null = null;

  return {
    async start() {
      stream = await requestMicStream();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      detector = PitchDetector.forFloat32Array(analyser.fftSize);
      // Explicit ArrayBuffer — getFloatTimeDomainData() only accepts
      // Float32Array<ArrayBuffer> (not ArrayBufferLike) under TS 5.7+.
      input = new Float32Array(new ArrayBuffer(detector.inputLength * 4));

      const loop = () => {
        if (!analyser || !detector || !input) return;
        analyser.getFloatTimeDomainData(input);
        const [freq, clarity] = detector.findPitch(input, ctx.sampleRate);

        if (clarity >= minClarity && freq > 50 && freq < 2000) {
          const { midi, note, cents } = analyzeFrequency(freq, a4);
          callback?.({ frequency: freq, note, midi, cents, clarity });
        }
        frameId = requestAnimationFrame(loop);
      };
      frameId = requestAnimationFrame(loop);
    },

    stop() {
      cancelAnimationFrame(frameId);
      try {
        source?.disconnect();
        analyser?.disconnect();
        stream?.getTracks().forEach((t) => t.stop());
      } catch {
        /* ignore */
      }
      stream = null;
      source = null;
      analyser = null;
      detector = null;
      input = null;
    },

    onReading(cb) {
      callback = cb;
    },
  };
}
