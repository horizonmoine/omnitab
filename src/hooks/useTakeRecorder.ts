/**
 * useTakeRecorder — toolbar-friendly play-along recording.
 *
 * Owns the MediaRecorder lifecycle and persistence to IndexedDB. The caller
 * (TabViewer) only needs to render a button that calls `toggle()` and shows
 * `taking` / `elapsedSeconds`.
 *
 * Why a hook (not just a util)?
 *   The elapsed-time counter needs a `setInterval` tied to mount lifecycle.
 *   Auto-cancel-on-unmount is critical (an orphaned recorder leaves the OS
 *   mic LED on). Both belong in a custom hook with effect cleanup, not in
 *   the consumer.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { startTake, type TakeRecorder } from '../lib/take-recorder';
import { saveRecording } from '../lib/db';
import { toast } from '../components/Toast';

interface AlphaTabApiLike {
  score?: { title?: string };
}

export interface UseTakeRecorder {
  /** True while a take is being captured. */
  taking: boolean;
  /** Wall-clock seconds since recording started (0 when idle). */
  elapsedSeconds: number;
  /** Start a take, or stop + save the in-flight one. */
  toggle: () => Promise<void>;
}

export function useTakeRecorder(getApi: () => AlphaTabApiLike | null): UseTakeRecorder {
  const recRef = useRef<TakeRecorder | null>(null);
  const [taking, setTaking] = useState(false);
  const [startMs, setStartMs] = useState(0);
  const [elapsedSeconds, setElapsed] = useState(0);

  // Tick the elapsed counter while recording.
  useEffect(() => {
    if (!taking) return;
    const id = window.setInterval(() => {
      setElapsed((performance.now() - startMs) / 1000);
    }, 250);
    return () => window.clearInterval(id);
  }, [taking, startMs]);

  // Cancel any in-flight take on unmount — releases the mic immediately.
  useEffect(() => () => { recRef.current?.cancel(); }, []);

  const toggle = useCallback(async () => {
    // Stop branch.
    if (taking && recRef.current) {
      try {
        const { blob, durationSeconds } = await recRef.current.stop();
        const title = getApi()?.score?.title?.trim() || 'Sans titre';
        const stamp = new Date().toLocaleString('fr-FR', { hour12: false });
        await saveRecording(`${title} — prise du ${stamp}`, blob, durationSeconds);
        toast.success(
          `🎙️ Prise sauvegardée (${durationSeconds.toFixed(1)}s, ${(blob.size / 1024).toFixed(0)} KB)`,
        );
      } catch (err) {
        toast.error(`Échec sauvegarde : ${(err as Error).message}`);
      } finally {
        recRef.current = null;
        setTaking(false);
        setElapsed(0);
      }
      return;
    }

    // Start branch.
    try {
      recRef.current = await startTake();
      setStartMs(performance.now());
      setElapsed(0);
      setTaking(true);
      toast.info('🎙️ Enregistrement en cours…');
    } catch (err) {
      toast.error(`Micro indisponible : ${(err as Error).message}`);
    }
  }, [taking, getApi]);

  return { taking, elapsedSeconds, toggle };
}
