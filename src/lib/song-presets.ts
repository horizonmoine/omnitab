/**
 * Curated song → tone presets.
 *
 * The auto-config feature does a lookup in this list FIRST (instant,
 * offline, free) and falls back to the Gemini API only when no preset
 * matches. The data here is hand-curated for accuracy on famous songs.
 *
 * What's a "preset"?
 *   - Amp settings (drive, EQ, master, voicing)
 *   - List of pedal kinds to engage + their key knob settings
 *   - Notes on guitar / pickup position used on the original recording
 *
 * Matching: case-insensitive, accent-insensitive substring against title
 * AND artist. "smoke water" or "Deep Purple" both find Smoke on the Water.
 */

import type { AmpSimParams } from './audio-engine';
import type { PedalKind, PedalParams } from './pedals';

/** Recommended pedal in a preset — kind + the params we want different from defaults. */
export interface PresetPedal {
  kind: PedalKind;
  /** Partial knob overrides; leave a key out to keep its default. */
  params: PedalParams;
}

export interface SongPreset {
  /** Display title — used for matching. */
  title: string;
  artist: string;
  /** Short note shown to the user — what kind of tone this gives. */
  blurb: string;
  /** Suggested guitar / pickup combo. Optional. */
  guitarNote?: string;
  /** Amp settings. */
  amp: AmpSimParams;
  /** Pedals to engage in canonical order. */
  pedals: PresetPedal[];
}

export const SONG_PRESETS: SongPreset[] = [
  // ── Classic Rock ──────────────────────────────────────────────────
  {
    title: 'Smoke on the Water',
    artist: 'Deep Purple',
    blurb: 'Crunch Marshall, riff power chord typique 70s.',
    guitarNote: 'Strat ou Les Paul, micro manche pour le riff.',
    amp: { drive: 6, bass: 4, mid: 5, treble: 4, master: 0.6, voicing: 'crunch' },
    pedals: [],
  },
  {
    title: 'Sweet Child O\' Mine',
    artist: 'Guns N\' Roses',
    blurb: 'Les Paul + Marshall cranked, intro clair-crunch puis solo lead.',
    guitarNote: 'Les Paul, micro manche (intro), micro chevalet (solo).',
    amp: { drive: 7, bass: 4, mid: 6, treble: 5, master: 0.55, voicing: 'crunch' },
    pedals: [{ kind: 'overdrive', params: { drive: 6, tone: 5, level: 5 } }],
  },
  {
    title: 'Back in Black',
    artist: 'AC/DC',
    blurb: 'SG/Plexi crunch — ni pédale ni lead, juste le grain de l\'ampli.',
    guitarNote: 'Gibson SG ou Les Paul, micro chevalet.',
    amp: { drive: 5, bass: 5, mid: 6, treble: 5, master: 0.55, voicing: 'crunch' },
    pedals: [],
  },
  {
    title: 'Stairway to Heaven',
    artist: 'Led Zeppelin',
    blurb: 'Clean arpèges intro, OD progressif vers le solo.',
    guitarNote: 'Les Paul, double-pan vers le solo.',
    amp: { drive: 4, bass: 3, mid: 5, treble: 5, master: 0.5, voicing: 'clean' },
    pedals: [],
  },
  {
    title: 'Whole Lotta Love',
    artist: 'Led Zeppelin',
    blurb: 'Riff fuzzy + amp cranked.',
    guitarNote: 'Les Paul, micro chevalet.',
    amp: { drive: 7, bass: 4, mid: 7, treble: 5, master: 0.5, voicing: 'crunch' },
    pedals: [{ kind: 'fuzz', params: { sustain: 6, tone: 5, volume: 5 } }],
  },

  // ── Blues ─────────────────────────────────────────────────────────
  {
    title: 'Pride and Joy',
    artist: 'Stevie Ray Vaughan',
    blurb: 'Strat + Tube Screamer dans un Fender — gain stacking blues.',
    guitarNote: 'Strat micro manche, cordes 0.013.',
    amp: { drive: 5, bass: 4, mid: 6, treble: 6, master: 0.6, voicing: 'crunch' },
    pedals: [{ kind: 'overdrive', params: { drive: 4, tone: 6, level: 7 } }],
  },
  {
    title: 'The Thrill is Gone',
    artist: 'B.B. King',
    blurb: 'Clean expressif, légère reverb, jeu sur le bend.',
    guitarNote: 'ES-335, micro manche.',
    amp: { drive: 3, bass: 3, mid: 6, treble: 5, master: 0.55, voicing: 'clean' },
    pedals: [{ kind: 'reverb', params: { time: 4, mix: 0.25 } }],
  },
  {
    title: 'Sunshine of Your Love',
    artist: 'Cream',
    blurb: 'Crunch SG + wah, riff iconique.',
    guitarNote: 'Gibson SG, micro chevalet.',
    amp: { drive: 6, bass: 5, mid: 6, treble: 5, master: 0.55, voicing: 'crunch' },
    pedals: [{ kind: 'wah', params: { rate: 1.5, depth: 0.6, q: 6 } }],
  },

  // ── Funk / Wah ────────────────────────────────────────────────────
  {
    title: 'Voodoo Child (Slight Return)',
    artist: 'Jimi Hendrix',
    blurb: 'Wah agressif + Fuzz Face + Marshall, signature Hendrix.',
    guitarNote: 'Strat, micro chevalet, en intro grattage funk.',
    amp: { drive: 7, bass: 4, mid: 6, treble: 5, master: 0.55, voicing: 'crunch' },
    pedals: [
      { kind: 'wah', params: { rate: 2.5, depth: 0.7, q: 7 } },
      { kind: 'fuzz', params: { sustain: 7, tone: 6, volume: 5 } },
    ],
  },
  {
    title: 'Higher Ground',
    artist: 'Red Hot Chili Peppers',
    blurb: 'Funk slap + Strat + light overdrive + chorus subtil.',
    guitarNote: 'Strat micro manche + chevalet (position 2/4).',
    amp: { drive: 4, bass: 4, mid: 7, treble: 5, master: 0.55, voicing: 'crunch' },
    pedals: [
      { kind: 'compressor', params: { threshold: -20, ratio: 4, makeup: 6 } },
      { kind: 'wah', params: { rate: 3, depth: 0.5, q: 5 } },
    ],
  },
  {
    title: 'Superstition',
    artist: 'Stevie Wonder (riff guitar adapté)',
    blurb: 'Funk clavinet → guitar. Wah constant + clean.',
    amp: { drive: 2, bass: 3, mid: 6, treble: 5, master: 0.5, voicing: 'clean' },
    pedals: [
      { kind: 'compressor', params: { threshold: -22, ratio: 5, makeup: 6 } },
      { kind: 'wah', params: { rate: 2, depth: 0.6, q: 6 } },
    ],
  },

  // ── Grunge / Alt ──────────────────────────────────────────────────
  {
    title: 'Smells Like Teen Spirit',
    artist: 'Nirvana',
    blurb: 'Clean intro chorus, distortion massive sur les couplets.',
    guitarNote: 'Jaguar/Mustang, intro micro manche, refrain bridge.',
    amp: { drive: 8, bass: 5, mid: 4, treble: 6, master: 0.5, voicing: 'lead' },
    pedals: [
      { kind: 'distortion', params: { distortion: 7, tone: 6, level: 6 } },
      { kind: 'chorus', params: { rate: 1.2, depth: 0.4, mix: 0.4 } },
    ],
  },
  {
    title: 'Black Hole Sun',
    artist: 'Soundgarden',
    blurb: 'Clean ondulé (chorus + tremolo light) puis disto saturée.',
    amp: { drive: 6, bass: 5, mid: 5, treble: 5, master: 0.55, voicing: 'crunch' },
    pedals: [{ kind: 'chorus', params: { rate: 0.8, depth: 0.6, mix: 0.5 } }],
  },
  {
    title: 'Today',
    artist: 'The Smashing Pumpkins',
    blurb: 'Big Muff fuzz massif + Strat.',
    guitarNote: 'Strat ou Eric Clapton sig, micro manche.',
    amp: { drive: 6, bass: 6, mid: 4, treble: 5, master: 0.5, voicing: 'lead' },
    pedals: [{ kind: 'fuzz', params: { sustain: 8, tone: 4, volume: 6 } }],
  },

  // ── Metal ─────────────────────────────────────────────────────────
  {
    title: 'Master of Puppets',
    artist: 'Metallica',
    blurb: 'Chug palm-mute high-gain Mesa, scoop des mids.',
    guitarNote: 'ESP/LTD, micro chevalet, downpicking.',
    amp: { drive: 9, bass: 7, mid: 2, treble: 7, master: 0.45, voicing: 'lead' },
    pedals: [
      { kind: 'overdrive', params: { drive: 3, tone: 6, level: 7 } }, // tighten the low end
      { kind: 'distortion', params: { distortion: 7, tone: 7, level: 6 } },
    ],
  },
  {
    title: 'Enter Sandman',
    artist: 'Metallica',
    blurb: 'Intro clean → riff lead Mesa.',
    amp: { drive: 8, bass: 6, mid: 3, treble: 6, master: 0.5, voicing: 'lead' },
    pedals: [{ kind: 'overdrive', params: { drive: 3, tone: 6, level: 7 } }],
  },
  {
    title: 'Crazy Train',
    artist: 'Ozzy Osbourne (Randy Rhoads)',
    blurb: 'Marshall cranked + Strat avec hot rails.',
    amp: { drive: 8, bass: 5, mid: 7, treble: 6, master: 0.55, voicing: 'lead' },
    pedals: [{ kind: 'overdrive', params: { drive: 4, tone: 6, level: 7 } }],
  },

  // ── Indie / Modern ────────────────────────────────────────────────
  {
    title: 'Wonderwall',
    artist: 'Oasis',
    blurb: 'Clean arpèges, capodastre 2e case, juste un soupçon de reverb.',
    guitarNote: 'Acoustique ou Epiphone Casino (clean).',
    amp: { drive: 2, bass: 4, mid: 5, treble: 5, master: 0.5, voicing: 'clean' },
    pedals: [{ kind: 'reverb', params: { time: 3, mix: 0.2 } }],
  },
  {
    title: 'Seven Nation Army',
    artist: 'The White Stripes',
    blurb: 'Riff bass-like via Whammy octaver — on simule avec disto + low end.',
    amp: { drive: 5, bass: 8, mid: 5, treble: 4, master: 0.55, voicing: 'crunch' },
    pedals: [{ kind: 'distortion', params: { distortion: 5, tone: 4, level: 6 } }],
  },
  {
    title: 'Where the Streets Have No Name',
    artist: 'U2 (The Edge)',
    blurb: 'Clean + delay dotted-eighth (signature The Edge).',
    guitarNote: 'Strat ou Explorer, micro manche.',
    amp: { drive: 3, bass: 3, mid: 5, treble: 6, master: 0.5, voicing: 'clean' },
    pedals: [{ kind: 'delay', params: { time: 380, feedback: 4, mix: 0.5 } }],
  },
  {
    title: 'Plug In Baby',
    artist: 'Muse',
    blurb: 'Riff disto agressif + fuzz épisodique.',
    amp: { drive: 8, bass: 5, mid: 6, treble: 6, master: 0.5, voicing: 'lead' },
    pedals: [{ kind: 'distortion', params: { distortion: 7, tone: 6, level: 6 } }],
  },

  // ── Ambient / Atmospheric ─────────────────────────────────────────
  {
    title: 'Comfortably Numb',
    artist: 'Pink Floyd',
    blurb: 'Lead chantant — gain modéré, beaucoup de delay et reverb.',
    guitarNote: 'Strat, micro chevalet, bend infini.',
    amp: { drive: 6, bass: 4, mid: 6, treble: 5, master: 0.55, voicing: 'crunch' },
    pedals: [
      { kind: 'compressor', params: { threshold: -18, ratio: 3, makeup: 5 } },
      { kind: 'overdrive', params: { drive: 5, tone: 5, level: 6 } },
      { kind: 'delay', params: { time: 440, feedback: 5, mix: 0.4 } },
      { kind: 'reverb', params: { time: 7, mix: 0.3 } },
    ],
  },
  {
    title: 'Time',
    artist: 'Pink Floyd',
    blurb: 'Lead vibrant — delay long et reverb pour l\'ampleur.',
    amp: { drive: 6, bass: 4, mid: 6, treble: 5, master: 0.55, voicing: 'crunch' },
    pedals: [
      { kind: 'overdrive', params: { drive: 5, tone: 5, level: 6 } },
      { kind: 'delay', params: { time: 510, feedback: 5, mix: 0.4 } },
      { kind: 'reverb', params: { time: 7, mix: 0.3 } },
    ],
  },

  // ── Clean / Jazz ──────────────────────────────────────────────────
  {
    title: 'Hotel California',
    artist: 'Eagles',
    blurb: 'Arpèges clean + chorus discret + delai léger.',
    amp: { drive: 3, bass: 4, mid: 5, treble: 5, master: 0.5, voicing: 'clean' },
    pedals: [
      { kind: 'chorus', params: { rate: 0.6, depth: 0.3, mix: 0.3 } },
      { kind: 'reverb', params: { time: 3, mix: 0.2 } },
    ],
  },
  {
    title: 'Autumn Leaves',
    artist: 'Standard jazz',
    blurb: 'ES-335 sur Twin Reverb clean, micro manche, ton arrondi.',
    amp: { drive: 1, bass: 5, mid: 7, treble: 3, master: 0.5, voicing: 'clean' },
    pedals: [{ kind: 'reverb', params: { time: 4, mix: 0.25 } }],
  },

  // ── Country / Twang ───────────────────────────────────────────────
  {
    title: 'Folsom Prison Blues',
    artist: 'Johnny Cash',
    blurb: 'Tele clean + slap-back delay (50 ms).',
    guitarNote: 'Telecaster, micro manche.',
    amp: { drive: 2, bass: 4, mid: 5, treble: 6, master: 0.5, voicing: 'clean' },
    pedals: [
      { kind: 'compressor', params: { threshold: -20, ratio: 4, makeup: 5 } },
      { kind: 'delay', params: { time: 80, feedback: 1, mix: 0.3 } },
    ],
  },
];

// ─── Lookup helpers ───────────────────────────────────────────────────────

/**
 * Search the preset list for a song. Matches title OR artist (substring,
 * case- and accent-insensitive). Returns up to 5 best matches.
 */
export function findSongPresets(query: string, limit = 5): SongPreset[] {
  const q = query.trim();
  if (!q) return [];
  const normalize = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nq = normalize(q);

  const scored = SONG_PRESETS.map((p) => {
    const titleN = normalize(p.title);
    const artistN = normalize(p.artist);
    let score = 0;
    if (titleN === nq) score += 100;
    else if (titleN.startsWith(nq)) score += 50;
    else if (titleN.includes(nq)) score += 20;
    if (artistN === nq) score += 80;
    else if (artistN.startsWith(nq)) score += 40;
    else if (artistN.includes(nq)) score += 15;
    return { p, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.p);
}
