/**
 * Metronome — precise Web Audio API click generator.
 *
 * Uses AudioContext scheduling (not setInterval) for sample-accurate timing.
 * The "look-ahead scheduler" pattern: a JS timer fires every ~25ms and
 * schedules OscillatorNodes up to 100ms ahead. This prevents gaps caused by
 * JS event-loop jank while keeping the visual indicator responsive.
 *
 * Features:
 *   - BPM control (40–300) with slider + direct input
 *   - Tap tempo (averages last 4 taps)
 *   - Time signature presets (2/4, 3/4, 4/4, 6/8)
 *   - Visual beat indicator with accent on beat 1
 *   - Keyboard shortcut: Space to start/stop
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioContext, resumeAudioContext } from '../lib/audio-engine';

type TimeSig = '2/4' | '3/4' | '4/4' | '6/8';

const TIME_SIGS: { label: TimeSig; beats: number }[] = [
  { label: '2/4', beats: 2 },
  { label: '3/4', beats: 3 },
  { label: '4/4', beats: 4 },
  { label: '6/8', beats: 6 },
];

/** Schedule window: how far ahead (seconds) we schedule audio nodes. */
const SCHEDULE_AHEAD = 0.1;
/** How often the JS timer fires to queue new beats. */
const LOOKAHEAD_MS = 25;

export function Metronome() {
  const [bpm, setBpm] = useState(120);
  const [timeSig, setTimeSig] = useState<TimeSig>('4/4');
  const [playing, setPlaying] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(-1);

  // Refs to survive across scheduler ticks without re-renders.
  const bpmRef = useRef(bpm);
  const timeSigRef = useRef(timeSig);
  const timerRef = useRef<number | null>(null);
  const nextBeatTimeRef = useRef(0);
  const beatIndexRef = useRef(0);

  // Tap tempo state
  const tapTimesRef = useRef<number[]>([]);

  // Keep refs in sync with state.
  useEffect(() => {
    bpmRef.current = bpm;
  }, [bpm]);
  useEffect(() => {
    timeSigRef.current = timeSig;
  }, [timeSig]);

  const beatsForSig = (sig: TimeSig) =>
    TIME_SIGS.find((t) => t.label === sig)!.beats;

  /** Play a short click at the exact scheduled time. */
  const scheduleClick = useCallback((time: number, isAccent: boolean) => {
    const ctx = getAudioContext();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // Accent (beat 1): higher pitch + louder.
    osc.frequency.value = isAccent ? 1000 : 700;
    gain.gain.setValueAtTime(isAccent ? 0.8 : 0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(time);
    osc.stop(time + 0.06);
  }, []);

  /** The look-ahead scheduler — called every LOOKAHEAD_MS. */
  const scheduler = useCallback(() => {
    const ctx = getAudioContext();
    const beats = beatsForSig(timeSigRef.current);
    const secondsPerBeat = 60 / bpmRef.current;

    while (nextBeatTimeRef.current < ctx.currentTime + SCHEDULE_AHEAD) {
      const beatIndex = beatIndexRef.current;
      const isAccent = beatIndex === 0;

      scheduleClick(nextBeatTimeRef.current, isAccent);

      // Update the visual indicator (fire-and-forget — visual can lag a few ms).
      setCurrentBeat(beatIndex);

      // Advance to next beat.
      nextBeatTimeRef.current += secondsPerBeat;
      beatIndexRef.current = (beatIndex + 1) % beats;
    }
  }, [scheduleClick]);

  const startMetronome = useCallback(async () => {
    await resumeAudioContext();
    const ctx = getAudioContext();

    beatIndexRef.current = 0;
    nextBeatTimeRef.current = ctx.currentTime;
    setCurrentBeat(0);

    // Start the JS timer that feeds the scheduler.
    timerRef.current = window.setInterval(scheduler, LOOKAHEAD_MS);
    scheduler(); // Kick off immediately.
    setPlaying(true);
  }, [scheduler]);

  const stopMetronome = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPlaying(false);
    setCurrentBeat(-1);
  }, []);

  const toggle = useCallback(() => {
    if (playing) stopMetronome();
    else startMetronome();
  }, [playing, startMetronome, stopMetronome]);

  // Cleanup on unmount.
  useEffect(() => () => stopMetronome(), [stopMetronome]);

  // Space bar shortcut.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.code === 'Space' &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(
          (e.target as HTMLElement).tagName,
        )
      ) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  // ── Tap tempo ──────────────────────────────────────────────────────
  const handleTap = () => {
    const now = performance.now();
    const taps = tapTimesRef.current;
    // Discard taps older than 2s (user paused).
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) {
      tapTimesRef.current = [];
    }
    taps.push(now);
    // Keep last 5 taps → 4 intervals.
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < taps.length; i++) {
        intervals.push(taps[i] - taps[i - 1]);
      }
      const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const newBpm = Math.round(60000 / avgMs);
      setBpm(Math.max(40, Math.min(300, newBpm)));
    }
  };

  const beats = beatsForSig(timeSig);

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-2">Metronome</h2>
      <p className="text-amp-muted text-sm mb-6">
        Tempo précis via Web Audio. Espace pour start/stop.
      </p>

      {/* Beat indicator */}
      <div className="flex justify-center gap-3 mb-8">
        {Array.from({ length: beats }, (_, i) => (
          <div
            key={i}
            className={`w-10 h-10 rounded-full border-2 transition-all duration-75 flex items-center justify-center font-bold text-sm ${
              currentBeat === i
                ? i === 0
                  ? 'bg-amp-accent border-amp-accent text-amp-bg scale-110'
                  : 'bg-amp-success border-amp-success text-amp-bg scale-110'
                : 'bg-amp-panel border-amp-border text-amp-muted'
            }`}
          >
            {i + 1}
          </div>
        ))}
      </div>

      {/* BPM display + controls */}
      <div className="flex flex-col items-center bg-amp-panel border border-amp-border rounded-lg p-8 mb-6">
        <div className="flex items-baseline gap-2 mb-6">
          <input
            type="number"
            min={40}
            max={300}
            value={bpm}
            onChange={(e) =>
              setBpm(Math.max(40, Math.min(300, Number(e.target.value) || 120)))
            }
            className="w-24 text-center text-5xl font-mono bg-transparent text-amp-text border-b-2 border-amp-border focus:border-amp-accent outline-none"
          />
          <span className="text-amp-muted text-lg">BPM</span>
        </div>

        <input
          type="range"
          min={40}
          max={300}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          className="w-full max-w-sm mb-6 accent-amp-accent"
        />

        {/* Play / Stop */}
        <button
          onClick={toggle}
          className={`px-10 py-3 rounded-full text-lg font-bold transition-colors ${
            playing
              ? 'bg-amp-error hover:bg-red-600 text-white'
              : 'bg-amp-accent hover:bg-amp-accent-hover text-amp-bg'
          }`}
        >
          {playing ? '⏹ Stop' : '▶ Start'}
        </button>
      </div>

      {/* Time signature + Tap tempo */}
      <div className="grid grid-cols-2 gap-4">
        {/* Time signature */}
        <div className="bg-amp-panel border border-amp-border rounded-lg p-4">
          <h3 className="text-sm font-bold text-amp-muted mb-3 uppercase tracking-wide">
            Signature
          </h3>
          <div className="flex gap-2 flex-wrap">
            {TIME_SIGS.map((ts) => (
              <button
                key={ts.label}
                onClick={() => {
                  setTimeSig(ts.label);
                  // Reset beat index so we don't go out of bounds.
                  beatIndexRef.current = 0;
                }}
                className={`px-4 py-2 rounded font-mono text-sm transition-colors ${
                  timeSig === ts.label
                    ? 'bg-amp-accent text-amp-bg font-bold'
                    : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
                }`}
              >
                {ts.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tap tempo */}
        <div className="bg-amp-panel border border-amp-border rounded-lg p-4">
          <h3 className="text-sm font-bold text-amp-muted mb-3 uppercase tracking-wide">
            Tap Tempo
          </h3>
          <button
            onClick={handleTap}
            className="w-full bg-amp-panel-2 hover:bg-amp-border text-amp-text font-bold py-4 rounded text-lg transition-colors active:bg-amp-accent active:text-amp-bg"
          >
            TAP
          </button>
        </div>
      </div>

      {/* Presets */}
      <div className="mt-6 bg-amp-panel border border-amp-border rounded-lg p-4">
        <h3 className="text-sm font-bold text-amp-muted mb-3 uppercase tracking-wide">
          Presets
        </h3>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'Lent', bpm: 60 },
            { label: 'Modéré', bpm: 100 },
            { label: 'Allegro', bpm: 132 },
            { label: 'Rapide', bpm: 160 },
            { label: 'Presto', bpm: 200 },
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => setBpm(p.bpm)}
              className="bg-amp-panel-2 hover:bg-amp-border text-amp-text px-3 py-1.5 rounded text-sm transition-colors"
            >
              {p.label} ({p.bpm})
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
