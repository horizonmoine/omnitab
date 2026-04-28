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
import type { AlphaTabApi } from '../lib/alphatab-types';
import { useRocksmith } from '../hooks/useRocksmith';
import { useTakeRecorder } from '../hooks/useTakeRecorder';
import { useTabHealer } from '../hooks/useTabHealer';
import { useStemSync } from '../hooks/useStemSync';
import { HealerOverlay } from './HealerOverlay';
import { Button, ErrorStrip } from './primitives';

/**
 * Fix alphaTex strings saved with old buggy formats. Runs on every string
 * source so IndexedDB tabs open cleanly without re-transcribing.
 *
 * Fixes applied:
 *   1. \tuning E4 B3 …  → \tuning (E4 B3 …)  (parens REQUIRED by AlphaTab ≥1.5)
 *      \tuning(E4 B3 …) → \tuning (E4 B3 …)  (normalise spacing)
 *   2. \tempo 120.5     → \tempo 120          (must be integer)
 *   3. NaN.N / undefined.N beats → r          (upstream Viterbi could emit NaN frets)
 *   4. Chords containing NaN notes → clean    (drop bad notes from chord; unwrap if 1 remains)
 */
function sanitizeAlphaTex(src: string): string {
  // eslint-disable-next-line no-console
  console.log('[alphatex-sanitize] input:\n', src);

  let out = src;

  // AlphaTab 1.5.0 does not support \track. Remove it if present.
  out = out.replace(/\\track[^\n\r]*/g, '');

  // AlphaTab 1.5.0 requires no parentheses around tuning strings.
  // We used to add them for 1.8.2, but we reverted to 1.5.0.
  out = out.replace(/\\tuning\s*\(([^)]+)\)/g, '\\tuning $1');

  // 2. Tempo must be integer.
  out = out.replace(/\\tempo\s+(\d+)\.\d+/g, '\\tempo $1');

  // 3. Replace bare bad-fret notes (NaN.3, undefined.3, Infinity.3 …) with rest.
  out = out.replace(/\b(?:NaN|undefined|Infinity|-Infinity)\.\d+\b/g, 'r');

  // 4. Clean chords: remove bad notes from inside (…).
  //    We only process parenthesised groups that appear AFTER the metadata header
  //    (i.e. after a line starting with a beat `:` or note digit). To avoid
  //    corrupting \tuning (...) we skip parens on lines that start with `\`.
  out = out.replace(/\(([^)]+)\)/g, (match, inner: string, offset: number) => {
    // Check if this paren group is part of a metadata directive (e.g. \tuning).
    // Look backwards from the match to find if `\tuning` (or another \ command)
    // immediately precedes it.
    const before = out.slice(Math.max(0, offset - 20), offset).trimEnd();
    if (/\\[a-zA-Z]+$/.test(before)) {
      // This is a metadata argument — leave it intact.
      return match;
    }

    const parts = inner
      .trim()
      .split(/\s+/)
      .filter((p) => !/^(?:NaN|undefined|Infinity|-Infinity)\./.test(p));
    if (parts.length === 0) return 'r';
    if (parts.length === 1) return parts[0];
    return `(${parts.join(' ')})`;
  });

  // eslint-disable-next-line no-console
  console.log('[alphatex-sanitize] output:\n', out);
  return out;
}

/**
 * Active setlist context — present when the viewer is showing a tab that's
 * part of a playlist. Drives the Prev/Next bar at the top of the viewer.
 * Owned by App.tsx; we just receive it and render the affordance.
 */
export interface SetlistViewerContext {
  setlistId: number;
  position: number;
  total: number;
  setlistName: string;
}

interface TabViewerProps {
  /** Binary data of a .gp/.gp5/.gpx file, OR a string of alphaTex / MusicXML. */
  source: ArrayBuffer | Uint8Array | string;
  onReady?: () => void;
  /** When set, the viewer renders a setlist navigation bar at the top. */
  setlistContext?: SetlistViewerContext;
  onSetlistPrev?: () => void;
  onSetlistNext?: () => void;
  onSetlistExit?: () => void;
}

const CDN = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.5.0/dist';

interface TrackInfo {
  index: number;
  name: string;
  instrument: string;
}

export function TabViewer({
  source,
  onReady,
  setlistContext,
  onSetlistPrev,
  onSetlistNext,
  onSetlistExit,
}: TabViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AlphaTabApi | null>(null);
  // Hidden file input the Healer "Choisir un audio" Button delegates to —
  // same pattern as Library's import button.
  const healerFileRef = useRef<HTMLInputElement>(null);
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
          api.tex(sanitizeAlphaTex(source));
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
    if (!api?.settings?.display) return;
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
      {/* Setlist navigation bar — only shown when the viewer is invoked
          from a setlist. Sits above the regular toolbar so it reads as
          higher-level context ("which song in which playlist") before the
          per-song controls. */}
      {setlistContext && (
        <div className="bg-amp-accent/10 border-b border-amp-accent px-3 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-amp-accent text-sm" aria-hidden="true">📋</span>
          <span className="text-sm text-amp-text font-semibold truncate max-w-[20rem]">
            {setlistContext.setlistName}
          </span>
          <span className="text-xs text-amp-muted tabular-nums whitespace-nowrap">
            {setlistContext.position + 1} / {setlistContext.total}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={onSetlistPrev}
              disabled={setlistContext.position === 0}
              className="px-3 py-1 text-sm"
              aria-label="Tab précédente de la setlist"
              title="Tab précédente"
            >
              ← Précédent
            </Button>
            <Button
              variant="secondary"
              onClick={onSetlistNext}
              disabled={setlistContext.position >= setlistContext.total - 1}
              className="px-3 py-1 text-sm"
              aria-label="Tab suivante de la setlist"
              title="Tab suivante"
            >
              Suivant →
            </Button>
            <Button
              variant="secondary"
              onClick={onSetlistExit}
              className="px-2 py-1 text-sm"
              aria-label="Sortir du mode setlist"
              title="Sortir du mode setlist"
            >
              ✕
            </Button>
          </div>
        </div>
      )}

      {/*
        Top toolbar — a DAW-style control surface. Most buttons here use
        `px-2 py-1.5 text-xs font-bold` which is tighter than any Button
        variant (chip = px-3 py-1 text-sm), so toggles stay raw. We still
        wire `aria-pressed`/`aria-label` everywhere so screen readers get
        the toggle semantics even when the visual shell is bespoke.
      */}
      <div className="bg-amp-panel border-b border-amp-border px-3 py-2">
        {/* Row 1: Play controls + speed */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="primary"
            onClick={togglePlay}
            disabled={isLoading}
            aria-label={isPlaying ? 'Pause' : 'Lecture'}
            className="px-4 py-1.5"
          >
            {isPlaying ? '⏸' : '▶'}
          </Button>
          <Button
            variant="secondary"
            onClick={stop}
            disabled={isLoading}
            aria-label="Arrêter"
            className="px-3 py-1.5"
          >
            ⏹
          </Button>

          {/* Count-in toggle */}
          <button
            onClick={() => setCountIn((c) => !c)}
            aria-pressed={countIn}
            aria-label="Décompte avant lecture"
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
            aria-pressed={looping}
            aria-label="Lecture en boucle"
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
            aria-pressed={take.taking}
            aria-label={
              take.taking ? 'Arrêter et sauvegarder la prise' : 'Enregistrer une prise'
            }
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
            aria-pressed={stems.open || !!stems.active}
            aria-label="Stems synchronisés"
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
            aria-pressed={healer.open}
            aria-label="Tab Healer"
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
            aria-pressed={rocksmith.active}
            aria-label="Mode Rocksmith"
            className={`px-2 py-1.5 rounded text-xs font-bold transition-colors ${
              rocksmith.active
                ? 'bg-amp-success text-white animate-pulse'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
            title="Mode Rocksmith — feedback temps réel via iRig"
          >
            🎸
          </button>

          {/* Bar counter — tabular-nums so 9/100 → 10/100 doesn't shift the row */}
          {totalBars > 0 && (
            <span
              className="text-xs text-amp-muted font-mono tabular-nums ml-1"
              aria-label={`Mesure ${currentBar} sur ${totalBars}`}
            >
              {currentBar}/{totalBars}
            </span>
          )}

          {/* Speed control */}
          <div className="flex items-center gap-1 ml-auto">
            <button
              onClick={() => updateSpeed(Math.max(25, speed - 5))}
              aria-label="Diminuer la vitesse"
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
              aria-label="Vitesse de lecture"
              className="w-24 accent-amp-accent"
            />
            <button
              onClick={() => updateSpeed(Math.min(200, speed + 5))}
              aria-label="Augmenter la vitesse"
              className="text-amp-muted hover:text-amp-text text-xs px-1"
            >
              +
            </button>
            <span className="font-mono tabular-nums text-amp-text text-xs w-10 text-right">
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
              aria-label="Copier le lien de partage"
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
              aria-label="Dézoomer"
              className="text-amp-muted hover:text-amp-text text-xs px-1"
            >
              🔍−
            </button>
            <span className="text-xs text-amp-muted font-mono tabular-nums w-8 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
              aria-label="Zoomer"
              className="text-amp-muted hover:text-amp-text text-xs px-1"
            >
              🔍+
            </button>
          </div>
        </div>

        {/* Row 2: Track selector (only if multiple tracks). chip/chipOn use
            text-sm so we override to text-xs to keep the toolbar dense. */}
        {tracks.length > 1 && (
          <div
            className="flex gap-1 mt-2 overflow-x-auto pb-1"
            role="tablist"
            aria-label="Pistes"
          >
            {tracks.map((t) => (
              <Button
                key={t.index}
                variant={activeTrack === t.index ? 'chipOn' : 'chip'}
                onClick={() => switchTrack(t.index)}
                role="tab"
                aria-selected={activeTrack === t.index}
                className="text-xs whitespace-nowrap"
              >
                {t.name}
              </Button>
            ))}
          </div>
        )}

        {/* Speed presets — even tighter than chip (px-2 py-0.5). Stay raw. */}
        <div className="flex gap-1 mt-1" role="group" aria-label="Vitesses prédéfinies">
          {[25, 50, 75, 100, 125, 150].map((s) => (
            <button
              key={s}
              onClick={() => updateSpeed(s)}
              aria-pressed={speed === s}
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
              {/* Song picker — same chip/chipOn vocabulary as Library filters. */}
              <div
                className="flex flex-wrap gap-1 mb-3"
                role="radiogroup"
                aria-label="Chanson à charger"
              >
                {Array.from(stems.songs.keys()).map((title) => (
                  <Button
                    key={title}
                    variant={stems.active === title ? 'chipOn' : 'chip'}
                    onClick={() => stems.load(title)}
                    role="radio"
                    aria-checked={stems.active === title}
                    className="text-xs"
                  >
                    {title} ({stems.songs.get(title)?.length})
                  </Button>
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
            {/* Button triggers the hidden file input — Library uses the same
                pattern. We override Button's px-6 py-2 down to px-3 py-1.5
                text-xs to fit the dense Healer panel. */}
            <Button
              variant="primary"
              disabled={healer.running}
              onClick={() => healerFileRef.current?.click()}
              aria-label="Choisir un fichier audio à analyser"
              className="px-3 py-1.5 text-xs"
            >
              {healer.running ? '⏳ Analyse…' : '📂 Choisir un audio'}
            </Button>
            <input
              ref={healerFileRef}
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
          <div className="absolute inset-0 flex items-center justify-center bg-amp-bg p-4 z-10">
            <ErrorStrip role="alert" className="max-w-md text-center">
              {error}
            </ErrorStrip>
          </div>
        )}
        {/*
          Scroll-linked wrapper. AlphaTab's `boundsLookup` coordinates live in
          this relative coord space, so the Healer overlay must share it and
          sit OUTSIDE the viewport's relative parent (otherwise dots stop
          scrolling with the score).
        */}
        <div className="relative min-h-full">
          <div ref={containerRef} className="min-h-full" />
          {healer.flags && healer.flags.length > 0 && (
            <HealerOverlay
              flags={healer.flags}
              getApi={getApi}
              onSeek={healer.seek}
            />
          )}
        </div>

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
