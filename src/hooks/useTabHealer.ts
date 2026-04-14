/**
 * useTabHealer — diff a loaded AlphaTab score against an IA transcription
 * of the original audio, surface flagged beats.
 *
 * Caller responsibilities:
 *   - Pass `getApi()` so the hook can read `score.tracks[activeTrack]`.
 *   - Pass the active track index — switching tracks invalidates flags.
 *   - Render the flag list and call `seek(seconds)` on click (we expose a
 *     helper that drives `apiRef.current.timePosition` to keep that
 *     imperative AlphaTab interaction inside the hook).
 */

import { useCallback, useState } from 'react';
import { extractBeats } from '../lib/alpha-tab-beats';
import { transcribeAudio } from '../lib/basic-pitch';
import { decodeAndResample } from '../lib/audio-engine';
import { diffTabVsAudio, healerScore, type HealerFlag } from '../lib/tab-healer';
import { toast } from '../components/Toast';

interface AlphaTabApiLike {
  score?: { tracks?: unknown[] };
  timePosition?: number;
}

export interface UseTabHealer {
  open: boolean;
  setOpen: (o: boolean | ((prev: boolean) => boolean)) => void;
  running: boolean;
  status: string;
  flags: HealerFlag[] | null;
  /** 0..1, null when no analysis has been run yet. */
  score: number | null;
  run: (file: File) => Promise<void>;
  seek: (seconds: number) => void;
}

export function useTabHealer(
  getApi: () => AlphaTabApiLike | null,
  activeTrack: number,
): UseTabHealer {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [flags, setFlags] = useState<HealerFlag[] | null>(null);
  const [score, setScore] = useState<number | null>(null);

  const run = useCallback(async (file: File) => {
    const api = getApi();
    if (!api?.score?.tracks) {
      toast.error("La tab n'est pas encore chargée.");
      return;
    }
    const track = api.score.tracks[activeTrack];
    if (!track) return;

    setRunning(true);
    setFlags(null);
    setScore(null);
    try {
      const beats = extractBeats(track as Parameters<typeof extractBeats>[0]);
      if (beats.length === 0) {
        toast.error('Aucune note exploitable dans la piste sélectionnée.');
        return;
      }

      setStatus("Décodage de l'audio…");
      const audioBuffer = await decodeAndResample(file, 22050);

      const detected = await transcribeAudio(audioBuffer, undefined, ({ status: s }) =>
        setStatus(s),
      );

      setStatus('Comparaison tab vs audio…');
      const fl = diffTabVsAudio(beats, detected);
      const sc = healerScore(beats.length, fl);
      setFlags(fl);
      setScore(sc);
      setStatus(`✅ ${fl.length} signalements sur ${beats.length} beats`);
    } catch (err) {
      toast.error(`Healer a échoué : ${(err as Error).message}`);
      setStatus('');
    } finally {
      setRunning(false);
    }
  }, [getApi, activeTrack]);

  const seek = useCallback((seconds: number) => {
    const api = getApi();
    if (api && typeof api.timePosition === 'number') {
      api.timePosition = seconds * 1000;
    }
  }, [getApi]);

  return { open, setOpen, running, status, flags, score, run, seek };
}
