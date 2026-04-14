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
import { useRocksmith } from '../hooks/useRocksmith';
import { useTakeRecorder } from '../hooks/useTakeRecorder';
import { useTabHealer } from '../hooks/useTabHealer';
import { useStemSync } from '../hooks/useStemSync';

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

  // Stable getter so hooks can read fresh apiRef without re-running deps.
  const getApi = useCallback(() => apiRef.current, []);

  // Four feature hooks — each owns its slice of state, refs and cleanup.
  const rocksmith = useRocksmith();
  const take = useTakeRecorder(getApi);
  const healer = useTabHealer(getApi, activeTrack);
  const stems = useStemSync(getApi, isPlaying, speed);

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
          stems.onPlayState(args.state);
        });

        // Stem drift correction. AlphaTab fires this every ~50 ms during play.
        api.playerPositionChanged?.on?.((args: { currentTime: number }) => {
          stems.onPositionMs(args?.currentTime);
        });

        api.playedBeatChanged.on((beat: {
          voice?: { bar?: { index?: number } };
          notes?: Array<{ realValue?: number }>;
        }) => {
          try {
            const barIndex = beat?.voice?.bar?.index;
            if (barIndex != null) setCurrentBar(barIndex + 1);

            // Rocksmith mode: push the lowest-MIDI note as the expected target.
            if (beat.notes && beat.notes.length > 0) {
              const midis = beat.notes
                .map((n) => n.realValue)
                .filter((m): m is number => typeof m === 'number');
              if (midis.length > 0) {
                rocksmith.onBeat(Math.min(...midis));
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
    stems.setRate(pct / 100);
  }, [stems]);

  const switchTrack = useCallback((index: number) => {
    setActiveTrack(index);
    const api = apiRef.current;
    if (!api?.score?.tracks) return;
    const track = api.score.tracks[index];
    if (track) {
      api.renderTracks([track]);
    }
  }, []);

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
            onClick={take.toggle}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              take.taking
                ? 'bg-amp-error text-white animate-pulse'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title={take.taking ? 'Arrêter et sauvegarder la prise' : 'Enregistrer une prise (mic)'}
          >
            {take.taking ? `● ${take.elapsedSeconds.toFixed(0)}s` : '🎙️'}
          </button>

          {/* Stem-sync toggle */}
          <button
            onClick={() => stems.setOpen((o) => !o)}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              stems.open || stems.active
                ? 'bg-amp-accent text-amp-bg'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title="Stems synchronisés (jouer avec l'audio original)"
          >
            🎵
          </button>

          {/* Tab Healer toggle */}
          <button
            onClick={() => healer.setOpen((o) => !o)}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              healer.open
                ? 'bg-amp-accent text-amp-bg'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title="Tab Healer — vérifier la tab contre un audio"
          >
            🔍
          </button>

          {/* Rocksmith toggle */}
          <button
            onClick={rocksmith.toggle}
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              rocksmith.active
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
      {stems.open && (
        <div className="bg-amp-panel border-b border-amp-border px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm font-bold text-amp-accent">🎵 Stems synchronisés</div>
              <p className="text-xs text-amp-muted">
                Charge les stems Demucs d'une chanson : ils suivent le curseur de la tab.
                Sépare l'audio depuis la page Transcrire pour en ajouter.
              </p>
            </div>
            {stems.active && (
              <button
                onClick={stems.unload}
                className="text-xs text-amp-error hover:underline"
              >
                ✕ Décharger
              </button>
            )}
          </div>

          {stems.songs.size === 0 ? (
            <p className="text-xs text-amp-muted italic">
              Aucun stem sauvegardé. Va dans Transcrire → "Séparer tous les stems".
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-1 mb-3">
                {Array.from(stems.songs.keys()).map((title) => (
                  <button
                    key={title}
                    onClick={() => stems.load(title)}
                    className={`px-3 py-1 rounded text-xs transition-colors ${
                      stems.active === title
                        ? 'bg-amp-accent text-amp-bg font-bold'
                        : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
                    }`}
                  >
                    {title} ({stems.songs.get(title)?.length})
                  </button>
                ))}
              </div>

              {stems.active && (
                <div className="flex flex-wrap gap-2">
                  {stems.handles.map((h) => (
                    <label
                      key={h.name}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs cursor-pointer ${
                        stems.mutes[h.name]
                          ? 'bg-amp-bg/40 text-amp-muted line-through'
                          : 'bg-amp-panel-2 text-amp-text'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!stems.mutes[h.name]}
                        onChange={() => stems.toggleMute(h.name)}
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
      {healer.open && (
        <div className="bg-amp-panel border-b border-amp-border px-3 py-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div>
              <div className="text-sm font-bold text-amp-accent">🔍 Tab Healer</div>
              <p className="text-xs text-amp-muted">
                Charge l'audio original : on compare la tab à une transcription IA
                pour repérer les notes douteuses.
              </p>
            </div>
            {healer.score !== null && (
              <div
                className={`px-3 py-1.5 rounded font-mono text-sm ${
                  healer.score > 0.8
                    ? 'bg-green-500/20 text-green-400'
                    : healer.score > 0.5
                      ? 'bg-yellow-500/20 text-yellow-400'
                      : 'bg-red-500/20 text-red-400'
                }`}
                title="Confiance globale de la tab"
              >
                Fiabilité : {Math.round(healer.score * 100)}%
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <label className="inline-block">
              <span className="bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-3 py-1.5 rounded text-xs cursor-pointer inline-block">
                {healer.running ? '⏳ Analyse…' : '📂 Choisir un audio'}
              </span>
              <input
                type="file"
                accept="audio/*"
                disabled={healer.running}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) healer.run(f);
                  e.target.value = '';
                }}
                className="hidden"
              />
            </label>
            {healer.status && (
              <span className="text-xs text-amp-muted" aria-live="polite">
                {healer.status}
              </span>
            )}
          </div>

          {healer.flags && healer.flags.length > 0 && (
            <ul className="mt-3 max-h-40 overflow-y-auto bg-amp-bg/40 rounded border border-amp-border divide-y divide-amp-border">
              {healer.flags.slice(0, 100).map((f, i) => (
                <li
                  key={i}
                  onClick={() => healer.seek(f.timeSeconds)}
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
              {healer.flags.length > 100 && (
                <li className="px-3 py-1.5 text-xs text-amp-muted italic">
                  …{healer.flags.length - 100} autres signalements masqués
                </li>
              )}
            </ul>
          )}

          {healer.flags && healer.flags.length === 0 && (
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
        {rocksmith.active && (
          <>
            {/* Hit/miss flash over the whole viewport */}
            {rocksmith.lastHit !== null && (
              <div
                className={`pointer-events-none absolute inset-0 z-20 transition-opacity duration-300 ${
                  rocksmith.lastHit ? 'bg-green-500/20' : 'bg-red-500/25'
                }`}
              />
            )}

            {/* Stats panel, top-right */}
            <div className="absolute top-3 right-3 z-30 bg-amp-bg/90 border border-amp-border rounded-lg shadow-lg px-4 py-3 min-w-[140px] backdrop-blur">
              <div className="text-[10px] uppercase tracking-wide text-amp-muted mb-1">
                🎸 Rocksmith
              </div>
              <div className="font-mono text-3xl text-amp-accent leading-none">
                {rocksmith.stats.total > 0
                  ? Math.round((rocksmith.stats.hits / rocksmith.stats.total) * 100)
                  : 0}
                <span className="text-base text-amp-muted">%</span>
              </div>
              <div className="font-mono text-xs text-amp-muted mt-1">
                {rocksmith.stats.hits} / {rocksmith.stats.total} notes
              </div>
              {rocksmith.lastHit !== null && (
                <div
                  className={`mt-2 text-center font-bold text-sm ${
                    rocksmith.lastHit ? 'text-green-400' : 'text-red-400'
                  }`}
                >
                  {rocksmith.lastHit ? '✓ HIT' : '✗ MISS'}
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
