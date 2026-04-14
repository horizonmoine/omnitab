/**
 * useStemSync — load Demucs stems from IndexedDB and keep them in lock-step
 * with the AlphaTab transport.
 *
 * Why imperative callbacks (`onPlayState`, `onPosition`) instead of internal
 * AlphaTab subscriptions?
 *   AlphaTab listener registration must happen inside the same effect that
 *   creates the API (so `apiRef.current` is fresh and `destroy()` cleans up
 *   listeners atomically). That effect lives in TabViewer. We expose
 *   imperative hooks the consumer can call from inside their listener
 *   handlers — keeps the integration boundary explicit.
 *
 * Returns `handles` from state (not the ref) so the mute-checkbox grid
 * re-renders on load/unload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createStemPlayer, type StemPlayer, type StemHandle } from '../lib/stem-sync';
import { getAllStems, type SavedStem } from '../lib/db';
import { toast } from '../components/Toast';

export interface UseStemSync {
  open: boolean;
  setOpen: (o: boolean | ((prev: boolean) => boolean)) => void;
  /** Map of song title → its stem rows from IndexedDB. */
  songs: Map<string, SavedStem[]>;
  /** Title of the currently loaded stem set, or null. */
  active: string | null;
  /** Per-stem-type mute flags. */
  mutes: Record<string, boolean>;
  /** Live audio handles (for rendering the per-stem mute UI). */
  handles: StemHandle[];
  load: (songTitle: string) => Promise<void>;
  unload: () => void;
  toggleMute: (name: string) => void;
  setRate: (rate: number) => void;
  /** Forward AlphaTab `playerStateChanged` (state===1 means playing). */
  onPlayState: (state: number) => void;
  /** Forward AlphaTab `playerPositionChanged.currentTime` (in ms). */
  onPositionMs: (currentTimeMs: number) => void;
}

interface AlphaTabApiLike {
  score?: { tracks?: unknown[] };
}

export function useStemSync(
  getApi: () => AlphaTabApiLike | null,
  isPlaying: boolean,
  speed: number,
): UseStemSync {
  const playerRef = useRef<StemPlayer | null>(null);
  const [open, setOpen] = useState(false);
  const [songs, setSongs] = useState<Map<string, SavedStem[]>>(new Map());
  const [active, setActive] = useState<string | null>(null);
  const [handles, setHandles] = useState<StemHandle[]>([]);
  const [mutes, setMutes] = useState<Record<string, boolean>>({
    // Default: silence the original guitar stem so the user-as-guitarist
    // isn't competing with the recording. That's the whole point of stems.
    guitar: true,
  });

  // Hydrate the song list from IndexedDB whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getAllStems().then((all) => {
      if (cancelled) return;
      const grouped = new Map<string, SavedStem[]>();
      for (const s of all) {
        const arr = grouped.get(s.songTitle) ?? [];
        arr.push(s);
        grouped.set(s.songTitle, arr);
      }
      setSongs(grouped);
    });
    return () => { cancelled = true; };
  }, [open]);

  // Always tear down on unmount.
  useEffect(() => () => { playerRef.current?.dispose(); }, []);

  const load = useCallback(async (songTitle: string) => {
    const stems = songs.get(songTitle);
    if (!stems || stems.length === 0) return;

    playerRef.current?.dispose();
    const player = createStemPlayer(
      stems.map((s) => ({
        name: s.stemType,
        blob: s.blob,
        muted: mutes[s.stemType] ?? false,
      })),
    );
    if (isPlaying) await player.play();
    player.setRate(speed / 100);
    playerRef.current = player;
    setHandles(player.handles);
    setActive(songTitle);
    toast.success(`Stems chargés : ${stems.map((s) => s.stemType).join(' + ')}`);
  }, [songs, mutes, isPlaying, speed]);

  const unload = useCallback(() => {
    playerRef.current?.dispose();
    playerRef.current = null;
    setHandles([]);
    setActive(null);
  }, []);

  const toggleMute = useCallback((name: string) => {
    setMutes((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      playerRef.current?.setMuted(name, next[name]);
      return next;
    });
  }, []);

  const setRate = useCallback((rate: number) => {
    playerRef.current?.setRate(rate);
  }, []);

  const onPlayState = useCallback((state: number) => {
    const sp = playerRef.current;
    if (!sp) return;
    if (state === 1) sp.play();
    else sp.pause();
  }, []);

  const onPositionMs = useCallback((currentTimeMs: number) => {
    const sp = playerRef.current;
    if (sp && typeof currentTimeMs === 'number') {
      sp.syncTo(currentTimeMs / 1000);
    }
  }, []);

  // Keep the parameter referenced so it isn't pruned by treeshake-aware checks
  // — and to give a future hook revision room to read API state directly.
  void getApi;

  return {
    open,
    setOpen,
    songs,
    active,
    mutes,
    handles,
    load,
    unload,
    toggleMute,
    setRate,
    onPlayState,
    onPositionMs,
  };
}
