/**
 * AmpAutoConfig — "I have THIS guitar + THIS amp, configure me for THIS song".
 *
 * Three free-text/autocomplete inputs feed into the hybrid lookup:
 *   1. Curated preset (instant, offline) for ~30 famous songs
 *   2. Gemini Flash (free quota) for everything else
 *
 * On result, we preview the suggested settings and let the user APPLY
 * them (overwrites current amp + pedalboard state) or DISMISS them.
 *
 * Why preview instead of auto-applying? The user might be mid-jam with
 * carefully tweaked settings — silently nuking them would be hostile.
 */

import { useCallback, useState } from 'react';
import {
  autoConfig,
  searchSongPresets,
  type AutoConfigResult,
} from '../lib/auto-config';
import {
  AMPS,
  GUITARS,
  filterSuggestions,
  type InstrumentSuggestion,
} from '../lib/guitars-amps';
import type { AmpSimParams } from '../lib/audio-engine';
import { PEDAL_DEFS, type PedalSlot } from '../lib/pedals';
import { getSettings } from '../lib/settings';
import { Combobox, type ComboboxOption } from './Combobox';
import { toast } from './Toast';
import { Button, Card, ErrorStrip, SectionLabel } from './primitives';

interface AmpAutoConfigProps {
  /** Apply the suggested config to the live amp + pedalboard. */
  onApply: (amp: AmpSimParams, pedals: PedalSlot[]) => void;
}

// Map InstrumentSuggestion[] → ComboboxOption[] once at module load —
// the suggest function below just slices, no per-keystroke allocation.
const guitarSuggest = (q: string): ComboboxOption[] =>
  filterSuggestions(GUITARS, q, 8).map(toComboOption);
const ampSuggest = (q: string): ComboboxOption[] =>
  filterSuggestions(AMPS, q, 8).map(toComboOption);

function toComboOption(item: InstrumentSuggestion): ComboboxOption {
  return {
    value: item.name,
    caption: item.tags.slice(0, 3).join(' · '),
  };
}

// Song suggestion uses the curated preset list — only matches known songs.
// Free-text outside the preset list still works (Gemini handles it).
const songSuggest = (q: string): ComboboxOption[] =>
  searchSongPresets(q, 6).map((p) => ({
    value: p.title,
    caption: `${p.artist} · ${p.blurb.slice(0, 50)}`,
  }));

export function AmpAutoConfig({ onApply }: AmpAutoConfigProps) {
  const [guitar, setGuitar] = useState('');
  const [amp, setAmp] = useState('');
  const [song, setSong] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AutoConfigResult | null>(null);

  const submit = useCallback(async () => {
    setError(null);
    setResult(null);
    if (!song.trim()) {
      setError('Indique au moins un morceau.');
      return;
    }
    setLoading(true);
    try {
      const r = await autoConfig({
        guitar: guitar.trim() || 'Guitare générique',
        amp: amp.trim() || 'Ampli générique',
        song: song.trim(),
      });
      setResult(r);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [guitar, amp, song]);

  const apply = useCallback(() => {
    if (!result) return;
    onApply(result.amp, result.pedals);
    toast.success(
      `Réglages appliqués (${result.source === 'preset' ? 'preset' : 'IA'}).`,
    );
    // Keep the result visible so the user can re-apply if they tweak then regret.
  }, [result, onApply]);

  const dismiss = () => setResult(null);

  // The Gemini key check is just a UX hint — `autoConfig` will throw a
  // proper GeminiError if the key is missing AND the song isn't a preset.
  const hasGeminiKey = (getSettings().geminiApiKey ?? '').trim().length > 0;

  return (
    <Card padding="p-5" className="max-w-2xl">
      <SectionLabel>Auto-config IA</SectionLabel>
      <p className="text-xs text-amp-muted mb-4">
        Indique ta guitare, ton ampli et un morceau — je trouve la bonne
        configuration. ~30 morceaux célèbres en local (instantané), tout le
        reste via Gemini (gratuit, ~2s).
      </p>

      <div className="space-y-3 mb-4">
        <Field label="Guitare">
          <Combobox
            value={guitar}
            onChange={setGuitar}
            suggest={guitarSuggest}
            placeholder="Ex. Fender Stratocaster…"
            ariaLabel="Modèle de guitare"
            disabled={loading}
          />
        </Field>
        <Field label="Ampli">
          <Combobox
            value={amp}
            onChange={setAmp}
            suggest={ampSuggest}
            placeholder="Ex. Marshall JCM800…"
            ariaLabel="Modèle d'ampli"
            disabled={loading}
          />
        </Field>
        <Field label="Morceau">
          <Combobox
            value={song}
            onChange={setSong}
            onCommit={submit}
            suggest={songSuggest}
            placeholder="Ex. Voodoo Child, Smoke on the Water…"
            ariaLabel="Titre du morceau"
            disabled={loading}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={submit} disabled={loading || !song.trim()}>
          {loading ? '⏳ Recherche…' : '🎯 Configurer'}
        </Button>
        {!hasGeminiKey && (
          <span className="text-xs text-amp-muted">
            (Sans clé Gemini, seuls les ~30 presets fonctionnent — voir Réglages.)
          </span>
        )}
      </div>

      {error && <ErrorStrip className="mt-4">{error}</ErrorStrip>}

      {result && (
        <ResultPreview result={result} onApply={apply} onDismiss={dismiss} />
      )}
    </Card>
  );
}

// ─── Result preview ─────────────────────────────────────────────────────

interface ResultPreviewProps {
  result: AutoConfigResult;
  onApply: () => void;
  onDismiss: () => void;
}

function ResultPreview({ result, onApply, onDismiss }: ResultPreviewProps) {
  const activePedals = result.pedals.filter((p) => p.active);
  return (
    <div className="mt-5 pt-5 border-t border-amp-border">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`text-[10px] font-bold tracking-wider px-2 py-0.5 rounded ${
            result.source === 'preset'
              ? 'bg-amp-accent/20 text-amp-accent'
              : 'bg-blue-500/20 text-blue-400'
          }`}
        >
          {result.source === 'preset' ? 'PRESET' : 'IA GEMINI'}
        </span>
        <span className="text-xs text-amp-muted">Suggestion :</span>
      </div>
      <p className="text-sm text-amp-text mb-3">{result.blurb}</p>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
        <Stat label="Voicing" value={result.amp.voicing} />
        <Stat label="Drive" value={result.amp.drive.toFixed(1)} />
        <Stat
          label="Bass"
          value={`${result.amp.bass >= 0 ? '+' : ''}${result.amp.bass.toFixed(1)} dB`}
        />
        <Stat
          label="Mid"
          value={`${result.amp.mid >= 0 ? '+' : ''}${result.amp.mid.toFixed(1)} dB`}
        />
        <Stat
          label="Treble"
          value={`${result.amp.treble >= 0 ? '+' : ''}${result.amp.treble.toFixed(1)} dB`}
        />
        <Stat label="Master" value={`${Math.round(result.amp.master * 100)}%`} />
      </div>

      <div className="mb-4">
        <div className="text-xs text-amp-muted mb-1">
          Pédales activées ({activePedals.length}/8)
        </div>
        {activePedals.length === 0 ? (
          <div className="text-xs text-amp-muted italic">
            Aucune — l'ampli seul suffit.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {activePedals.map((p) => (
              <span
                key={p.kind}
                className="text-[11px] font-bold px-2 py-1 rounded"
                style={{
                  backgroundColor: `${PEDAL_DEFS[p.kind].color}33`,
                  color: PEDAL_DEFS[p.kind].color,
                }}
              >
                {PEDAL_DEFS[p.kind].name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button onClick={onApply} variant="primary">
          ✅ Appliquer
        </Button>
        <Button onClick={onDismiss} variant="secondary">
          Annuler
        </Button>
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: string;
}

function Stat({ label, value }: StatProps) {
  return (
    <div className="flex justify-between border-b border-amp-border/50 py-0.5">
      <span className="text-amp-muted">{label}</span>
      <span className="font-mono text-amp-text">{value}</span>
    </div>
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
