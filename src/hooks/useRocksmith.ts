/**
 * useRocksmith — real-time pitch feedback for the currently playing beat.
 *
 * The hook owns the detector instance, hit/miss flash state, and running
 * stats. The consumer (TabViewer) is responsible for two things:
 *   1. Render UI based on `active`, `stats`, `lastHit`.
 *   2. Forward each AlphaTab beat's expected MIDI to `onBeat()`.
 *
 * We expose `onBeat` rather than wiring AlphaTab listeners inside the hook
 * because the listener registration lives inside the AlphaTab init effect
 * (where `apiRef.current` is fresh) and that effect is the source of truth
 * for all engine-driven callbacks.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRocksmithDetector,
  type RocksmithDetector,
  type RocksmithEvent,
} from '../lib/rocksmith-detector';
import { toast } from '../components/Toast';

export interface RocksmithStats {
  hits: number;
  total: number;
}

export interface UseRocksmith {
  active: boolean;
  stats: RocksmithStats;
  /** True/false right after a beat resolves; null while idle or > 400 ms ago. */
  lastHit: boolean | null;
  toggle: () => Promise<void>;
  /** Forward the lowest-MIDI of the played beat to the detector. */
  onBeat: (midi: number) => void;
}

export function useRocksmith(): UseRocksmith {
  const detectorRef = useRef<RocksmithDetector | null>(null);
  const [active, setActive] = useState(false);
  const [stats, setStats] = useState<RocksmithStats>({ hits: 0, total: 0 });
  const [lastHit, setLastHit] = useState<boolean | null>(null);

  // Tear down detector on unmount.
  useEffect(() => () => { detectorRef.current?.stop(); }, []);

  const toggle = useCallback(async () => {
    if (active) {
      detectorRef.current?.stop();
      detectorRef.current = null;
      setActive(false);
      return;
    }
    try {
      const detector = createRocksmithDetector();
      detector.onEvent((e: RocksmithEvent) => {
        setLastHit(e.hit);
        setStats(detector.getStats());
        // Flash auto-clears so the colour doesn't get stuck after a pause.
        setTimeout(() => setLastHit(null), 400);
      });
      await detector.start();
      detectorRef.current = detector;
      setActive(true);
      setStats({ hits: 0, total: 0 });
      toast.success("Rocksmith mode activé — branche l'iRig !");
    } catch (err) {
      toast.error(`Micro indisponible: ${(err as Error).message}`);
    }
  }, [active]);

  const onBeat = useCallback((midi: number) => {
    detectorRef.current?.onBeat(midi);
  }, []);

  return { active, stats, lastHit, toggle, onBeat };
}
