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
        });

        api.playedBeatChanged.on((beat: { voice?: { bar?: { index?: number } } }) => {
          try {
            const barIndex = beat?.voice?.bar?.index;
            if (barIndex != null) setCurrentBar(barIndex + 1);
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
  }, []);

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
