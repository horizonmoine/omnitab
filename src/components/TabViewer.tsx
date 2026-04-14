/**
 * AlphaTab Pro viewer — the heart of OmniTab.
 *
 * Full-featured tab player comparable to Songsterr:
 *   - Play/pause/stop with cursor tracking
 *   - Track selector (guitar, bass, drums, vocals...)
 *   - Speed control (25%–200%)
 *   - Count-in before playback
 *   - Loop mode (repeat current section)
 *   - Zoom control
 *   - Keyboard shortcuts (Space=play/pause, Left/Right=prev/next bar)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { appBus } from '../lib/event-bus';
import { createRocksmithDetector, type RocksmithDetector, type RocksmithEvent } from '../lib/rocksmith-detector';
import { extractBeats } from '../lib/alpha-tab-beats';
import { transcribeAudio } from '../lib/basic-pitch';
import { decodeAndResample } from '../lib/audio-engine';
import { diffTabVsAudio, healerScore, type HealerFlag } from '../lib/tab-healer';
import { createStemPlayer, type StemPlayer } from '../lib/stem-sync';
import { startTake, type TakeRecorder } from '../lib/take-recorder';
import { getAllStems, saveRecording, type SavedStem } from '../lib/db';
import { toast } from './Toast';

interface TabViewerProps {
  /** Binary data of a .gp/.gp5/.gpx file, OR a string of alphaTex / MusicXML. */
  source: ArrayBuffer | Uint8Array | string;
  onReady?: () => void;
}

const CDN = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.5.0/dist';

interface TrackInfo {
  index: number;
  name: string;
  instrument: string;
}

export function TabViewer({ source, onReady }: TabViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [activeTrack, setActiveTrack] = useState(0);
  const [countIn, setCountIn] = useState(false);
  const [looping, setLooping] = useState(false);
  const [zoom, setZoom] = useState(1.0);
  const [currentBar, setCurrentBar] = useState(0);
  const [totalBars, setTotalBars] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);

  // Rocksmith mode state
  const rocksmithRef = useRef<RocksmithDetector | null>(null);
  const [rocksmithActive, setRocksmithActive] = useState(false);
  const [rocksmithStats, setRocksmithStats] = useState({ hits: 0, total: 0 });
  const [lastHit, setLastHit] = useState<boolean | null>(null);

  // Stem sync state
  const stemPlayerRef = useRef<StemPlayer | null>(null);
  const [stemsOpen, setStemsOpen] = useState(false);
  const [stemSongs, setStemSongs] = useState<Map<string, SavedStem[]>>(new Map());
  const [activeStemSong, setActiveStemSong] = useState<string | null>(null);
  const [stemMutes, setStemMutes] = useState<Record<string, boolean>>({
    // The user's own guitar should silence the original guitar stem by default
    // — that's the whole point of "play along to the song without the guitar".
    guitar: true,
  });

  // Take-recorder state
  const takeRef = useRef<TakeRecorder | null>(null);
  const [taking, setTaking] = useState(false);
  const [takeStartMs, setTakeStartMs] = useState(0);
  const [takeElapsed, setTakeElapsed] = useState(0);

  // Tick the elapsed counter while recording.
  useEffect(() => {
    if (!taking) return;
    const id = window.setInterval(() => {
      setTakeElapsed((performance.now() - takeStartMs) / 1000);
    }, 250);
    return () => window.clearInterval(id);
  }, [taking, takeStartMs]);

  // Tab Healer state
  const [healerOpen, setHealerOpen] = useState(false);
  const [healerRunning, setHealerRunning] = useState(false);
  const [healerStatus, setHealerStatus] = useState('');
  const [healerFlags, setHealerFlags] = useState<HealerFlag[] | null>(null);
  const [healerScoreValue, setHealerScoreValue] = useState<number | null>(null);

  // Initialize the AlphaTab API.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setTracks([]);
    setActiveTrack(0);

    (async () => {
      try {
        const alphatab = await import('@coderline/alphatab');
        if (cancelled || !containerRef.current) return;

        const settings = new alphatab.Settings();
        settings.core.fontDirectory = `${CDN}/font/`;
        settings.core.engine = 'svg';
        settings.player.enablePlayer = true;
        settings.player.enableCursor = true;
        settings.player.enableUserInteraction = true;
        settings.player.soundFont = `${CDN}/soundfont/sonivox.sf2`;
        settings.player.scrollMode = alphatab.ScrollMode.Continuous;
        settings.display.staveProfile = alphatab.StaveProfile.ScoreTab;
        settings.display.scale = zoom;

        const api = new alphatab.AlphaTabApi(containerRef.current, settings);
        apiRef.current = api;

        api.scoreLoaded.on((score: { tracks: Array<{ name: string; staves: Array<unknown> }> }) => {
          if (cancelled) return;
          setIsLoading(false);

          // Extract track info.
          const trackList: TrackInfo[] = score.tracks.map((t, i) => ({
            index: i,
            name: t.name || `Piste ${i + 1}`,
            instrument: t.name || 'Unknown',
          }));
          setTracks(trackList);

          // Count bars from first track.
          try {
            const firstTrack = score.tracks[0];
            if (firstTrack && 'staves' in firstTrack) {
              const staves = firstTrack.staves as Array<{ bars: Array<unknown> }>;
              if (staves.length > 0 && staves[0].bars) {
                setTotalBars(staves[0].bars.length);
              }
            }
          } catch {
            /* ok */
          }

          onReady?.();
        });

        api.playerStateChanged.on((args: { state: number }) => {
          setIsPlaying(args.state === 1);
          // Drive stems in lock-step with AlphaTab transport.
          const sp = stemPlayerRef.current;
          if (sp) {
            if (args.state === 1) sp.play();
            else sp.pause();
          }
        });

        // Stem drift correction. AlphaTab fires this every ~50 ms during play.
        api.playerPositionChanged?.on?.((args: { currentTime: number }) => {
          const sp = stemPlayerRef.current;
          if (sp && typeof args?.currentTime === 'number') {
            sp.syncTo(args.currentTime / 1000);
          }
        });

        api.playedBeatChanged.on((beat: {
          voice?: { bar?: { index?: number } };
          notes?: Array<{ realValue?: number }>;
        }) => {
          try {
            const barIndex = beat?.voice?.bar?.index;
            if (barIndex != null) setCurrentBar(barIndex + 1);

            // Rocksmith mode: push the lowest-MIDI note as the expected target.
            const rs = rocksmithRef.current;
            if (rs && beat.notes && beat.notes.length > 0) {
              const midis = beat.notes
                .map((n) => n.realValue)
                .filter((m): m is number => typeof m === 'number');
              if (midis.length > 0) {
                const lowest = Math.min(...midis);
                rs.onBeat(lowest);
              }
            }
          } catch {
            /* ok */
          }
        });

        api.error.on((e: unknown) => {
          console.error('[alphatab]', e);
          setError('Impossible de charger ou lire ce fichier.');
          setIsLoading(false);
        });

        // Load the source.
        if (typeof source === 'string') {
          api.tex(source);
        } else {
          api.load(source);
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) {
          setError("AlphaTab a échoué à s'initialiser.");
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        apiRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      apiRef.current = null;
    };
  }, [source, onReady]);

  // Apply zoom changes.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !api.settings) return;
    api.settings.display.scale = zoom;
    api.updateSettings();
    api.render();
  }, [zoom]);

  const togglePlay = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (countIn && !isPlaying) {
      api.countInVolume = 1;
    } else {
      api.countInVolume = 0;
    }
    api.playPause();
  }, [countIn, isPlaying]);

  const stop = useCallback(() => {
    apiRef.current?.stop?.();
  }, []);

  const updateSpeed = useCallback((pct: number) => {
    setSpeed(pct);
    const api = apiRef.current;
    if (api) {
      api.playbackSpeed = pct / 100;
    }
    stemPlayerRef.current?.setRate(pct / 100);
  }, []);

  /** Load all saved stems for a song from IndexedDB and start syncing them. */
  const loadStemSet = useCallback(async (songTitle: string) => {
    const stems = stemSongs.get(songTitle);
    if (!stems || stems.length === 0) return;

    // Tear down any previous set first.
    stemPlayerRef.current?.dispose();
    const player = createStemPlayer(
      stems.map((s) => ({
        name: s.stemType,
        blob: s.blob,
        muted: stemMutes[s.stemType] ?? false,
      })),
    );
    // Mute the in-engine guitar track so we don't hear two guitars stacked.
    const api = apiRef.current;
    if (api && stemMutes.guitar) {
      try {
        api.changeTrackMute?.(api.score?.tracks ?? [], false);
      } catch { /* ignore — older AlphaTab signatures vary */ }
    }
    // If the user already pressed play, kick stems off too.
    if (isPlaying) await player.play();
    player.setRate(speed / 100);
    stemPlayerRef.current = player;
    setActiveStemSong(songTitle);
    toast.success(`Stems chargés : ${stems.map((s) => s.stemType).join(' + ')}`);
  }, [stemSongs, stemMutes, isPlaying, speed]);

  const unloadStems = useCallback(() => {
    stemPlayerRef.current?.dispose();
    stemPlayerRef.current = null;
    setActiveStemSong(null);
  }, []);

  const toggleTake = useCallback(async () => {
    // Stop branch — flush, save to IndexedDB, toast.
    if (taking && takeRef.current) {
      try {
        const { blob, durationSeconds } = await takeRef.current.stop();
        const title =
          (apiRef.current?.score?.title as string | undefined)?.trim() ||
          'Sans titre';
        const stamp = new Date().toLocaleString('fr-FR', { hour12: false });
        await saveRecording(`${title} — prise du ${stamp}`, blob, durationSeconds);
        toast.success(
          `🎙️ Prise sauvegardée (${durationSeconds.toFixed(1)}s, ${(blob.size / 1024).toFixed(0)} KB)`,
        );
      } catch (err) {
        toast.error(`Échec sauvegarde : ${(err as Error).message}`);
      } finally {
        takeRef.current = null;
        setTaking(false);
        setTakeElapsed(0);
      }
      return;
    }

    // Start branch.
    try {
      takeRef.current = await startTake();
      setTakeStartMs(performance.now());
      setTakeElapsed(0);
      setTaking(true);
      toast.info('🎙️ Enregistrement en cours…');
    } catch (err) {
      toast.error(`Micro indisponible : ${(err as Error).message}`);
    }
  }, [taking]);

  // Cancel any in-flight take if the viewer unmounts mid-recording.
  useEffect(() => () => { takeRef.current?.cancel(); }, []);

  const toggleStemMute = useCallback((name: string) => {
    setStemMutes((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      stemPlayerRef.current?.setMuted(name, next[name]);
      return next;
    });
  }, []);

  // When the panel opens, list available stem-songs from IndexedDB.
  useEffect(() => {
    if (!stemsOpen) return;
    let cancelled = false;
    getAllStems().then((all) => {
      if (cancelled) return;
      const grouped = new Map<string, SavedStem[]>();
      for (const s of all) {
        const arr = grouped.get(s.songTitle) ?? [];
        arr.push(s);
        grouped.set(s.songTitle, arr);
      }
      setStemSongs(grouped);
    });
    return () => { cancelled = true; };
  }, [stemsOpen]);

  // Always tear down stems on unmount.
  useEffect(() => () => { stemPlayerRef.current?.dispose(); }, []);

  const switchTrack = useCallback((index: number) => {
    setActiveTrack(index);
    const api = apiRef.current;
    if (!api?.score?.tracks) return;
    const track = api.score.tracks[index];
    if (track) {
      api.renderTracks([track]);
    }
  }, []);

  const toggleRocksmith = useCallback(async () => {
    if (rocksmithActive) {
      rocksmithRef.current?.stop();
      rocksmithRef.current = null;
      setRocksmithActive(false);
      return;
    }
    try {
      const detector = createRocksmithDetector();
      detector.onEvent((e: RocksmithEvent) => {
        setLastHit(e.hit);
        setRocksmithStats(detector.getStats());
        // Flash clears after 400ms.
        setTimeout(() => setLastHit(null), 400);
      });
      await detector.start();
      rocksmithRef.current = detector;
      setRocksmithActive(true);
      setRocksmithStats({ hits: 0, total: 0 });
      toast.success('Rocksmith mode activé — branche l\'iRig !');
    } catch (err) {
      toast.error(`Micro indisponible: ${(err as Error).message}`);
    }
  }, [rocksmithActive]);

  // Clean up Rocksmith detector on unmount.
  useEffect(() => () => { rocksmithRef.current?.stop(); }, []);

  /**
   * Run Tab Healer: extract beats from the currently active track, transcribe
   * the user-uploaded reference audio with basic-pitch, and diff the two.
   */
  const runHealer = useCallback(async (file: File) => {
    const api = apiRef.current;
    if (!api?.score?.tracks) {
      toast.error('La tab n\'est pas encore chargée.');
      return;
    }
    const track = api.score.tracks[activeTrack];
    if (!track) return;

    setHealerRunning(true);
    setHealerFlags(null);
    setHealerScoreValue(null);
    try {
      const beats = extractBeats(track);
      if (beats.length === 0) {
        toast.error('Aucune note exploitable dans la piste sélectionnée.');
        return;
      }

      setHealerStatus('Décodage de l\'audio…');
      const audioBuffer = await decodeAndResample(file, 22050);

      const detected = await transcribeAudio(audioBuffer, undefined, ({ status }) =>
        setHealerStatus(status),
      );

      setHealerStatus('Comparaison tab vs audio…');
      const flags = diffTabVsAudio(beats, detected);
      const score = healerScore(beats.length, flags);
      setHealerFlags(flags);
      setHealerScoreValue(score);
      setHealerStatus(`✅ ${flags.length} signalements sur ${beats.length} beats`);
    } catch (err) {
      toast.error(`Healer a échoué : ${(err as Error).message}`);
      setHealerStatus('');
    } finally {
      setHealerRunning(false);
    }
  }, [activeTrack]);

  const toggleLoop = useCallback(() => {
    setLooping((prev) => {
      const next = !prev;
      const api = apiRef.current;
      if (api) {
        api.isLooping = next;
      }
      return next;
    });
  }, []);

  // Keyboard shortcuts.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          updateSpeed(Math.max(25, speed - 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          updateSpeed(Math.min(200, speed + 5));
          break;
        case 'KeyL':
          e.preventDefault();
          toggleLoop();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, updateSpeed, speed, toggleLoop]);

  // Wire the global event bus (MIDI pedals + voice commands).
  useEffect(() => {
    const offs = [
      appBus.on('play-pause', togglePlay),
      appBus.on('stop', stop),
      appBus.on('loop-toggle', toggleLoop),
      appBus.on('speed-down', () => updateSpeed(Math.max(25, speed - 5))),
      appBus.on('speed-up', () => updateSpeed(Math.min(200, speed + 5))),
    ];
    return () => { for (const off of offs) off(); };
  }, [togglePlay, stop, toggleLoop, updateSpeed, speed]);

  return (
    <div className="flex flex-col h-full">
      {/* Top toolbar */}
      <div className="bg-amp-panel border-b border-amp-border px-3 py-2">
        {/* Row 1: Play controls + speed */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={togglePlay}
            disabled={isLoading}
            className="rounded bg-amp-accent hover:bg-amp-accent-hover disabled:bg-amp-muted disabled:cursor-not-allowed text-amp-bg font-bold px-4 py-1.5 transition-colors"
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button
            onClick={stop}
            disabled={isLoading}
            className="rounded bg-amp-panel-2 hover:bg-amp-border text-amp-text px-3 py-1.5 transition-colors"
          >
            ⏹
          </button>

          {/* Count-in toggle */}
          <button
            onClick={() => setCountIn((c) => !c)}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              countIn
                ? 'bg-amp-accent text-amp-bg'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title="Count-in (décompte avant lecture)"
          >
            1234
          </button>

          {/* Loop toggle */}
          <button
            onClick={toggleLoop}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              looping
                ? 'bg-amp-accent text-amp-bg'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title="Boucle (L)"
          >
            🔁
          </button>

          {/* Take recorder */}
          <button
            onClick={toggleTake}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              taking
                ? 'bg-amp-error text-white animate-pulse'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title={taking ? 'Arrêter et sauvegarder la prise' : 'Enregistrer une prise (mic)'}
          >
            {taking ? `● ${takeElapsed.toFixed(0)}s` : '🎙️'}
          </button>

          {/* Stem-sync toggle */}
          <button
            onClick={() => setStemsOpen((o) => !o)}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              stemsOpen || activeStemSong
                ? 'bg-amp-accent text-amp-bg'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title="Stems synchronisés (jouer avec l'audio original)"
          >
            🎵
          </button>

          {/* Tab Healer toggle */}
          <button
            onClick={() => setHealerOpen((o) => !o)}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              healerOpen
                ? 'bg-amp-accent text-amp-bg'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title="Tab Healer — vérifier la tab contre un audio"
          >
            🔍
          </button>

          {/* Rocksmith toggle */}
          <button
            onClick={toggleRocksmith}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              rocksmithActive
                ? 'bg-amp-success text-white animate-pulse'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title="Mode Rocksmith — feedback temps réel via iRig"
          >
            🎸
          </button>

          {/* Bar counter */}
          {totalBars > 0 && (
            <span className="text-xs text-amp-muted font-mono ml-1">
              {currentBar}/{totalBars}
            </span>
          )}

          {/* Speed control */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => updateSpeed(Math.max(25, speed - 5))}
              className="text-amp-muted hover:text-amp-text text-xs px-1"
            >
              −
            </button>
            <input
              type="range"
              min={25}
              max={200}
              value={speed}
              onChange={(e) => updateSpeed(Number(e.target.value))}
              className="w-24 accent-amp-accent"
            />
            <button
              onClick={() => updateSpeed(Math.min(200, speed + 5))}
              className="text-amp-muted hover:text-amp-text text-xs px-1"
            >
              +
            </button>
            <span className="font-mono text-amp-text text-xs w-10 text-right">
              {speed}%
            </span>
          </div>

          {/* Share (only for alphaTex string sources) */}
          {typeof source === 'string' && (
            <button
              onClick={() => {
                const encoded = btoa(source);
                const url = `${window.location.origin}${window.location.pathname}?tab=${encoded}`;
                navigator.clipboard.writeText(url).then(() => {
                  setShareCopied(true);
                  setTimeout(() => setShareCopied(false), 2000);
                });
              }}
              className="px-2 py-1.5 rounded text-xs font-bold bg-amp-panel-2 text-amp-muted hover:text-amp-text transition-colors border-l border-amp-border ml-1"
              title="Copier le lien de partage"
            >
              {shareCopied ? '✓ Copié' : '🔗 Partager'}
            </button>
          )}

          {/* Zoom */}
          <div className="flex items-center gap-1 border-l border-amp-border pl-2">
            <button
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
              className="text-amp-muted hover:text-amp-text text-xs px-1"
            >
              🔍−
            </button>
            <span className="text-xs text-amp-muted font-mono w-8 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              className="text-amp-muted hover:text-amp-text text-xs px-1"
            >
              🔍+
            </button>
          </div>
        </div>

        {/* Row 2: Track selector (only if multiple tracks) */}
        {tracks.length > 1 && (
          <div className="flex gap-1 mt-2 overflow-x-auto pb-1">
            {tracks.map((t) => (
              <button
                key={t.index}
                onClick={() => switchTrack(t.index)}
                className={`px-3 py-1 rounded text-xs whitespace-nowrap transition-colors ${
                  activeTrack === t.index
                    ? 'bg-amp-accent text-amp-bg font-bold'
                    : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>
        )}

        {/* Speed presets */}
        <div className="flex gap-1 mt-1">
          {[25, 50, 75, 100, 125, 150].map((s) => (
            <button
              key={s}
              onClick={() => updateSpeed(s)}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                speed === s
                  ? 'bg-amp-accent text-amp-bg font-bold'
                  : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
              }`}
            >
              {s}%
            </button>
          ))}
        </div>
      </div>

      {/* Stem-sync panel */}
      {stemsOpen && (
        <div className="bg-amp-panel border-b border-amp-border px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-bold text-amp-accent">🎵 Stems synchronisés</div>
              <p className="text-xs text-amp-muted">
                Charge les stems Demucs d'une chanson : ils suivent le curseur de la tab.
                Sépare l'audio depuis la page Transcrire pour en ajouter.
              </p>
            </div>
            {activeStemSong && (
              <button
                onClick={unloadStems}
                className="text-xs text-amp-error hover:underline"
              >
                ✕ Décharger
              </button>
            )}
          </div>

          {stemSongs.size === 0 ? (
            <p className="text-xs text-amp-muted italic">
              Aucun stem sauvegardé. Va dans Transcrire → "Séparer tous les stems".
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1 mb-3">
                {Array.from(stemSongs.keys()).map((title) => (
                  <button
                    key={title}
                    onClick={() => loadStemSet(title)}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      activeStemSong === title
                        ? 'bg-amp-accent text-amp-bg font-bold'
                        : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
                    }`}
                  >
                    {title} ({stemSongs.get(title)?.length})
                  </button>
                ))}
              </div>

              {activeStemSong && (
                <div className="flex flex-wrap gap-2">
                  {stemPlayerRef.current?.handles.map((h) => (
                    <label
                      key={h.name}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer ${
                        stemMutes[h.name]
                          ? 'bg-amp-bg/40 text-amp-muted line-through'
                          : 'bg-amp-panel-2 text-amp-text'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!stemMutes[h.name]}
                        onChange={() => toggleStemMute(h.name)}
                        className="accent-amp-accent"
                      />
                      {h.name}
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab Healer panel */}
      {healerOpen && (
        <div className="bg-amp-panel border-b border-amp-border px-3 py-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <div className="text-sm font-bold text-amp-accent">🔍 Tab Healer</div>
              <p className="text-xs text-amp-muted">
                Charge l'audio original : on compare la tab à une transcription IA
                pour repérer les notes douteuses.
              </p>
            </div>
            {healerScoreValue !== null && (
              <div
                className={`px-3 py-1.5 rounded font-mono text-sm ${
                  healerScoreValue > 0.8
                    ? 'bg-green-500/20 text-green-400'
                    : healerScoreValue > 0.5
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-red-500/20 text-red-400'
                }`}
                title="Confiance globale de la tab"
              >
                Fiabilité : {Math.round(healerScoreValue * 100)}%
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="inline-block">
              <span className="bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-3 py-1.5 rounded text-xs cursor-pointer inline-block">
                {healerRunning ? '⏳ Analyse…' : '📂 Choisir un audio'}
              </span>
              <input
                type="file"
                accept="audio/*"
                disabled={healerRunning}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) runHealer(f);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
            {healerStatus && (
              <span className="text-xs text-amp-muted" aria-live="polite">
                {healerStatus}
              </span>
            )}
          </div>

          {healerFlags && healerFlags.length > 0 && (
            <ul className="mt-3 max-h-40 overflow-y-auto bg-amp-bg/40 rounded border border-amp-border divide-y divide-amp-border">
              {healerFlags.slice(0, 100).map((f, i) => (
                <li
                  key={i}
                  onClick={() => apiRef.current?.timePosition && (apiRef.current.timePosition = f.timeSeconds * 1000)}
                  className={`px-3 py-1.5 text-xs cursor-pointer hover:bg-amp-panel-2 ${
                    f.severity === 'error'
                      ? 'text-red-400'
                      : f.severity === 'warning'
                        ? 'text-yellow-400'
                        : 'text-amp-muted'
                  }`}
                  title="Cliquer pour aller à ce moment"
                >
                  <span className="font-mono mr-2">
                    {f.timeSeconds.toFixed(2)}s
                  </span>
                  {f.message}
                </li>
              ))}
              {healerFlags.length > 100 && (
                <li className="px-3 py-1.5 text-xs text-amp-muted italic">
                  …{healerFlags.length - 100} autres signalements masqués
                </li>
              )}
            </ul>
          )}

          {healerFlags && healerFlags.length === 0 && (
            <div className="mt-3 text-xs text-green-400">
              ✓ Aucun désaccord détecté — la tab semble fiable.
            </div>
          )}
        </div>
      )}

      {/* AlphaTab render area */}
      <div className="flex-1 relative overflow-auto bg-white">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-amp-bg/80 text-amp-text z-10">
            <div className="text-center">
              <div className="animate-pulse text-amp-accent text-xl mb-2">
                Chargement de la tab...
              </div>
              <div className="text-sm text-amp-muted">
                (Première visite : téléchargement des polices et du soundfont)
              </div>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-amp-bg text-amp-error p-4 z-10">
            {error}
          </div>
        )}
        <div ref={containerRef} className="min-h-full" />

        {/* Rocksmith HUD overlay */}
        {rocksmithActive && (
          <>
            {/* Hit/miss flash over the whole viewport */}
            {lastHit !== null && (
              <div
                className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-300 ${
                  lastHit ? 'bg-green-500/20' : 'bg-red-500/25'
                }`}
              />
            )}

            {/* Stats panel, top-right */}
            <div className="absolute top-3 right-3 z-30 bg-amp-bg/90 border border-amp-border rounded-lg shadow-lg px-4 py-3 min-w-[140px] backdrop-blur">
              <div className="text-[10px] uppercase tracking-wide text-amp-muted mb-1">
                🎸 Rocksmith
              </div>
              <div className="font-mono text-3xl text-amp-accent leading-none">
                {rocksmithStats.total > 0
                  ? Math.round((rocksmithStats.hits / rocksmithStats.total) * 100)
                  : 0}
                <span className="text-base text-amp-muted">%</span>
              </div>
              <div className="font-mono text-xs text-amp-muted mt-1">
                {rocksmithStats.hits} / {rocksmithStats.total} notes
              </div>
              {lastHit !== null && (
                <div
                  className={`mt-2 text-center font-bold text-sm ${
                    lastHit ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {lastHit ? '✓ HIT' : '✗ MISS'}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Keyboard shortcut hint */}
      <div className="bg-amp-panel border-t border-amp-border px-3 py-1 text-xs text-amp-muted flex gap-4">
        <span>Espace: play/pause</span>
        <span>← →: vitesse ±5%</span>
        <span>L: boucle</span>
      </div>
    </div>
  );
}
