/**
 * Page "Réglages".
 *
 * Expose les paramètres persistants :
 *   • A4 de référence (Hz) — affecte l'accordeur
 *   • Accordage par défaut du Transcriber
 *   • URL du backend Demucs (si différent de localhost:8000)
 *   • Poids des coûts Viterbi (placement des frettes)
 *
 * Tout est stocké dans IndexedDB via src/lib/settings.ts. Les changements
 * sont immédiats — inutile de recharger l'app.
 */

/** PWA install prompt event — not in lib.dom.d.ts yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { TUNINGS } from '../lib/guitarTunings';
import { DEFAULT_COST_WEIGHTS } from '../lib/midi-to-tab';
import { MidiController, type MidiAction } from '../lib/midi-controller';
import { VoiceCommandEngine, type VoiceAction } from '../lib/voice-commands';
import { toast } from './Toast';
import {
  DEFAULT_SETTINGS,
  getSettings,
  resetSettings,
  subscribeSettings,
  updateSettings,
  type AppSettings,
} from '../lib/settings';

/**
 * Tiny hook that subscribes this component to settings changes. When any
 * other place in the app writes via updateSettings(), we re-render.
 */
function useSettings(): AppSettings {
  const [snap, setSnap] = useState<AppSettings>(() => getSettings());
  useEffect(() => subscribeSettings(setSnap), []);
  return snap;
}

export function Settings() {
  const settings = useSettings();
  const [saveFlash, setSaveFlash] = useState<string | null>(null);

  // ───── MIDI controller ─────
  const midiRef = useRef<MidiController | null>(null);
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [midiConnected, setMidiConnected] = useState(false);
  const [lastMidiAction, setLastMidiAction] = useState<string | null>(null);

  const connectMidi = useCallback(async () => {
    const ctrl = new MidiController();
    if (!ctrl.isSupported) {
      toast.error('Web MIDI non supporté sur ce navigateur.');
      return;
    }
    ctrl.onAction = (action: MidiAction) => {
      setLastMidiAction(action);
      toast.info(`MIDI: ${action}`);
    };
    ctrl.onDeviceChange = (devices) => setMidiDevices(devices);
    const devices = await ctrl.connect();
    midiRef.current = ctrl;
    setMidiDevices(devices);
    setMidiConnected(true);
    toast.success(`MIDI connecté (${devices.length} appareil${devices.length > 1 ? 's' : ''})`);
  }, []);

  const disconnectMidi = useCallback(() => {
    midiRef.current?.disconnect();
    midiRef.current = null;
    setMidiConnected(false);
    setMidiDevices([]);
    setLastMidiAction(null);
  }, []);

  useEffect(() => () => { midiRef.current?.disconnect(); }, []);

  // ───── Voice commands ─────
  const voiceRef = useRef<VoiceCommandEngine | null>(null);
  const [voiceListening, setVoiceListening] = useState(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState<string | null>(null);
  const [lastVoiceAction, setLastVoiceAction] = useState<string | null>(null);

  const toggleVoice = useCallback(() => {
    if (voiceListening) {
      voiceRef.current?.stop();
      voiceRef.current = null;
      setVoiceListening(false);
      return;
    }
    const engine = new VoiceCommandEngine();
    if (!engine.isSupported) {
      toast.error('Reconnaissance vocale non supportée.');
      return;
    }
    engine.onAction = (action: VoiceAction) => {
      setLastVoiceAction(action);
      toast.info(`Voix: ${action}`);
    };
    engine.onTranscript = (text) => setLastVoiceTranscript(text);
    engine.onError = (err) => toast.error(`Voix: ${err}`);
    const ok = engine.start();
    if (ok) {
      voiceRef.current = engine;
      setVoiceListening(true);
      toast.success('Commandes vocales activées');
    }
  }, [voiceListening]);

  useEffect(() => () => { voiceRef.current?.stop(); }, []);

  // ───── PWA Install ─────
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  // Wrap updateSettings() so the small "Enregistré" toast is consistent.
  const update = async (patch: Partial<AppSettings>) => {
    await updateSettings(patch);
    setSaveFlash('✓ Enregistré');
    window.setTimeout(() => setSaveFlash(null), 1200);
  };

  const reset = async () => {
    if (!confirm('Restaurer tous les réglages par défaut ?')) return;
    await resetSettings();
    setSaveFlash('✓ Réinitialisé');
    window.setTimeout(() => setSaveFlash(null), 1500);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6 max-w-2xl">
        <div>
          <h2 className="text-2xl font-bold">Réglages</h2>
          <p className="text-amp-muted text-sm mt-1">
            Paramètres persistants, stockés localement dans ton navigateur.
          </p>
        </div>
        {saveFlash && (
          <span className="text-amp-success text-sm">{saveFlash}</span>
        )}
      </div>

      {/* ───── Accordeur ───── */}
      <Section title="Accordeur" subtitle="Affecte la page Accordeur en temps réel.">
        <Field label="Référence La4 (Hz)">
          <input
            type="number"
            step="0.5"
            min="400"
            max="480"
            value={settings.a4Hz}
            onChange={(e) => update({ a4Hz: Number(e.target.value) })}
            className="w-32 bg-amp-panel border border-amp-border rounded px-3 py-2 text-amp-text focus:outline-none focus:border-amp-accent"
          />
          <div className="text-xs text-amp-muted mt-1">
            Standard : 440 Hz. Certains orchestres utilisent 442, le tuning
            « Verdi » 432.
          </div>
        </Field>
      </Section>

      {/* ───── Transcription ───── */}
      <Section
        title="Transcription"
        subtitle="Valeurs par défaut pour la page Transcrire."
      >
        <Field label="Accordage par défaut">
          <select
            value={settings.defaultTuningId}
            onChange={(e) => update({ defaultTuningId: e.target.value })}
            className="w-full max-w-md bg-amp-panel border border-amp-border rounded px-3 py-2 text-amp-text focus:outline-none focus:border-amp-accent"
          >
            {Object.values(TUNINGS).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
      </Section>

      {/* ───── Backend Demucs ───── */}
      <Section
        title="Backend Demucs"
        subtitle="Serveur local pour isoler un stem (guitare / voix) avant transcription."
      >
        <Field label="URL">
          <input
            type="url"
            placeholder="http://localhost:8000"
            value={settings.demucsUrl}
            onChange={(e) => update({ demucsUrl: e.target.value })}
            className="w-full max-w-md bg-amp-panel border border-amp-border rounded px-3 py-2 text-amp-text font-mono text-sm focus:outline-none focus:border-amp-accent"
          />
          <div className="text-xs text-amp-muted mt-1">
            Vide = utilise <code>VITE_DEMUCS_API</code> ou{' '}
            <code>http://localhost:8000</code>. Utile si tu exposes le backend
            sur ton LAN.
          </div>
        </Field>
      </Section>

      {/* ───── Viterbi ───── */}
      <Section
        title="Poids Viterbi"
        subtitle="Règlent comment le placement des frettes est choisi. Baisse movement pour obtenir des doigtés plus mobiles, monte openStringBonus pour favoriser les cordes à vide."
      >
        <WeightSlider
          label="Coût de déplacement (frettes)"
          value={settings.costWeights.movement}
          min={0}
          max={3}
          step={0.1}
          onChange={(v) =>
            update({
              costWeights: { ...settings.costWeights, movement: v },
            })
          }
        />
        <WeightSlider
          label="Coût de changement de corde"
          value={settings.costWeights.stringChange}
          min={0}
          max={3}
          step={0.1}
          onChange={(v) =>
            update({
              costWeights: { ...settings.costWeights, stringChange: v },
            })
          }
        />
        <WeightSlider
          label="Pénalité frettes aiguës (>5)"
          value={settings.costWeights.highFretPenalty}
          min={0}
          max={1}
          step={0.05}
          onChange={(v) =>
            update({
              costWeights: { ...settings.costWeights, highFretPenalty: v },
            })
          }
        />
        <WeightSlider
          label="Bonus corde à vide (négatif)"
          value={settings.costWeights.openStringBonus}
          min={-3}
          max={0}
          step={0.1}
          onChange={(v) =>
            update({
              costWeights: { ...settings.costWeights, openStringBonus: v },
            })
          }
        />
        <button
          onClick={() =>
            update({ costWeights: { ...DEFAULT_COST_WEIGHTS } })
          }
          className="mt-2 text-xs text-amp-muted hover:text-amp-accent transition-colors"
        >
          ↺ Valeurs par défaut
        </button>
      </Section>

      {/* ───── MIDI ───── */}
      <Section
        title="Pédalier MIDI"
        subtitle="Connecte un pédalier MIDI USB ou Bluetooth pour contrôler l'app au pied."
      >
        <div className="flex items-center gap-3">
          <button
            onClick={midiConnected ? disconnectMidi : connectMidi}
            className={`px-4 py-2 rounded text-sm font-bold transition-colors ${
              midiConnected
                ? 'bg-amp-error/20 text-amp-error border border-amp-error/40'
                : 'bg-amp-accent text-amp-bg'
            }`}
          >
            {midiConnected ? 'Déconnecter' : 'Connecter MIDI'}
          </button>
          {midiConnected && (
            <span className="text-xs text-amp-success">Connecté</span>
          )}
        </div>
        {midiDevices.length > 0 && (
          <div className="text-xs text-amp-muted mt-2">
            Appareils : {midiDevices.join(', ')}
          </div>
        )}
        {lastMidiAction && (
          <div className="text-xs text-amp-accent mt-1">
            Dernière action : {lastMidiAction}
          </div>
        )}
        <div className="text-xs text-amp-muted mt-2">
          CC 64 = Play/Pause, CC 65 = Boucle, CC 66 = Ralentir, CC 67 = Accélérer
        </div>
      </Section>

      {/* ───── Commandes vocales ───── */}
      <Section
        title="Commandes vocales"
        subtitle="Contrôle mains libres via le micro. Dis 'joue', 'pause', 'boucle', 'ralentis'..."
      >
        <div className="flex items-center gap-3">
          <button
            onClick={toggleVoice}
            className={`px-4 py-2 rounded text-sm font-bold transition-colors ${
              voiceListening
                ? 'bg-amp-error/20 text-amp-error border border-amp-error/40 animate-pulse'
                : 'bg-amp-accent text-amp-bg'
            }`}
          >
            {voiceListening ? '🎙️ Arrêter' : '🎙️ Activer'}
          </button>
          {voiceListening && (
            <span className="text-xs text-amp-success">En écoute...</span>
          )}
        </div>
        {lastVoiceTranscript && (
          <div className="text-xs text-amp-muted mt-2">
            Entendu : « {lastVoiceTranscript} »
          </div>
        )}
        {lastVoiceAction && (
          <div className="text-xs text-amp-accent mt-1">
            Action : {lastVoiceAction}
          </div>
        )}
      </Section>

      {/* ───── PWA Install ───── */}
      {installPrompt && (
        <Section
          title="Installer OmniTab"
          subtitle="Ajoute l'app à ton écran d'accueil pour un accès rapide et offline."
        >
          <button
            onClick={async () => {
              installPrompt.prompt();
              const result = await installPrompt.userChoice;
              if (result.outcome === 'accepted') {
                toast.success('OmniTab installée !');
                setInstallPrompt(null);
              }
            }}
            className="bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-6 py-2.5 rounded transition-colors"
          >
            📱 Installer OmniTab
          </button>
        </Section>
      )}

      {/* ───── Reset global ───── */}
      <div className="max-w-2xl mt-8 p-4 border border-amp-border rounded">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-bold text-amp-text mb-0.5">Tout réinitialiser</div>
            <div className="text-xs text-amp-muted">
              Restaure les valeurs de départ : A4={DEFAULT_SETTINGS.a4Hz} Hz,
              accordage standard, Viterbi par défaut.
            </div>
          </div>
          <button
            onClick={reset}
            className="bg-amp-error/20 hover:bg-amp-error/30 text-amp-error border border-amp-error/40 font-bold px-4 py-2 rounded text-sm transition-colors"
          >
            Réinitialiser
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Building blocks ─────────────────────────

interface SectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

function Section({ title, subtitle, children }: SectionProps) {
  return (
    <section className="max-w-2xl mb-6 p-4 bg-amp-panel border border-amp-border rounded">
      <h3 className="font-bold text-amp-accent mb-1">{title}</h3>
      {subtitle && (
        <p className="text-xs text-amp-muted mb-4">{subtitle}</p>
      )}
      <div className="space-y-4">{children}</div>
    </section>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <div>
      <label className="block text-sm text-amp-text mb-1">{label}</label>
      {children}
    </div>
  );
}

interface WeightSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function WeightSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: WeightSliderProps) {
  // Stable id for <label htmlFor> — gives screen readers a proper name
  // and lets mouse users click the label to focus the slider.
  const id = `slider-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const valueText = `${value.toFixed(2)} (plage ${min} à ${max})`;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label htmlFor={id} className="text-sm text-amp-text">
          {label}
        </label>
        <span className="text-sm font-mono text-amp-muted" aria-hidden="true">
          {value.toFixed(2)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        className="w-full accent-amp-accent"
      />
    </div>
  );
}
