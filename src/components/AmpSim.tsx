/**
 * Amp simulator UI — wires the live mic input through createAmpSim() and
 * renders knobs for drive / EQ / master / voicing.
 *
 * The audio chain itself lives in lib/audio-engine.ts (createAmpSim).
 */

import { useEffect, useRef, useState } from 'react';
import {
  createAmpSim,
  getAudioContext,
  requestMicStream,
  resumeAudioContext,
  type AmpSimChain,
  type AmpSimParams,
} from '../lib/audio-engine';

interface Preset {
  name: string;
  params: AmpSimParams;
}

const PRESETS: Preset[] = [
  {
    name: 'Clean Fender',
    params: {
      drive: 2,
      bass: 2,
      mid: -2,
      treble: 4,
      master: 0.5,
      voicing: 'clean',
    },
  },
  {
    name: 'Crunch Marshall',
    params: {
      drive: 6,
      bass: 3,
      mid: 4,
      treble: 2,
      master: 0.5,
      voicing: 'crunch',
    },
  },
  {
    name: 'High Gain Mesa',
    params: {
      drive: 9,
      bass: 5,
      mid: 0,
      treble: 3,
      master: 0.4,
      voicing: 'lead',
    },
  },
  {
    name: 'Blues BB King',
    params: {
      drive: 4,
      bass: 1,
      mid: 5,
      treble: 2,
      master: 0.5,
      voicing: 'crunch',
    },
  },
];

export function AmpSim() {
  const [params, setParams] = useState<AmpSimParams>(PRESETS[0].params);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chainRef = useRef<AmpSimChain | null>(null);

  // Update node parameters live when sliders move (no rebuild needed for EQ/master).
  useEffect(() => {
    const chain = chainRef.current;
    if (!chain) return;
    chain.bass.gain.value = params.bass;
    chain.mid.gain.value = params.mid;
    chain.treble.gain.value = params.treble;
    chain.master.gain.value = params.master;
    // Drive curve has to be rebuilt — handled in `start()` only on initial param.
  }, [params.bass, params.mid, params.treble, params.master]);

  // For voicing or drive amount, the WaveShaper curve has to be regenerated.
  // Easiest: rebuild the whole chain when those change.
  useEffect(() => {
    if (!active) return;
    rebuildChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.drive, params.voicing]);

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rebuildChain = () => {
    if (!sourceRef.current) return;
    const ctx = getAudioContext();
    chainRef.current?.dispose();
    const chain = createAmpSim(ctx, sourceRef.current, params);
    chain.output.connect(ctx.destination);
    chainRef.current = chain;
  };

  const start = async () => {
    setError(null);
    try {
      await resumeAudioContext();
      const stream = await requestMicStream();
      streamRef.current = stream;
      const ctx = getAudioContext();
      sourceRef.current = ctx.createMediaStreamSource(stream);
      const chain = createAmpSim(ctx, sourceRef.current, params);
      chain.output.connect(ctx.destination);
      chainRef.current = chain;
      setActive(true);
    } catch (err) {
      console.error(err);
      setError("Impossible d'accéder au micro/iRig.");
    }
  };

  const stop = () => {
    chainRef.current?.dispose();
    chainRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  };

  const updateParam = <K extends keyof AmpSimParams>(
    key: K,
    value: AmpSimParams[K],
  ) => {
    setParams((p) => ({ ...p, [key]: value }));
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-2">Simulateur d'Ampli</h2>
      <p className="text-amp-muted text-sm mb-6">
        ⚠ Évite les larsens : utilise un casque, pas les haut-parleurs de l'ordi.
      </p>

      {/* On/Off */}
      <div className="mb-6">
        {!active ? (
          <button
            onClick={start}
            className="bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-6 py-2 rounded transition-colors"
          >
            🔌 Activer
          </button>
        ) : (
          <button
            onClick={stop}
            className="bg-amp-error hover:bg-red-600 text-white font-bold px-6 py-2 rounded transition-colors"
          >
            ⏹ Désactiver
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-amp-error/20 border border-amp-error rounded text-amp-error text-sm">
          {error}
        </div>
      )}

      {/* Presets */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-amp-muted mb-2">Presets</h3>
        <div className="flex gap-2 flex-wrap">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              onClick={() => setParams(preset.params)}
              className="bg-amp-panel-2 hover:bg-amp-accent hover:text-amp-bg text-amp-text px-3 py-1.5 rounded text-sm transition-colors"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Voicing */}
      <div className="mb-6">
        <h3 className="text-sm font-bold text-amp-muted mb-2">Voicing</h3>
        <div className="flex gap-2">
          {(['clean', 'crunch', 'lead'] as const).map((v) => (
            <button
              key={v}
              onClick={() => updateParam('voicing', v)}
              className={`px-4 py-1.5 rounded text-sm transition-colors ${
                params.voicing === v
                  ? 'bg-amp-accent text-amp-bg'
                  : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Knobs */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 max-w-2xl">
        <Knob
          label="Drive"
          value={params.drive}
          min={0}
          max={10}
          step={0.1}
          onChange={(v) => updateParam('drive', v)}
        />
        <Knob
          label="Bass"
          value={params.bass}
          min={-12}
          max={12}
          step={0.5}
          unit="dB"
          onChange={(v) => updateParam('bass', v)}
        />
        <Knob
          label="Mid"
          value={params.mid}
          min={-12}
          max={12}
          step={0.5}
          unit="dB"
          onChange={(v) => updateParam('mid', v)}
        />
        <Knob
          label="Treble"
          value={params.treble}
          min={-12}
          max={12}
          step={0.5}
          unit="dB"
          onChange={(v) => updateParam('treble', v)}
        />
        <Knob
          label="Master"
          value={params.master}
          min={0}
          max={1}
          step={0.01}
          onChange={(v) => updateParam('master', v)}
        />
      </div>
    </div>
  );
}

interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

function Knob({ label, value, min, max, step, unit, onChange }: KnobProps) {
  return (
    <label className="flex flex-col items-center bg-amp-panel border border-amp-border rounded p-3">
      <div className="text-sm text-amp-muted mb-1">{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-amp-accent"
      />
      <div className="font-mono text-amp-text text-sm mt-1">
        {value.toFixed(step < 1 ? 1 : 0)}
        {unit ? ` ${unit}` : ''}
      </div>
    </label>
  );
}
