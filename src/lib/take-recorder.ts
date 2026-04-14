/**
 * Tiny MediaRecorder wrapper for capturing the user's mic during tab playback.
 *
 * Why a thin abstraction over the raw MediaRecorder API?
 *   - MediaRecorder is event-based (`ondataavailable`, `onstop`) and noisy
 *     to use inline. A promise-returning `stop()` flattens the control flow
 *     in the TabViewer.
 *   - The mime-type fallback dance (Safari can't do `audio/webm`, only
 *     `audio/mp4`) is best owned by one module.
 *   - We always reuse the shared mic stream pattern from audio-engine to
 *     avoid double-prompting the user for mic permission when the
 *     Rocksmith detector is also active.
 *
 * Output: a Blob in whatever encoding the browser picked, plus the wall-clock
 * duration. WAV would be nicer for portability but transcoding costs ~5×
 * the recording duration on a phone — webm/opus is fine for review takes.
 */

import { requestMicStream } from './audio-engine';

const PREFERRED_MIMES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  '', // browser default
];

function pickMime(): string {
  for (const m of PREFERRED_MIMES) {
    if (m === '' || MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export interface TakeRecorder {
  /** Resolves with the take blob and elapsed seconds. */
  stop(): Promise<{ blob: Blob; durationSeconds: number; mimeType: string }>;
  /** Cancel without saving — releases the mic immediately. */
  cancel(): void;
}

export async function startTake(): Promise<TakeRecorder> {
  const stream = await requestMicStream();
  const mime = pickMime();
  const recorder = mime
    ? new MediaRecorder(stream, { mimeType: mime })
    : new MediaRecorder(stream);

  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const startedAt = performance.now();
  recorder.start(1000); // emit a chunk every second so a crash is recoverable

  let resolved = false;

  const release = () => {
    stream.getTracks().forEach((t) => t.stop());
  };

  return {
    stop() {
      return new Promise((resolve, reject) => {
        if (resolved) return reject(new Error('already stopped'));
        resolved = true;
        recorder.onstop = () => {
          release();
          const blob = new Blob(chunks, {
            type: recorder.mimeType || 'audio/webm',
          });
          const durationSeconds = (performance.now() - startedAt) / 1000;
          resolve({ blob, durationSeconds, mimeType: recorder.mimeType });
        };
        recorder.onerror = (e) => {
          release();
          reject(new Error(`MediaRecorder error: ${(e as ErrorEvent).message ?? 'unknown'}`));
        };
        try {
          recorder.stop();
        } catch (e) {
          release();
          reject(e as Error);
        }
      });
    },
    cancel() {
      if (resolved) return;
      resolved = true;
      try { recorder.stop(); } catch { /* ignore */ }
      release();
    },
  };
}
