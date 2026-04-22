/**
 * Amp simulator UI — wires the live mic input through createAmpSim() and
 * renders knobs for drive / EQ / master / voicing PLUS an 8-slot
 * pedalboard PLUS the AI auto-config feature.
 *
 * Signal chain (built by lib/audio-engine.ts):
 *   mic → [active pedals in canonical order] → drive → bass/mid/treble → master → speakers
 *
 * Why one giant file? AmpSim owns the live AudioContext nodes and has to
 * coordinate amp params, pedalboard slots, and auto-config side-effects
 * in a single useEffect graph. Splitting the state would make the wiring
 * harder to follow than the size cost saves.
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
import { appBus } from '../lib/event-bus';
import { analyseTone, suggestEq } from '../lib/auto-tone';
import {
  PEDAL_DEFS,
  makeDefaultPedalboard,
  type PedalSlot,
} from '../lib/pedals';
import { AmpAutoConfig } from './AmpAutoConfig';
import { Pedalboard } from './Pedalboard';
import { toast } from './Toast';
import {
  Button,
  Card,
  ErrorStrip,
  Knob,
  PageHeader,
  SectionLabel,
} from './primitives';

// ── Knob value formatters ──────────────────────────────────────────
// Module-level so they aren't recreated on every render. EQ uses a
// signed display ("+5.0 dB" / "-3.0 dB") because the sign tells you at a
// glance whether you're boosting or cutting — standard amp UX. Master
// shows percent because 0..1 reads weirdly to humans.
const fmtDb = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`;
const fmtPercent = (v: number) => `${Math.round(v * 100)}%`;

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
  const [pedals, setPedals] = useState<PedalSlot[]>(() => makeDefaultPedalboard());
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chainRef = useRef<AmpSimChain | null>(null);
  // Hidden file-input ref — lets us trigger the picker from a <Button>
  // primitive instead of wrapping it in a <label> (which would swallow
  // the button's click before it can bubble). Same pattern as Library.
  const autoToneInputRef = useRef<HTMLInputElement>(null);

  // ─── Live amp param updates (no rebuild needed for EQ/master) ──────
  useEffect(() => {
    const chain = chainRef.current;
    if (!chain) return;
    chain.bass.gain.value = params.bass;
    chain.mid.gain.value = params.mid;
    chain.treble.gain.value = params.treble;
    chain.master.gain.value = params.master;
  }, [params.bass, params.mid, params.treble, params.master]);

  // For voicing or drive amount, the WaveShaper curve has to be regenerated.
  // Easiest: rebuild the whole chain when those change.
  useEffect(() => {
    if (!active) return;
    rebuildChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.drive, params.voicing]);

  // ─── Live pedal param updates ─────────────────────────────────────
  // When a pedal knob moves, we walk the chain's `pedals[]` and update
  // the matching live PedalChain via setParam(). No rebuild — Web Audio
  // takes the new value on the next sample buffer.
  // We DO rebuild on activate/deactivate (next effect below).
  useEffect(() => {
    const chain = chainRef.current;
    if (!chain) return;
    // Map active-pedal kinds to their live PedalChain instance. If the
    // user just toggled a pedal, the chain length changes — that's
    // handled by the rebuild effect below, this one only updates knobs.
    const liveChainsByKind = new Map<PedalSlot['kind'], typeof chain.pedals[0]>();
    let activeIdx = 0;
    for (const slot of pedals) {
      if (slot.active && chain.pedals[activeIdx]) {
        liveChainsByKind.set(slot.kind, chain.pedals[activeIdx]);
        activeIdx++;
      }
    }
    // Sync each knob — `setParam` is a no-op if the value didn't change.
    for (const slot of pedals) {
      const live = liveChainsByKind.get(slot.kind);
      if (!live) continue;
      for (const [key, value] of Object.entries(slot.params)) {
        live.setParam(key, value);
      }
    }
  }, [pedals]);

  // Rebuild whenever the SET of active pedals changes (toggle on/off).
  // We intentionally watch a derived primitive (the active-mask string)
  // so React doesn't re-fire on every knob tweak.
  const activeMask = pedals.map((p) => (p.active ? '1' : '0')).join('');
  useEffect(() => {
    if (!active) return;
    rebuildChain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMask]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Voice-command driven voicing changes.
  useEffect(() => {
    const offs = [
      appBus.on('amp-clean', () => setParams((p) => ({ ...p, voicing: 'clean' }))),
      appBus.on('amp-crunch', () => setParams((p) => ({ ...p, voicing: 'crunch' }))),
      appBus.on('amp-lead', () => setParams((p) => ({ ...p, voicing: 'lead' }))),
    ];
    return () => { for (const off of offs) off(); };
  }, []);

  const rebuildChain = () => {
    if (!sourceRef.current) return;
    const ctx = getAudioContext();
    chainRef.current?.dispose();
    const chain = createAmpSim(ctx, sourceRef.current, params, pedals);
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
      const chain = createAmpSim(ctx, sourceRef.current, params, pedals);
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

  // ─── Pedalboard handlers ─────────────────────────────────────────
  const togglePedal = (kind: PedalSlot['kind']) => {
    setPedals((prev) =>
      prev.map((p) => (p.kind === kind ? { ...p, active: !p.active } : p)),
    );
  };

  const updatePedalParam = (
    kind: PedalSlot['kind'],
    key: string,
    value: number,
  ) => {
    setPedals((prev) =>
      prev.map((p) =>
        p.kind === kind
          ? { ...p, params: { ...p.params, [key]: value } }
          : p,
      ),
    );
  };

  const resetPedals = () => {
    setPedals(makeDefaultPedalboard());
    toast.info('Pédalier remis à zéro.');
  };

  // ─── Auto-config handler ─────────────────────────────────────────
  // Replaces BOTH amp params and pedalboard atomically. The two state
  // updates trigger one rebuild via the activeMask effect above.
  const applyAutoConfig = (
    nextAmp: AmpSimParams,
    nextPedals: PedalSlot[],
  ) => {
    setParams(nextAmp);
    setPedals(nextPedals);
  };

  // ─── Auto-tone (existing feature, unchanged) ─────────────────────
  const [autoToning, setAutoToning] = useState(false);
  const handleAutoTone = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setAutoToning(true);
    try {
      const analysis = await analyseTone(f);
      const eq = suggestEq(analysis);
      setParams((p) => ({ ...p, bass: eq.bass, mid: eq.mid, treble: eq.treble }));
      toast.success(
        `Auto-tone : B ${eq.bass.toFixed(1)}dB / M ${eq.mid.toFixed(1)}dB / T ${eq.treble.toFixed(1)}dB`,
      );
    } catch (err) {
      toast.error(`Auto-tone a échoué : ${(err as Error).message}`);
    } finally {
      setAutoToning(false);
      // Reset the input so re-uploading the same file re-triggers.
      e.target.value = '';
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="Simulateur d'ampli"
        subtitle="⚠ Évite les larsens : utilise un casque, pas les haut-parleurs de l'ordi."
      />

      {/* On/Off — pulled out of the card so it's the obvious primary action */}
      <div className="mb-6">
        {!active ? (
          <Button onClick={start} aria-label="Activer l'ampli">
            <span aria-hidden="true">🔌 </span>Activer
          </Button>
        ) : (
          <Button
            variant="destructive"
            onClick={stop}
            aria-label="Désactiver l'ampli"
          >
            <span aria-hidden="true">⏹ </span>Désactiver
          </Button>
        )}
      </div>

      {error && <ErrorStrip className="mb-4">{error}</ErrorStrip>}

      {/* Single card holds preset + voicing + knobs (per design mockup) */}
      <Card padding="p-5" className="max-w-4xl">
        <SectionLabel>Preset</SectionLabel>
        <div className="flex gap-2 flex-wrap mb-5">
          {PRESETS.map((preset) => (
            <Button
              key={preset.name}
              variant="chip"
              onClick={() => setParams(preset.params)}
            >
              {preset.name}
            </Button>
          ))}
        </div>

        <SectionLabel>Voicing</SectionLabel>
        <div className="flex gap-2 mb-6 flex-wrap">
          {(['clean', 'crunch', 'lead'] as const).map((v) => (
            <Button
              key={v}
              variant={params.voicing === v ? 'chipOn' : 'chip'}
              onClick={() => updateParam('voicing', v)}
              aria-pressed={params.voicing === v}
            >
              {v}
            </Button>
          ))}
        </div>

        <SectionLabel>EQ &amp; gain</SectionLabel>
        <div className="flex gap-6 justify-between flex-wrap">
          {/* Drive in red — high-gain "danger zone" colour. */}
          <Knob
            label="Drive"
            value={params.drive}
            min={0}
            max={10}
            step={0.1}
            color="#ef4444"
            onChange={(v) => updateParam('drive', v)}
          />
          <Knob
            label="Bass"
            value={params.bass}
            min={-12}
            max={12}
            step={0.5}
            format={fmtDb}
            onChange={(v) => updateParam('bass', v)}
          />
          <Knob
            label="Mid"
            value={params.mid}
            min={-12}
            max={12}
            step={0.5}
            format={fmtDb}
            onChange={(v) => updateParam('mid', v)}
          />
          <Knob
            label="Treble"
            value={params.treble}
            min={-12}
            max={12}
            step={0.5}
            format={fmtDb}
            onChange={(v) => updateParam('treble', v)}
          />
          {/* Master in green — output "go" colour, mirrors the design. */}
          <Knob
            label="Master"
            value={params.master}
            min={0}
            max={1}
            step={0.01}
            format={fmtPercent}
            color="#10b981"
            onChange={(v) => updateParam('master', v)}
          />
        </div>
      </Card>

      {/* ─── Pedalboard ────────────────────────────────────────────── */}
      <div className="mt-6 max-w-4xl">
        <Pedalboard
          pedals={pedals}
          onToggle={togglePedal}
          onParamChange={updatePedalParam}
          onReset={resetPedals}
        />
      </div>

      {/* ─── Auto-config IA ─────────────────────────────────────────── */}
      <div className="mt-6">
        <AmpAutoConfig onApply={applyAutoConfig} />
      </div>

      {/* Auto-tone — not in the design mockup but a real OmniTab feature. */}
      <div className="mt-6 max-w-2xl">
        <SectionLabel>Auto-tone EQ (par stem)</SectionLabel>
        <p className="text-xs text-amp-muted mb-3">
          Charge un stem de guitare (mp3/wav) : l'EQ s'ajuste pour approcher son timbre.
        </p>
        <Button
          variant="secondary"
          onClick={() => autoToneInputRef.current?.click()}
          disabled={autoToning}
        >
          {autoToning ? '⏳ Analyse…' : '📊 Analyser un stem'}
        </Button>
        <input
          ref={autoToneInputRef}
          type="file"
          accept="audio/*"
          onChange={handleAutoTone}
          disabled={autoToning}
          className="hidden"
        />
      </div>
    </div>
  );
}
// PEDAL_DEFS imported above is intentionally kept reachable for future
// helper consumers (e.g. surfacing a "what is XYZ pedal?" tooltip).
void PEDAL_DEFS;
