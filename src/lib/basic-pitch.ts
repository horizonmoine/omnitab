/**
 * Public API for basic-pitch transcription.
 *
 * Inference itself runs in a Web Worker (src/workers/basic-pitch.worker.ts)
 * so the main thread stays responsive during the 1–10 s evaluate cycle.
 * This module is the thin main-thread facade that:
 *   1. extracts mono channel data from an AudioBuffer
 *   2. ships it to a LONG-LIVED worker (with ownership transfer, zero-copy)
 *   3. relays progress events
 *   4. resolves with the final DetectedNote[] list
 *
 * WHY LONG-LIVED?
 *   Spawning a fresh worker per transcription means basic-pitch's ~20 MB
 *   TF.js model is re-fetched (or at least re-parsed + re-uploaded to WebGL)
 *   every time. Keeping one worker alive across calls makes the second run
 *   ~10× faster — worth the memory trade-off.
 *
 *   To avoid hoarding memory forever, we auto-terminate the worker after
 *   IDLE_TIMEOUT_MS with no pending work. The next call transparently
 *   respawns one.
 *
 * CONCURRENCY
 *   Transcription is user-triggered (click "Analyser"), so concurrent calls
 *   are rare but possible (user clicks twice fast). We serialize: each call
 *   awaits the previous one before posting to the worker. No requestId
 *   multiplexing needed, which keeps the protocol dead simple.
 */

import type { DetectedNote, TranscriptionParams } from './types';
import type {
  TranscribeRequest,
  WorkerResponse,
} from '../workers/basic-pitch.worker';

export interface TranscribeProgress {
  /** 0–1. */
  progress: number;
  status: string;
}

const IDLE_TIMEOUT_MS = 60_000;

let worker: Worker | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let inflight: Promise<unknown> = Promise.resolve();

function getWorker(): Worker {
  if (worker) return worker;
  // Vite's `new Worker(new URL(...), { type: 'module' })` pattern is what
  // lets Rollup statically analyze the worker entry and emit a separate
  // chunk. Do NOT replace with a string URL — it breaks the build.
  worker = new Worker(
    new URL('../workers/basic-pitch.worker.ts', import.meta.url),
    { type: 'module' },
  );
  return worker;
}

function scheduleIdleTermination(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    idleTimer = null;
  }, IDLE_TIMEOUT_MS);
}

function cancelIdleTermination(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/**
 * Run basic-pitch inference on an AudioBuffer via the persistent worker.
 *
 * AudioBuffer is NOT structurally cloneable, so we extract the mono channel
 * (basic-pitch only uses channel 0 anyway) and transfer the underlying
 * ArrayBuffer — zero copy, zero GC pressure.
 */
export async function transcribeAudio(
  audioBuffer: AudioBuffer,
  params?: TranscriptionParams,
  onProgress?: (p: TranscribeProgress) => void,
): Promise<DetectedNote[]> {
  // Copy channel 0 into a standalone buffer we can transfer. AudioBuffer's
  // backing store may be shared with other WebAudio nodes — we must NOT
  // hand its buffer to the worker directly.
  const source = audioBuffer.getChannelData(0);
  const channelData = new Float32Array(new ArrayBuffer(source.length * 4));
  channelData.set(source);
  const sampleRate = audioBuffer.sampleRate;

  // Serialize against any in-flight run. The new promise becomes the next
  // tail for any subsequent caller.
  const run = inflight.then(
    () =>
      new Promise<DetectedNote[]>((resolve, reject) => {
        cancelIdleTermination();
        const w = getWorker();

        const cleanup = () => {
          w.removeEventListener('message', onMessage);
          w.removeEventListener('error', onError);
          scheduleIdleTermination();
        };

        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          switch (msg.type) {
            case 'progress':
              onProgress?.({ progress: msg.progress, status: msg.status });
              break;
            case 'done':
              cleanup();
              resolve(msg.notes);
              break;
            case 'error':
              cleanup();
              // A crashed worker is in undefined state — kill it so the next
              // call gets a fresh one. Model will re-download from SW cache.
              if (worker === w) {
                w.terminate();
                worker = null;
              }
              reject(new Error(msg.message));
              break;
          }
        };

        const onError = (err: ErrorEvent) => {
          cleanup();
          if (worker === w) {
            w.terminate();
            worker = null;
          }
          reject(new Error(err.message || 'basic-pitch worker crashed'));
        };

        w.addEventListener('message', onMessage);
        w.addEventListener('error', onError);

        const request: TranscribeRequest = {
          type: 'transcribe',
          channelData,
          sampleRate,
          params,
        };
        // Transfer the ArrayBuffer — after this line `channelData` is empty
        // in our scope, but the worker has the data without a memcpy.
        w.postMessage(request, [channelData.buffer]);
      }),
  );

  // Queue the tail as "inflight" — but swallow errors so one failing call
  // doesn't poison the chain for the next caller.
  inflight = run.catch(() => undefined);
  return run;
}

/**
 * Force-terminate the persistent worker (e.g. on page unload or for tests).
 * Next `transcribeAudio()` call will respawn one.
 */
export function disposeBasicPitchWorker(): void {
  cancelIdleTermination();
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

/**
 * Filter detected notes to the guitar tessitura (E2..E6) and drop low-amplitude
 * artefacts. basic-pitch is general-purpose and will sometimes detect vocal
 * harmonics, bass fundamentals, etc. This runs on the main thread — it's
 * cheap (a single pass over typically <2000 notes).
 */
export function filterGuitarNotes(
  notes: DetectedNote[],
  minAmplitude = 0.3,
  minMidi = 40, // E2
  maxMidi = 88, // E6
): DetectedNote[] {
  return notes.filter(
    (n) =>
      n.amplitude >= minAmplitude &&
      n.pitchMidi >= minMidi &&
      n.pitchMidi <= maxMidi,
  );
}
