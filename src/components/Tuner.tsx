/**
 * Real-time chromatic tuner.
 *
 * Reads from the default audio input (line-in / iRig USB) via Web Audio API,
 * runs pitchy's pitch detector at ~60 Hz, and shows the nearest note + cents
 * deviation on a dial-style indicator.
 */

import { useEffect, useRef, useState } from 'react';
import { createTunerDetector } from '../lib/pitch-detection';
import { getAudioContext, resumeAudioContext } from '../lib/audio-engine';
import { getSettings } from '../lib/settings';
import type { TunerReading } from '../lib/types';
import { Button, ErrorStrip, PageHeader, Readout } from './primitives';

export function Tuner() {
  const [active, setActive] = useState(false);
  const [reading, setReading] = useState<TunerReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const detectorRef = useRef<ReturnType<typeof createTunerDetector> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      detectorRef.current?.stop();
      detectorRef.current = null;
    };
  }, []);

  const start = async () => {
    setError(null);
    try {
      await resumeAudioContext();
      // Read A4 from persistent settings so the tuner respects 432/440/442 Hz.
      const { a4Hz } = getSettings();
      const detector = createTunerDetector(getAudioContext(), a4Hz);
      detector.onReading((r) => setReading(r));
      await detector.start();
      detectorRef.current = detector;
      setActive(true);
    } catch (err) {
      console.error(err);
      setError(
        'Impossible d\'accéder au micro. Vérifie que tu as accordé la permission, et que l\'iRig est bien branché.',
      );
    }
  };

  const stop = () => {
    detectorRef.current?.stop();
    detectorRef.current = null;
    setActive(false);
    setReading(null);
  };

  // Indicator: in-tune if |cents| < 5; sharp if > 0; flat if < 0.
  const cents = reading?.cents ?? 0;
  const inTune = reading != null && Math.abs(cents) < 5;
  const needleAngle = Math.max(-45, Math.min(45, (cents / 50) * 45));

  return (
    <div className="h-full overflow-y-auto p-6 flex flex-col items-center">
      <PageHeader
        title="Accordeur"
        subtitle="Plug-in la guitare via l'iRig (canal Clean) et joue une corde à vide."
      />


      {/* Big note display. aria-live lets screen readers announce pitch
          changes without the user having to re-focus the region. */}
      <div
        className="bg-amp-panel border border-amp-border rounded-lg w-full max-w-md p-6 flex flex-col items-center"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={
          reading
            ? `Note détectée : ${reading.note}, ${reading.frequency.toFixed(1)} hertz, ${
                inTune
                  ? 'juste'
                  : `${cents > 0 ? 'trop haut' : 'trop bas'} de ${Math.abs(cents)} centièmes`
              }`
            : 'Accordeur en attente'
        }
      >
        <Readout
          size="hero"
          className={`transition-colors ${
            inTune ? 'text-amp-success' : 'text-amp-text'
          }`}
          aria-hidden="true"
        >
          {reading?.note ?? '—'}
        </Readout>
        <div className="text-sm text-amp-muted mt-1" aria-hidden="true">
          {reading ? `${reading.frequency.toFixed(1)} Hz` : 'En attente…'}
        </div>

        {/* Needle */}
        <div className="relative w-64 h-32 mt-6">
          {/* Arc */}
          <svg viewBox="-100 -90 200 100" className="w-full h-full">
            <path
              d="M -90 0 A 90 90 0 0 1 90 0"
              fill="none"
              stroke="#2a2a2a"
              strokeWidth="6"
            />
            {/* Tick marks every 10 cents */}
            {[-50, -25, 0, 25, 50].map((c) => {
              const a = (c / 50) * 45;
              const rad = (a * Math.PI) / 180;
              const x1 = Math.sin(rad) * 80;
              const y1 = -Math.cos(rad) * 80;
              const x2 = Math.sin(rad) * 90;
              const y2 = -Math.cos(rad) * 90;
              return (
                <line
                  key={c}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={c === 0 ? '#10b981' : '#525252'}
                  strokeWidth={c === 0 ? 3 : 1.5}
                />
              );
            })}
            {/* Needle */}
            <line
              x1={0}
              y1={0}
              x2={Math.sin((needleAngle * Math.PI) / 180) * 80}
              y2={-Math.cos((needleAngle * Math.PI) / 180) * 80}
              stroke={inTune ? '#10b981' : '#f59e0b'}
              strokeWidth={3}
              strokeLinecap="round"
              style={{ transition: 'all 80ms ease-out' }}
            />
            <circle cx={0} cy={0} r={4} fill={inTune ? '#10b981' : '#f59e0b'} />
          </svg>
        </div>

        <div className="mt-2 font-mono text-amp-text">
          {reading ? `${cents > 0 ? '+' : ''}${cents} cents` : '—'}
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        {!active ? (
          <Button onClick={start} aria-label="Démarrer l'accordeur">
            <span aria-hidden="true">🎤 </span>Démarrer
          </Button>
        ) : (
          <Button
            variant="destructive"
            onClick={stop}
            aria-label="Arrêter l'accordeur"
          >
            <span aria-hidden="true">⏹ </span>Arrêter
          </Button>
        )}
      </div>

      {error && (
        <ErrorStrip className="mt-4 max-w-md text-center">{error}</ErrorStrip>
      )}
    </div>
  );
}
