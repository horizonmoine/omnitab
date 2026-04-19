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
import { Button, Card, PageHeader, Readout, SectionLabel } from './primitives';

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

  // ± adjust helpers — kept out of JSX to avoid recreating closures per render.
  const bumpBpm = (delta: number) =>
    setBpm(Math.max(40, Math.min(300, bpm + delta)));

  return (
    // Centered column layout mirrors the Claude Design mockup.
    <div className="h-full overflow-y-auto p-6 flex flex-col items-center">
      <PageHeader
        title="Métronome"
        subtitle="Tempo précis via Web Audio. Espace pour start/stop."
      />

      <Card
        padding="p-6"
        className="w-full max-w-md flex flex-col items-center"
        role="group"
        aria-label="Réglages du métronome"
      >
        {/* Big amber BPM display — tabular-nums from Readout prevents jitter. */}
        <Readout
          size="hero"
          className="text-amp-accent"
          aria-live="polite"
          aria-label={`${bpm} battements par minute`}
        >
          {bpm}
        </Readout>
        <div className="text-sm text-amp-muted mt-1">BPM</div>

        {/* Beat pips — red for beat 1 (accent), amber otherwise. */}
        <div
          className="flex gap-2 mt-4"
          role="group"
          aria-label="Indicateur de battement"
        >
          {Array.from({ length: beats }, (_, i) => (
            <div
              key={i}
              aria-hidden="true"
              className="w-5 h-5 rounded-full transition-all duration-75"
              style={{
                background:
                  playing && currentBeat === i
                    ? i === 0
                      ? '#ef4444' // accent (beat 1) = red
                      : '#f59e0b' // other beats = amber
                    : '#2a2a2a',
                transform:
                  playing && currentBeat === i ? 'scale(1.4)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        {/* Tempo slider */}
        <input
          type="range"
          min={40}
          max={300}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
          className="w-full mt-6 accent-amp-accent"
          aria-label="Tempo (curseur)"
        />

        {/* Fine-tune chips — replaces the old number input. */}
        <div className="flex gap-2 mt-4 items-center">
          <Button variant="chip" onClick={() => bumpBpm(-5)} aria-label="−5 BPM">
            −5
          </Button>
          <Button variant="chip" onClick={() => bumpBpm(-1)} aria-label="−1 BPM">
            −1
          </Button>
          <Button variant="chip" onClick={() => bumpBpm(1)} aria-label="+1 BPM">
            +1
          </Button>
          <Button variant="chip" onClick={() => bumpBpm(5)} aria-label="+5 BPM">
            +5
          </Button>
        </div>

        {/* Inline time signature chips */}
        <div className="flex items-center gap-2 mt-4 flex-wrap justify-center">
          <span className="text-sm text-amp-muted">Signature :</span>
          {TIME_SIGS.map((ts) => (
            <Button
              key={ts.label}
              variant={timeSig === ts.label ? 'chipOn' : 'chip'}
              onClick={() => {
                setTimeSig(ts.label);
                // Reset beat index so we don't go out of bounds.
                beatIndexRef.current = 0;
              }}
              className="font-mono"
              aria-pressed={timeSig === ts.label}
            >
              {ts.label}
            </Button>
          ))}
        </div>
      </Card>

      {/* Start/Stop + Tap Tempo — pulled OUT of the card per the mockup. */}
      <div className="mt-6 flex gap-3">
        {playing ? (
          <Button
            variant="pillStop"
            onClick={toggle}
            aria-label="Arrêter le métronome"
          >
            <span aria-hidden="true">⏹ </span>Stop
          </Button>
        ) : (
          <Button
            variant="pill"
            onClick={toggle}
            aria-label="Démarrer le métronome"
          >
            <span aria-hidden="true">▶ </span>Démarrer
          </Button>
        )}
        <Button variant="secondary" onClick={handleTap} aria-label="Tap tempo">
          <span aria-hidden="true">🥁 </span>Tap tempo
        </Button>
      </div>

      {/* Classical tempo presets — compact chip row, preserved from v1. */}
      <div className="mt-6 w-full max-w-md">
        <SectionLabel className="text-center">Presets</SectionLabel>
        <div className="flex gap-2 flex-wrap justify-center">
          {[
            { label: 'Lent', bpm: 60 },
            { label: 'Modéré', bpm: 100 },
            { label: 'Allegro', bpm: 132 },
            { label: 'Rapide', bpm: 160 },
            { label: 'Presto', bpm: 200 },
          ].map((p) => (
            <Button
              key={p.label}
              variant="secondary"
              onClick={() => setBpm(p.bpm)}
            >
              {p.label} ({p.bpm})
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
