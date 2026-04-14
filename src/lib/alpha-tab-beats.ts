/**
 * Walk an AlphaTab `score` object and produce a flat list of `TabBeat`s
 * suitable for tab-healer's diff function.
 *
 * AlphaTab's model is hierarchical:
 *
 *   score
 *     .tracks[i]
 *       .staves[j]
 *         .bars[k]
 *           .voices[v]
 *             .beats[b]
 *               .playbackStart      // ms ticks since song start
 *               .notes[n]
 *                 .realValue        // absolute MIDI pitch
 *
 * For Tab Healer we flatten across staves+voices of a single track, drop
 * rest beats (notes.length === 0), and convert ticks → seconds. AlphaTab
 * uses MIDI ticks at a fixed `score.divisionsPerQuarterNote * tempo` rate;
 * however, beats already expose `playbackStart` in *milliseconds* on
 * AlphaTab ≥1.5, so the conversion is just /1000.
 */

import type { TabBeat } from './tab-healer';

// We type the AlphaTab pieces as `unknown` and narrow at the field access.
// Importing the proper types would force a hard dependency on alphatab in
// every consumer; the duck-typing here keeps this module lazy-friendly.
interface AlphaTabBeat {
  playbackStart?: number; // ms since song start
  isRest?: boolean;
  notes?: Array<{ realValue?: number }>;
}

interface AlphaTabVoice {
  beats?: AlphaTabBeat[];
}

interface AlphaTabBar {
  voices?: AlphaTabVoice[];
}

interface AlphaTabStaff {
  bars?: AlphaTabBar[];
}

interface AlphaTabTrack {
  staves?: AlphaTabStaff[];
}

export function extractBeats(track: AlphaTabTrack): TabBeat[] {
  const out: TabBeat[] = [];
  for (const staff of track.staves ?? []) {
    for (const bar of staff.bars ?? []) {
      for (const voice of bar.voices ?? []) {
        for (const beat of voice.beats ?? []) {
          if (beat.isRest) continue;
          const midis = (beat.notes ?? [])
            .map((n) => n.realValue)
            .filter((m): m is number => typeof m === 'number');
          if (midis.length === 0) continue;
          const t =
            typeof beat.playbackStart === 'number'
              ? beat.playbackStart / 1000
              : 0;
          out.push({ timeSeconds: t, midis });
        }
      }
    }
  }
  // AlphaTab's traversal is generally already chronological, but sort to be safe.
  out.sort((a, b) => a.timeSeconds - b.timeSeconds);
  return out;
}
