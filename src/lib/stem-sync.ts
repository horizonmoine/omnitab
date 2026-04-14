/**
 * Multi-stem playback wrapper that AlphaTab can drive in lock-step.
 *
 * Why HTMLAudioElement vs decoded AudioBuffer?
 *   Stems are 3-5 minute mono WAVs at 44.1 kHz → ~30 MB decoded each. A
 *   4-stem song would burn ~120 MB of RAM. HTMLAudioElement streams from
 *   the Blob URL on demand, so RAM stays flat. The trade-off is precision:
 *   `currentTime` resolution is ~10 ms which is good enough to follow
 *   AlphaTab's cursor (humans don't perceive sub-20 ms drift in playback).
 *
 * Sync strategy:
 *   AlphaTab is the *clock*. Every ~250 ms (driven by AlphaTab's
 *   playerPositionChanged event) we compare the audio element's
 *   currentTime against AlphaTab's reported position. If drift exceeds
 *   DRIFT_TOLERANCE_MS we hard-seek the audio. Otherwise we let it run.
 *
 * Speed:
 *   We mirror AlphaTab's `playbackSpeed` to `audio.playbackRate`. The
 *   browser's pitch-preserving time-stretch isn't perfect but it's the
 *   only viable option without a server-side re-render.
 */

export interface StemTrack {
  /** Display name: 'vocals', 'drums', 'bass', 'other'… */
  name: string;
  /** Source blob (WAV from Demucs). */
  blob: Blob;
  /** Initial volume 0..1. */
  volume?: number;
  /** Initial mute state. */
  muted?: boolean;
}

export interface StemHandle {
  name: string;
  audio: HTMLAudioElement;
  /** Object URL we created — must be revoked on dispose to avoid leaks. */
  blobUrl: string;
}

const DRIFT_TOLERANCE_MS = 80;

export interface StemPlayer {
  handles: StemHandle[];
  play(): Promise<void>;
  pause(): void;
  /** Seek every stem to `seconds`. */
  seek(seconds: number): void;
  setRate(rate: number): void;
  setVolume(name: string, volume: number): void;
  setMuted(name: string, muted: boolean): void;
  /**
   * Reconcile every stem's currentTime against `referenceSeconds` (typically
   * AlphaTab's reported playback position). Hard-seeks if drift > tolerance.
   * Cheap to call on every position-changed event.
   */
  syncTo(referenceSeconds: number): void;
  /** Tear down: pauses all, revokes URLs. */
  dispose(): void;
}

export function createStemPlayer(stems: StemTrack[]): StemPlayer {
  const handles: StemHandle[] = stems.map((s) => {
    const blobUrl = URL.createObjectURL(s.blob);
    const audio = new Audio(blobUrl);
    audio.preload = 'auto';
    audio.volume = s.volume ?? 0.8;
    audio.muted = s.muted ?? false;
    return { name: s.name, audio, blobUrl };
  });

  return {
    handles,

    async play() {
      // Web Audio policy: play() must be called from a user gesture.
      // AlphaTab's play button counts, so this is invoked from the same
      // synchronous handler chain.
      await Promise.all(handles.map((h) => h.audio.play().catch(() => {})));
    },

    pause() {
      for (const h of handles) h.audio.pause();
    },

    seek(seconds) {
      for (const h of handles) {
        try {
          h.audio.currentTime = seconds;
        } catch {
          /* readyState too low — will resync once buffered */
        }
      }
    },

    setRate(rate) {
      for (const h of handles) {
        h.audio.playbackRate = rate;
        // Most browsers preserve pitch by default since 2019; explicit for safety.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (h.audio as any).preservesPitch = true;
      }
    },

    setVolume(name, volume) {
      const h = handles.find((x) => x.name === name);
      if (h) h.audio.volume = volume;
    },

    setMuted(name, muted) {
      const h = handles.find((x) => x.name === name);
      if (h) h.audio.muted = muted;
    },

    syncTo(referenceSeconds) {
      for (const h of handles) {
        const drift = Math.abs(h.audio.currentTime - referenceSeconds) * 1000;
        if (drift > DRIFT_TOLERANCE_MS) {
          try {
            h.audio.currentTime = referenceSeconds;
          } catch {
            /* ignore */
          }
        }
      }
    },

    dispose() {
      for (const h of handles) {
        try {
          h.audio.pause();
        } catch {
          /* ignore */
        }
        URL.revokeObjectURL(h.blobUrl);
      }
      handles.length = 0;
    },
  };
}
