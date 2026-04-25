/**
 * Web Worker hosting @spotify/basic-pitch inference.
 *
 * WHY: basic-pitch runs TF.js which is CPU-heavy (1–10 s per transcribe).
 * Running it on the main thread freezes the UI — progress bars don't
 * animate, buttons don't respond, PWA service worker handshake gets
 * blocked. Moving it to a worker keeps the UI at 60 FPS during inference.
 *
 * MESSAGE PROTOCOL:
 *   main → worker  : { type: 'transcribe', channelData, sampleRate, params }
 *   worker → main  : { type: 'progress', progress, status }
 *                    { type: 'done', notes }
 *                    { type: 'error', message }
 *
 * AudioBuffer is NOT transferable across workers. Instead we ship the raw
 * Float32 channel data (transferring ownership so no copy happens) plus
 * sampleRate, and reconstruct a minimal AudioBuffer-shaped object inside
 * the worker — basic-pitch only touches a few properties.
 */

/// <reference lib="webworker" />

// ── TF.js worker polyfill ────────────────────────────────────────────────
//
// @spotify/basic-pitch ships TF.js 4.x, whose `platform_browser.js` shim
// calls `window.setTimeout(...)` from inside the WebGL fence-polling code
// (`gpgpu_context.js > Gu.pollFence > setTimeoutCustom`). Web Workers have
// `self`, not `window`, so that call throws ReferenceError. The promise
// awaiting the fence rejects silently and basic-pitch hangs forever at
// "Analyse audio… 0%" — confirmed visually in DevTools console.
//
// Workaround: alias `self` as `window` BEFORE the dynamic import of
// basic-pitch (which transitively imports TF.js). `self` exposes
// setTimeout, setInterval, fetch, navigator, etc. — the subset TF.js's
// browser platform shim actually touches. Anything that genuinely needs
// `document` would still fail, but TF.js's WebGL backend doesn't.
//
// Without this fix: TF.js silently falls back to CPU OR hangs (depending
// on which TF.js path runs first). With this fix: TF.js initializes
// WebGL via OffscreenCanvas → ~10× faster than CPU on a 3-min song.
if (typeof (self as { window?: unknown }).window === 'undefined') {
  (self as unknown as { window: typeof self }).window = self;
}

import type { DetectedNote, TranscriptionParams } from '../lib/types';
import { DEFAULT_TRANSCRIPTION_PARAMS } from '../lib/types';

const MODEL_URL =
  'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json';

export interface TranscribeRequest {
  type: 'transcribe';
  channelData: Float32Array;
  sampleRate: number;
  params?: TranscriptionParams;
}

export type WorkerResponse =
  | { type: 'progress'; progress: number; status: string }
  | { type: 'done'; notes: DetectedNote[] }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', async (event: MessageEvent<TranscribeRequest>) => {
  const msg = event.data;
  if (msg?.type !== 'transcribe') return;

  try {
    const notes = await runBasicPitch(
      msg.channelData,
      msg.sampleRate,
      msg.params ?? DEFAULT_TRANSCRIPTION_PARAMS,
      (progress, status) => {
        ctx.postMessage({ type: 'progress', progress, status } satisfies WorkerResponse);
      },
    );
    ctx.postMessage({ type: 'done', notes } satisfies WorkerResponse);
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
});

// Lazy-loaded, module-level singletons. The worker is long-lived across
// transcription calls (see src/lib/basic-pitch.ts), so caching these avoids
// re-importing the ~1 MB @spotify/basic-pitch chunk and rebuilding the TF.js
// model graph on every run. First call pays the cost, subsequent runs reuse.
type BasicPitchModule = typeof import('@spotify/basic-pitch');
let basicPitchModule: BasicPitchModule | null = null;
let basicPitchInstance: InstanceType<BasicPitchModule['BasicPitch']> | null = null;

async function runBasicPitch(
  channelData: Float32Array,
  sampleRate: number,
  params: TranscriptionParams,
  emit: (progress: number, status: string) => void,
): Promise<DetectedNote[]> {
  const firstRun = basicPitchModule === null;
  emit(0, firstRun ? 'Chargement du modèle basic-pitch…' : 'Préparation…');

  if (!basicPitchModule) {
    basicPitchModule = await import('@spotify/basic-pitch');
  }
  const { BasicPitch, outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } =
    basicPitchModule;

  if (!basicPitchInstance) {
    basicPitchInstance = new BasicPitch(MODEL_URL);
  }
  const basicPitch = basicPitchInstance;

  // Minimal AudioBuffer-shaped stub. basic-pitch only reads these five
  // properties (verified against its source). If a new version of the
  // library touches more, TS won't catch it at build time — but the runtime
  // error will be obvious and localized to this stub.
  const audioBufferStub = {
    getChannelData: (_channel: number) => channelData,
    sampleRate,
    length: channelData.length,
    numberOfChannels: 1,
    duration: channelData.length / sampleRate,
  } as unknown as AudioBuffer;

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  emit(0.05, 'Inférence en cours…');

  await basicPitch.evaluateModel(
    audioBufferStub,
    (f: number[][], o: number[][], c: number[][]) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (p: number) => {
      emit(0.05 + p * 0.9, `Analyse audio… ${Math.round(p * 100)}%`);
    },
  );

  emit(0.97, 'Extraction des notes…');

  const rawNotes = outputToNotesPoly(
    frames,
    onsets,
    params.onsetThreshold,
    params.frameThreshold,
    Math.max(1, Math.round(params.minNoteLengthMs / 11.6)),
  );

  const notesWithBends = addPitchBendsToNoteEvents(contours, rawNotes);
  const noteEvents = noteFramesToTime(notesWithBends);

  emit(1, 'Terminé.');

  // basic-pitch's output type is loosely typed; cast via unknown.
  return (noteEvents as unknown as DetectedNote[]).map((n) => ({
    startTimeSeconds: n.startTimeSeconds,
    durationSeconds: n.durationSeconds,
    pitchMidi: n.pitchMidi,
    amplitude: n.amplitude,
    pitchBends: n.pitchBends,
  }));
}
