/**
 * AlphaTab renderer wrapped in a React component.
 *
 * AlphaTab is a DOM-first library — it takes an HTMLElement and mutates it.
 * We use refs to give it a stable container and clean up on unmount.
 *
 * Fonts and soundfont are loaded from jsDelivr CDN — the service worker
 * caches them after the first visit so the viewer works offline.
 */

import { useEffect, useRef, useState } from 'react';

interface TabViewerProps {
  /** Binary data of a .gp/.gp5/.gpx file, OR a string of alphaTex / MusicXML. */
  source: ArrayBuffer | Uint8Array | string;
  onReady?: () => void;
}

const CDN = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.5.0/dist';

export function TabViewer({ source, onReady }: TabViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<unknown>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [tempo, setTempo] = useState(100);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Initialize the AlphaTab API.
  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

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

        // Create the API, attaching to our container.
        const api = new alphatab.AlphaTabApi(containerRef.current, settings);
        apiRef.current = api;

        // Wire up event listeners.
        api.scoreLoaded.on(() => {
          if (cancelled) return;
          setIsLoading(false);
          onReady?.();
        });
        api.playerStateChanged.on((args: { state: number }) => {
          // 1 = playing, 0 = paused, 2 = stopped (per AlphaTab enum)
          setIsPlaying(args.state === 1);
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
          setError('AlphaTab a échoué à s\'initialiser.');
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      const api = apiRef.current as {
        destroy?: () => void;
      } | null;
      try {
        api?.destroy?.();
      } catch {
        /* ignore */
      }
      apiRef.current = null;
    };
  }, [source, onReady]);

  const togglePlay = () => {
    const api = apiRef.current as {
      playPause?: () => void;
    } | null;
    api?.playPause?.();
  };

  const stop = () => {
    const api = apiRef.current as { stop?: () => void } | null;
    api?.stop?.();
  };

  const updateTempo = (bpm: number) => {
    setTempo(bpm);
    const api = apiRef.current as {
      playbackSpeed?: number;
    } | null;
    if (api) {
      // AlphaTab exposes playbackSpeed as a multiplier (1.0 = original).
      // We map [50..150] BPM → [0.5..1.5] relative to a 100 BPM baseline.
      api.playbackSpeed = bpm / 100;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 bg-amp-panel border-b border-amp-border px-4 py-2">
        <button
          onClick={togglePlay}
          disabled={isLoading}
          className="rounded bg-amp-accent hover:bg-amp-accent-hover disabled:bg-amp-muted disabled:cursor-not-allowed text-amp-bg font-bold px-4 py-1.5 transition-colors"
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          onClick={stop}
          disabled={isLoading}
          className="rounded bg-amp-panel-2 hover:bg-amp-border text-amp-text px-4 py-1.5 transition-colors"
        >
          ⏹ Stop
        </button>

        <div className="flex items-center gap-2 ml-auto">
          <label className="text-sm text-amp-muted">Vitesse</label>
          <input
            type="range"
            min={25}
            max={150}
            value={tempo}
            onChange={(e) => updateTempo(Number(e.target.value))}
            className="w-32 accent-amp-accent"
          />
          <span className="font-mono text-amp-text text-sm w-12 text-right">
            {tempo}%
          </span>
        </div>
      </div>

      {/* AlphaTab render area */}
      <div className="flex-1 relative overflow-auto bg-white">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-amp-bg/80 text-amp-text z-10">
            <div className="text-center">
              <div className="animate-pulse text-amp-accent text-xl mb-2">
                Chargement de la tab…
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
    </div>
  );
}
