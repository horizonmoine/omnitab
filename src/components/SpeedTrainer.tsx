/**
 * Speed Trainer — progressive tempo practice tool.
 *
 * Like Songsterr Plus's speed trainer: starts at a slow BPM, plays a set
 * number of bars at that speed, then auto-increases by a configurable step
 * until reaching the target BPM. Uses the Web Audio metronome scheduler.
 *
 * Perfect for building speed on difficult passages.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioContext, resumeAudioContext } from '../lib/audio-engine';

const SCHEDULE_AHEAD = 0.1;
const LOOKAHEAD_MS = 25;

interface SpeedTrainerProps {
  /** If provided, the trainer starts at this detected BPM as the target. */
  initialTargetBpm?: number;
}

export function SpeedTrainer({ initialTargetBpm }: SpeedTrainerProps) {
  const [startBpm, setStartBpm] = useState(60);
  const [targetBpm, setTargetBpm] = useState(initialTargetBpm ?? 120);
  const [stepBpm, setStepBpm] = useState(5);
  const [barsPerStep, setBarsPerStep] = useState(4);
  const [beatsPerBar, setBeatsPerBar] = useState(4);

  const [running, setRunning] = useState(false);
  const [currentBpm, setCurrentBpm] = useState(60);
  const [currentBar, setCurrentBar] = useState(0);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [completed, setCompleted] = useState(false);

  // Refs for the scheduler loop.
  const timerRef = useRef<number | null>(null);
  const nextBeatTimeRef = useRef(0);
  const beatIndexRef = useRef(0);
  const barIndexRef = useRef(0);
  const bpmRef = useRef(startBpm);
  const beatsPerBarRef = useRef(beatsPerBar);
  const barsPerStepRef = useRef(barsPerStep);
  const stepBpmRef = useRef(stepBpm);
  const targetBpmRef = useRef(targetBpm);

  // Sync refs.
  useEffect(() => { beatsPerBarRef.current = beatsPerBar; }, [beatsPerBar]);
  useEffect(() => { barsPerStepRef.current = barsPerStep; }, [barsPerStep]);
  useEffect(() => { stepBpmRef.current = stepBpm; }, [stepBpm]);
  useEffect(() => { targetBpmRef.current = targetBpm; }, [targetBpm]);

  const scheduleClick = useCallback((time: number, isAccent: boolean) => {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = isAccent ? 1000 : 700;
    gain.gain.setValueAtTime(isAccent ? 0.8 : 0.4, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
  }, []);

  const scheduler = useCallback(() => {
    const ctx = getAudioContext();
    const secondsPerBeat = 60 / bpmRef.current;

    while (nextBeatTimeRef.current < ctx.currentTime + SCHEDULE_AHEAD) {
      const beat = beatIndexRef.current;
      const isAccent = beat === 0;
      scheduleClick(nextBeatTimeRef.current, isAccent);
      setCurrentBeat(beat);

      // Advance beat.
      beatIndexRef.current = (beat + 1) % beatsPerBarRef.current;

      // If we wrapped to beat 0, that's a new bar.
      if (beatIndexRef.current === 0) {
        barIndexRef.current += 1;
        setCurrentBar(barIndexRef.current);

        // Check if we've completed barsPerStep at current BPM.
        if (barIndexRef.current >= barsPerStepRef.current) {
          barIndexRef.current = 0;
          const newBpm = bpmRef.current + stepBpmRef.current;
          if (newBpm > targetBpmRef.current) {
            // Done!
            setCompleted(true);
            setRunning(false);
            if (timerRef.current != null) {
              window.clearInterval(timerRef.current);
              timerRef.current = null;
            }
            return;
          }
          bpmRef.current = newBpm;
          setCurrentBpm(newBpm);
        }
      }

      nextBeatTimeRef.current += secondsPerBeat;
    }
  }, [scheduleClick]);

  const start = useCallback(async () => {
    await resumeAudioContext();
    const ctx = getAudioContext();

    bpmRef.current = startBpm;
    setCurrentBpm(startBpm);
    beatIndexRef.current = 0;
    barIndexRef.current = 0;
    setCurrentBar(0);
    setCurrentBeat(0);
    setCompleted(false);
    nextBeatTimeRef.current = ctx.currentTime;

    timerRef.current = window.setInterval(scheduler, LOOKAHEAD_MS);
    scheduler();
    setRunning(true);
  }, [startBpm, scheduler]);

  const stop = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRunning(false);
    setCurrentBeat(-1);
  }, []);

  useEffect(() => () => stop(), [stop]);

  // Progress percentage.
  const progressPct =
    targetBpm > startBpm
      ? ((currentBpm - startBpm) / (targetBpm - startBpm)) * 100
      : 100;

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-2">Speed Trainer</h2>
      <p className="text-amp-muted text-sm mb-6">
        Augmente progressivement le tempo pour travailler la vitesse.
        Comme Songsterr Plus, mais gratuit.
      </p>

      {/* Current BPM display */}
      <div className="flex flex-col items-center bg-amp-panel border border-amp-border rounded-lg p-8 mb-6">
        <div className="text-6xl font-mono text-amp-accent mb-2">
          {currentBpm}
        </div>
        <div className="text-amp-muted text-sm mb-4">BPM actuel</div>

        {/* Beat indicator */}
        <div className="flex gap-2 mb-6">
          {Array.from({ length: beatsPerBar }, (_, i) => (
            <div
              key={i}
              className={`w-8 h-8 rounded-full border-2 flex items-center justify-center text-xs font-bold transition-all duration-75 ${
                currentBeat === i
                  ? i === 0
                    ? 'bg-amp-accent border-amp-accent text-amp-bg scale-110'
                    : 'bg-amp-success border-amp-success text-amp-bg scale-110'
                  : 'bg-amp-panel-2 border-amp-border text-amp-muted'
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div className="w-full max-w-sm mb-4">
          <div className="flex justify-between text-xs text-amp-muted mb-1">
            <span>{startBpm} BPM</span>
            <span>Mesure {currentBar + 1}/{barsPerStep}</span>
            <span>{targetBpm} BPM</span>
          </div>
          <div className="w-full bg-amp-panel-2 rounded-full h-3 overflow-hidden">
            <div
              className="bg-amp-accent h-full transition-all duration-300"
              style={{ width: `${Math.min(100, progressPct)}%` }}
            />
          </div>
        </div>

        {completed && (
          <div className="text-amp-success font-bold mb-4">
            Bravo ! Objectif de {targetBpm} BPM atteint !
          </div>
        )}

        <button
          onClick={running ? stop : start}
          className={`px-10 py-3 rounded-full text-lg font-bold transition-colors ${
            running
              ? 'bg-amp-error hover:bg-red-600 text-white'
              : 'bg-amp-accent hover:bg-amp-accent-hover text-amp-bg'
          }`}
        >
          {running ? '⏹ Stop' : '▶ Start'}
        </button>
      </div>

      {/* Settings */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 max-w-2xl">
        <div className="bg-amp-panel border border-amp-border rounded p-3">
          <label className="block text-xs text-amp-muted mb-1">BPM départ</label>
          <input
            type="number"
            min={30}
            max={300}
            value={startBpm}
            onChange={(e) => setStartBpm(Math.max(30, Number(e.target.value)))}
            disabled={running}
            className="w-full bg-amp-panel-2 border border-amp-border rounded px-2 py-1 text-amp-text font-mono text-center disabled:opacity-50"
          />
        </div>
        <div className="bg-amp-panel border border-amp-border rounded p-3">
          <label className="block text-xs text-amp-muted mb-1">BPM cible</label>
          <input
            type="number"
            min={30}
            max={300}
            value={targetBpm}
            onChange={(e) => setTargetBpm(Math.max(30, Number(e.target.value)))}
            disabled={running}
            className="w-full bg-amp-panel-2 border border-amp-border rounded px-2 py-1 text-amp-text font-mono text-center disabled:opacity-50"
          />
        </div>
        <div className="bg-amp-panel border border-amp-border rounded p-3">
          <label className="block text-xs text-amp-muted mb-1">+BPM / palier</label>
          <input
            type="number"
            min={1}
            max={50}
            value={stepBpm}
            onChange={(e) => setStepBpm(Math.max(1, Number(e.target.value)))}
            disabled={running}
            className="w-full bg-amp-panel-2 border border-amp-border rounded px-2 py-1 text-amp-text font-mono text-center disabled:opacity-50"
          />
        </div>
        <div className="bg-amp-panel border border-amp-border rounded p-3">
          <label className="block text-xs text-amp-muted mb-1">Mesures / palier</label>
          <input
            type="number"
            min={1}
            max={32}
            value={barsPerStep}
            onChange={(e) => setBarsPerStep(Math.max(1, Number(e.target.value)))}
            disabled={running}
            className="w-full bg-amp-panel-2 border border-amp-border rounded px-2 py-1 text-amp-text font-mono text-center disabled:opacity-50"
          />
        </div>
      </div>

      {/* Beats per bar */}
      <div className="mt-4 max-w-2xl">
        <label className="text-xs text-amp-muted mb-2 block">Temps par mesure</label>
        <div className="flex gap-2">
          {[2, 3, 4, 6].map((b) => (
            <button
              key={b}
              onClick={() => setBeatsPerBar(b)}
              disabled={running}
              className={`px-4 py-2 rounded font-mono text-sm transition-colors disabled:opacity-50 ${
                beatsPerBar === b
                  ? 'bg-amp-accent text-amp-bg font-bold'
                  : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
              }`}
            >
              {b}/4
            </button>
          ))}
        </div>
      </div>

      {/* Quick presets */}
      <div className="mt-6 max-w-2xl">
        <h3 className="text-sm text-amp-muted mb-2 uppercase tracking-wide">Presets</h3>
        <div className="flex gap-2 flex-wrap">
          {[
            { label: 'Débutant', start: 40, target: 80, step: 5 },
            { label: 'Intermédiaire', start: 60, target: 120, step: 5 },
            { label: 'Avancé', start: 80, target: 160, step: 5 },
            { label: 'Shred', start: 100, target: 200, step: 10 },
            { label: 'Micro-paliers', start: 60, target: 120, step: 2 },
          ].map((p) => (
            <button
              key={p.label}
              disabled={running}
              onClick={() => {
                setStartBpm(p.start);
                setTargetBpm(p.target);
                setStepBpm(p.step);
              }}
              className="bg-amp-panel-2 hover:bg-amp-border disabled:opacity-50 text-amp-text px-3 py-1.5 rounded text-sm transition-colors"
            >
              {p.label} ({p.start}→{p.target})
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
