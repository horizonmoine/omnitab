/**
 * Auto-config for amp + pedalboard from (guitar, amp, song).
 *
 * Hybrid lookup strategy:
 *   1. Search SONG_PRESETS (instant, offline, free, accurate).
 *   2. If no match, ask Gemini for a tone recipe (~$0, ~2s latency).
 *
 * Both paths return the same `AutoConfigResult` shape so the UI doesn't
 * need to care which source produced the answer.
 */

import type { AmpSimParams } from './audio-engine';
import { callGemini, GeminiError, parseGeminiJson } from './gemini-client';
import {
  PEDAL_DEFS,
  PEDAL_ORDER,
  makeDefaultParams,
  type PedalKind,
  type PedalParams,
  type PedalSlot,
} from './pedals';
import { findSongPresets, type SongPreset } from './song-presets';

export interface AutoConfigInput {
  guitar: string;
  amp: string;
  song: string;
}

export interface AutoConfigResult {
  /** 'preset' | 'gemini' — tells the UI where the suggestion came from. */
  source: 'preset' | 'gemini';
  /** Resolved amp settings. */
  amp: AmpSimParams;
  /** All 8 pedal slots — inactive ones are bypassed but still present. */
  pedals: PedalSlot[];
  /** Human explanation shown to the user. */
  blurb: string;
  /** Optional matched preset (only set when source === 'preset'). */
  preset?: SongPreset;
  /** Raw Gemini response (only set when source === 'gemini') for debug. */
  rawJson?: string;
}

// ─── Preset path ──────────────────────────────────────────────────────────

/**
 * Convert a SongPreset into a full PedalSlot[] (8 slots, with inactive
 * ones at default params). The preset only stores the engaged pedals;
 * we expand to the full board here.
 */
function presetToSlots(preset: SongPreset): PedalSlot[] {
  return PEDAL_ORDER.map((kind) => {
    const engaged = preset.pedals.find((p) => p.kind === kind);
    if (!engaged) {
      return {
        kind,
        active: false,
        params: makeDefaultParams(kind),
      };
    }
    // Merge preset overrides with defaults (preset only stores deltas).
    return {
      kind,
      active: true,
      params: { ...makeDefaultParams(kind), ...engaged.params },
    };
  });
}

// ─── Gemini path ──────────────────────────────────────────────────────────

/**
 * Build the prompt sent to Gemini. We include the EXACT shape of pedals
 * available so the model can only suggest what we can actually render.
 */
function buildGeminiPrompt(input: AutoConfigInput): string {
  const pedalCatalog = PEDAL_ORDER.map((kind) => {
    const def = PEDAL_DEFS[kind];
    const knobs = def.knobs
      .map((k) => `${k.key} (${k.min}..${k.max}, défaut ${k.default})`)
      .join(', ');
    return `  - ${kind}: ${def.blurb} | knobs: ${knobs}`;
  }).join('\n');

  return `Tu es un expert en sonorité guitare. On me donne :
- Guitare : ${input.guitar}
- Ampli : ${input.amp}
- Morceau : ${input.song}

Donne-moi LE meilleur réglage d'ampli et la chaîne de pédales pour reproduire cette tonalité, en tenant compte de la guitare et de l'ampli fournis.

Réponds UNIQUEMENT en JSON, sans texte autour, qui suit ce schéma :
{
  "blurb": "1-2 phrases en français expliquant le choix de tonalité",
  "amp": {
    "drive": 0..10,
    "bass": -12..12,
    "mid": -12..12,
    "treble": -12..12,
    "master": 0..1,
    "voicing": "clean" | "crunch" | "lead"
  },
  "pedals": [
    { "kind": "<un des kinds disponibles>", "params": { "<knob_key>": <value>, ... } },
    ...
  ]
}

Pédales disponibles (utilise UNIQUEMENT ces "kind" et ces noms de knobs) :
${pedalCatalog}

Mets dans "pedals" UNIQUEMENT les pédales que tu actives (celles qui sont nécessaires). Si une pédale n'est pas utile, ne la liste pas. Tu peux activer 0 à 8 pédales.

Si la chanson est inconnue, fais quand même une suggestion crédible basée sur le titre / l'artiste / le style supposé.`;
}

/**
 * Shape we expect Gemini to return. We validate every field before
 * trusting it — a typo from the model would crash the audio engine.
 */
interface GeminiRecipe {
  blurb: string;
  amp: AmpSimParams;
  pedals: Array<{ kind: PedalKind; params: PedalParams }>;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Validate + sanitize Gemini's recipe. Anything out of bounds gets
 * clamped, anything missing falls back to defaults, unknown pedals are
 * dropped silently. The user always gets SOMETHING playable.
 */
function recipeToResult(recipe: GeminiRecipe): {
  amp: AmpSimParams;
  pedals: PedalSlot[];
  blurb: string;
} {
  const amp: AmpSimParams = {
    drive: clamp(Number(recipe.amp?.drive ?? 5), 0, 10),
    bass: clamp(Number(recipe.amp?.bass ?? 0), -12, 12),
    mid: clamp(Number(recipe.amp?.mid ?? 0), -12, 12),
    treble: clamp(Number(recipe.amp?.treble ?? 0), -12, 12),
    master: clamp(Number(recipe.amp?.master ?? 0.5), 0, 1),
    voicing: ['clean', 'crunch', 'lead'].includes(recipe.amp?.voicing as string)
      ? (recipe.amp.voicing)
      : 'crunch',
  };

  const slots: PedalSlot[] = PEDAL_ORDER.map((kind) => {
    const recipePedal = (recipe.pedals ?? []).find((p) => p.kind === kind);
    if (!recipePedal) {
      return { kind, active: false, params: makeDefaultParams(kind) };
    }
    // Validate every knob the recipe sets.
    const def = PEDAL_DEFS[kind];
    const params: PedalParams = makeDefaultParams(kind);
    for (const knob of def.knobs) {
      const raw = recipePedal.params?.[knob.key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        params[knob.key] = clamp(raw, knob.min, knob.max);
      }
    }
    return { kind, active: true, params };
  });

  return {
    amp,
    pedals: slots,
    blurb: typeof recipe.blurb === 'string' ? recipe.blurb : 'Recette générée par Gemini.',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Find the best amp + pedal config for a (guitar, amp, song) combo.
 * Tries presets first, then Gemini. Throws if both fail and there's no
 * Gemini key — UI should catch + show a friendly toast.
 */
export async function autoConfig(input: AutoConfigInput): Promise<AutoConfigResult> {
  // Path 1: instant offline preset match
  const presetMatches = findSongPresets(input.song, 1);
  if (presetMatches.length > 0) {
    const preset = presetMatches[0];
    return {
      source: 'preset',
      amp: preset.amp,
      pedals: presetToSlots(preset),
      blurb: `${preset.title} — ${preset.artist}. ${preset.blurb}${preset.guitarNote ? ` (${preset.guitarNote})` : ''}`,
      preset,
    };
  }

  // Path 2: Gemini fallback
  const prompt = buildGeminiPrompt(input);
  const raw = await callGemini(prompt, { responseJson: true, temperature: 0.4 });

  let recipe: GeminiRecipe;
  try {
    recipe = parseGeminiJson<GeminiRecipe>(raw);
  } catch (err) {
    throw new GeminiError(
      `Gemini a répondu, mais le JSON n'est pas valide. Réessaie ou tape le morceau différemment.`,
      undefined,
      err,
    );
  }

  const validated = recipeToResult(recipe);
  return {
    source: 'gemini',
    amp: validated.amp,
    pedals: validated.pedals,
    blurb: validated.blurb,
    rawJson: raw,
  };
}

/** Quickly search the preset list for the autocomplete dropdown. */
export function searchSongPresets(query: string, limit = 5): SongPreset[] {
  return findSongPresets(query, limit);
}
