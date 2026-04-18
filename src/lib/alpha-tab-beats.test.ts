import { describe, expect, it } from 'vitest';
import { extractBeats } from './alpha-tab-beats';

// Minimal duck-typed fixtures — `extractBeats` walks the AlphaTab shape but
// only reads a handful of fields, so we don't need the full score model.
const beat = (playbackStart: number, midis: number[], isRest = false) => ({
  playbackStart,
  isRest,
  notes: midis.map((m): { realValue: number | undefined } => ({ realValue: m })),
});

const track = (beats: ReturnType<typeof beat>[]) => ({
  staves: [{ bars: [{ voices: [{ beats }] }] }],
});

describe('alpha-tab-beats', () => {
  it('converts playbackStart ms → seconds', () => {
    const result = extractBeats(track([beat(1500, [60])]));
    // toMatchObject ignores the `beatRef` field — its presence is covered
    // by its own dedicated test lower in this file.
    expect(result).toMatchObject([{ timeSeconds: 1.5, midis: [60] }]);
    expect(result).toHaveLength(1);
  });

  it('skips rest beats', () => {
    const result = extractBeats(track([beat(0, [60]), beat(500, [], true)]));
    expect(result).toHaveLength(1);
    expect(result[0].midis).toEqual([60]);
  });

  it('skips beats with no playable notes (empty notes)', () => {
    const result = extractBeats(track([beat(0, []), beat(500, [64])]));
    expect(result).toHaveLength(1);
    expect(result[0].midis).toEqual([64]);
  });

  it('preserves chord midis for a single beat', () => {
    const result = extractBeats(track([beat(0, [60, 64, 67])]));
    expect(result[0].midis).toEqual([60, 64, 67]);
  });

  it('flattens across multiple staves and voices', () => {
    const score = {
      staves: [
        { bars: [{ voices: [{ beats: [beat(0, [60])] }] }] },
        { bars: [{ voices: [{ beats: [beat(500, [64])] }] }] },
      ],
    };
    const result = extractBeats(score);
    expect(result).toHaveLength(2);
  });

  it('sorts the output chronologically', () => {
    // Voice 2 starts earlier than voice 1 — the sort should reorder.
    const score = {
      staves: [
        {
          bars: [
            {
              voices: [
                { beats: [beat(1000, [67])] },
                { beats: [beat(250, [60])] },
              ],
            },
          ],
        },
      ],
    };
    const result = extractBeats(score);
    expect(result.map((b) => b.timeSeconds)).toEqual([0.25, 1]);
  });

  it('returns [] for an empty track', () => {
    expect(extractBeats({})).toEqual([]);
    expect(extractBeats({ staves: [] })).toEqual([]);
    expect(extractBeats({ staves: [{ bars: [] }] })).toEqual([]);
  });

  it('preserves a reference to the source Beat on beatRef', () => {
    // The overlay relies on `beatRef` being the SAME object instance we fed
    // in, so `api.boundsLookup.findBeat(beatRef)` can resolve it.
    const sourceBeat = beat(0, [60]);
    const result = extractBeats(track([sourceBeat]));
    expect(result[0].beatRef).toBe(sourceBeat);
  });

  it('filters out notes with non-numeric realValue', () => {
    const result = extractBeats(
      track([
        {
          playbackStart: 0,
          isRest: false,
          notes: [{ realValue: 60 }, { realValue: undefined }, { realValue: 64 }],
        },
      ]),
    );
    expect(result[0].midis).toEqual([60, 64]);
  });
});
