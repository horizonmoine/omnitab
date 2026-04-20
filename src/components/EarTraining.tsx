/**
 * Ear Training — interval identification game.
 *
 * Plays two notes and asks the user to identify the interval.
 * Tracks streaks and per-interval accuracy stats.
 * Uses Web Audio OscillatorNode for pure tone generation.
 */

import { useCallback, useRef, useState } from 'react';
import { getAudioContext, resumeAudioContext } from '../lib/audio-engine';
import {
  Button,
  Card,
  PageHeader,
  Readout,
  SectionLabel,
} from './primitives';

const INTERVALS = [
  { semitones: 0, name: 'Unisson', short: 'P1' },
  { semitones: 1, name: 'Seconde mineure', short: 'm2' },
  { semitones: 2, name: 'Seconde majeure', short: 'M2' },
  { semitones: 3, name: 'Tierce mineure', short: 'm3' },
  { semitones: 4, name: 'Tierce majeure', short: 'M3' },
  { semitones: 5, name: 'Quarte juste', short: 'P4' },
  { semitones: 6, name: 'Triton', short: 'TT' },
  { semitones: 7, name: 'Quinte juste', short: 'P5' },
  { semitones: 8, name: 'Sixte mineure', short: 'm6' },
  { semitones: 9, name: 'Sixte majeure', short: 'M6' },
  { semitones: 10, name: 'Septième mineure', short: 'm7' },
  { semitones: 11, name: 'Septième majeure', short: 'M7' },
  { semitones: 12, name: 'Octave', short: 'P8' },
];

// Active intervals (user can toggle).
const DEFAULT_ACTIVE = new Set([0, 3, 4, 5, 7, 12]); // P1, m3, M3, P4, P5, P8

type IntervalStats = Record<number, { correct: number; total: number }>;

/** Convert MIDI to frequency (A4 = 440Hz). */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function EarTraining() {
  const [activeIntervals, setActiveIntervals] = useState<Set<number>>(
    () => new Set(DEFAULT_ACTIVE),
  );
  const [currentInterval, setCurrentInterval] = useState<number | null>(null);
  const [baseMidi, setBaseMidi] = useState(60); // C4
  const [answer, setAnswer] = useState<number | null>(null);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [stats, setStats] = useState<IntervalStats>({});
  const [mode, setMode] = useState<'ascending' | 'descending' | 'harmonic'>('ascending');
  const [autoPlay, setAutoPlay] = useState(true);

  const timeoutRef = useRef<number | null>(null);

  const toggleInterval = (semitones: number) => {
    setActiveIntervals((prev) => {
      const next = new Set(prev);
      if (next.has(semitones)) {
        if (next.size <= 2) return next; // Keep at least 2.
        next.delete(semitones);
      } else {
        next.add(semitones);
      }
      return next;
    });
  };

  /** Play a single note using OscillatorNode. */
  const playNote = useCallback(async (midi: number, startTime: number, duration: number) => {
    const ctx = getAudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = midiToFreq(midi);

    gain.gain.setValueAtTime(0, startTime);
    gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
    gain.gain.setValueAtTime(0.3, startTime + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }, []);

  /** Play the interval. */
  const playInterval = useCallback(async (semitones: number, base: number) => {
    await resumeAudioContext();
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const noteDuration = 0.6;

    const midi2 = mode === 'descending' ? base - semitones : base + semitones;

    if (mode === 'harmonic') {
      // Both notes at the same time.
      playNote(base, now, noteDuration * 1.5);
      playNote(midi2, now, noteDuration * 1.5);
    } else {
      // Sequential.
      playNote(base, now, noteDuration);
      playNote(midi2, now + noteDuration + 0.1, noteDuration);
    }
  }, [mode, playNote]);

  /** Generate a new question. */
  const newQuestion = useCallback(() => {
    const active = Array.from(activeIntervals);
    const interval = active[Math.floor(Math.random() * active.length)];
    // Random base note between C3 and C5.
    const base = 48 + Math.floor(Math.random() * 24);

    setCurrentInterval(interval);
    setBaseMidi(base);
    setAnswer(null);
    setIsCorrect(null);

    if (autoPlay) {
      // Small delay so state updates before playing.
      setTimeout(() => playInterval(interval, base), 100);
    }
  }, [activeIntervals, autoPlay, playInterval]);

  /** Handle answer selection. */
  const handleAnswer = (semitones: number) => {
    if (currentInterval === null) return;

    const correct = semitones === currentInterval;
    setAnswer(semitones);
    setIsCorrect(correct);

    // Update stats.
    setStats((prev) => {
      const s = prev[currentInterval] ?? { correct: 0, total: 0 };
      return {
        ...prev,
        [currentInterval]: {
          correct: s.correct + (correct ? 1 : 0),
          total: s.total + 1,
        },
      };
    });

    if (correct) {
      setStreak((s) => {
        const next = s + 1;
        setBestStreak((b) => Math.max(b, next));
        return next;
      });
    } else {
      setStreak(0);
    }

    // Auto-advance after 1.5s.
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(newQuestion, 1500);
  };

  /** Replay the current interval. */
  const replay = () => {
    if (currentInterval !== null) {
      playInterval(currentInterval, baseMidi);
    }
  };

  const totalAnswered = Object.values(stats).reduce((a, s) => a + s.total, 0);
  const totalCorrect = Object.values(stats).reduce((a, s) => a + s.correct, 0);
  const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="Ear Training"
        subtitle="Identifie l'intervalle entre 2 notes. Entraîne ton oreille musicale."
      />

      {/* Stats bar — 4 StatCards, each with its own semantic colour:
          streak (amber current), record (neutral), accuracy (success),
          total (neutral). */}
      <div className="flex gap-4 mb-6 text-sm">
        <StatCard value={`${streak}`} label="Série" valueClass="text-amp-accent" />
        <StatCard value={`${bestStreak}`} label="Record" />
        <StatCard value={`${accuracy}%`} label="Précision" valueClass="text-amp-success" />
        <StatCard value={`${totalAnswered}`} label="Réponses" />
      </div>

      {/* Play area */}
      <Card padding="p-6" className="mb-6 text-center">
        {currentInterval === null ? (
          <Button variant="pill" onClick={newQuestion} className="px-8 py-4">
            <span aria-hidden="true">▶ </span>Commencer
          </Button>
        ) : (
          <>
            {/* Feedback */}
            {isCorrect !== null && (
              <div
                className={`text-xl font-bold mb-4 ${isCorrect ? 'text-amp-success' : 'text-amp-error'}`}
                role="status"
                aria-live="polite"
              >
                {isCorrect
                  ? '✓ Correct !'
                  : `✗ C'était : ${INTERVALS.find((i) => i.semitones === currentInterval)?.name}`}
              </div>
            )}

            {isCorrect === null && (
              <div className="text-amp-muted text-lg mb-4">
                Quel est cet intervalle ?
              </div>
            )}

            <Button variant="secondary" onClick={replay} className="mb-6">
              <span aria-hidden="true">🔊 </span>Réécouter
            </Button>

            {/* Answer buttons — 4 conditional colour states (correct/wrong/
                reveal-answer/default) don't map to Button variants; kept raw. */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-w-2xl mx-auto">
              {INTERVALS.filter((i) => activeIntervals.has(i.semitones)).map((interval) => {
                const isSelected = answer === interval.semitones;
                const wasCorrectAnswer = currentInterval === interval.semitones && answer !== null;
                return (
                  <button
                    key={interval.semitones}
                    onClick={() => handleAnswer(interval.semitones)}
                    disabled={answer !== null}
                    className={`p-3 rounded text-sm font-bold transition-colors disabled:cursor-not-allowed ${
                      isSelected && isCorrect
                        ? 'bg-amp-success text-white'
                        : isSelected && !isCorrect
                          ? 'bg-amp-error text-white'
                          : wasCorrectAnswer
                            ? 'bg-amp-success/30 text-amp-success border border-amp-success'
                            : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border disabled:opacity-50'
                    }`}
                  >
                    <div className="text-lg">{interval.short}</div>
                    <div className="text-[10px] opacity-70">{interval.name}</div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
        {/* Mode selector */}
        <Card padding="p-4">
          <SectionLabel className="mb-2">Mode</SectionLabel>
          <div className="flex gap-2">
            {[
              { id: 'ascending' as const, label: 'Ascendant ↑' },
              { id: 'descending' as const, label: 'Descendant ↓' },
              { id: 'harmonic' as const, label: 'Harmonique =' },
            ].map((m) => (
              <Button
                key={m.id}
                variant={mode === m.id ? 'chipOn' : 'chip'}
                onClick={() => setMode(m.id)}
                aria-pressed={mode === m.id}
                className="text-xs"
              >
                {m.label}
              </Button>
            ))}
          </div>
          <label className="flex items-center gap-2 mt-3 text-xs text-amp-muted cursor-pointer">
            <input
              type="checkbox"
              checked={autoPlay}
              onChange={(e) => setAutoPlay(e.target.checked)}
              className="accent-amp-accent"
            />
            Jouer automatiquement
          </label>
        </Card>

        {/* Interval selector — dense grid of 13 intervals, kept tighter
            than chip variant to avoid wrapping on narrow screens. */}
        <Card padding="p-4">
          <SectionLabel className="mb-2">Intervalles actifs</SectionLabel>
          <div className="flex gap-1 flex-wrap">
            {INTERVALS.map((i) => (
              <button
                key={i.semitones}
                onClick={() => toggleInterval(i.semitones)}
                aria-pressed={activeIntervals.has(i.semitones)}
                className={`px-2 py-1 rounded text-xs transition-colors ${
                  activeIntervals.has(i.semitones)
                    ? 'bg-amp-accent text-amp-bg font-bold'
                    : 'bg-amp-panel-2 text-amp-muted'
                }`}
              >
                {i.short}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => setActiveIntervals(new Set(INTERVALS.map((i) => i.semitones)))}
              className="text-xs text-amp-muted hover:text-amp-accent"
            >
              Tout
            </button>
            <button
              onClick={() => setActiveIntervals(new Set(DEFAULT_ACTIVE))}
              className="text-xs text-amp-muted hover:text-amp-accent"
            >
              Basique
            </button>
          </div>
        </Card>
      </div>

      {/* Per-interval stats */}
      {totalAnswered > 0 && (
        <div className="mt-6 max-w-2xl">
          <SectionLabel className="mb-2">Stats par intervalle</SectionLabel>
          <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 gap-2">
            {INTERVALS.filter((i) => stats[i.semitones]?.total > 0).map((i) => {
              const s = stats[i.semitones]!;
              const pct = Math.round((s.correct / s.total) * 100);
              const colour =
                pct >= 80 ? 'text-amp-success' : pct >= 50 ? 'text-amp-accent' : 'text-amp-error';
              return (
                <Card key={i.semitones} padding="p-2" className="text-center">
                  <div className="font-bold text-xs">{i.short}</div>
                  <Readout size="base" className={`${colour} block text-lg`}>
                    {pct}%
                  </Readout>
                  <div className="text-[10px] text-amp-muted">{s.correct}/{s.total}</div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact stat card for the top-of-page stats bar. */
function StatCard({
  value,
  label,
  valueClass = 'text-amp-text',
}: {
  value: string;
  label: string;
  valueClass?: string;
}) {
  return (
    <Card padding="px-4 py-2" className="text-center">
      <Readout size="lg" className={`${valueClass} block`}>
        {value}
      </Readout>
      <div className="text-xs text-amp-muted">{label}</div>
    </Card>
  );
}
