/**
 * Chord Dictionary — searchable chord diagram library.
 *
 * Uses the tonal library (already in deps) for chord generation and renders
 * SVG fretboard diagrams. Covers major, minor, 7th, maj7, min7, sus2, sus4,
 * dim, aug, add9, and more — all 12 root notes.
 */

import { useState, useMemo } from 'react';
import { Chord, Note } from 'tonal';
import { Button, Card, Input, PageHeader, SectionLabel } from './primitives';

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const QUALITIES = [
  { suffix: 'major', label: 'Majeur', short: '' },
  { suffix: 'minor', label: 'Mineur', short: 'm' },
  { suffix: 'dominant seventh', label: '7', short: '7' },
  { suffix: 'major seventh', label: 'Maj7', short: 'maj7' },
  { suffix: 'minor seventh', label: 'm7', short: 'm7' },
  { suffix: 'suspended second', label: 'sus2', short: 'sus2' },
  { suffix: 'suspended fourth', label: 'sus4', short: 'sus4' },
  { suffix: 'diminished', label: 'dim', short: 'dim' },
  { suffix: 'augmented', label: 'aug', short: 'aug' },
  { suffix: 'minor sixth', label: 'm6', short: 'm6' },
  { suffix: 'sixth', label: '6', short: '6' },
  { suffix: 'ninth', label: '9', short: '9' },
];

// Standard tuning MIDI values: E2 A2 D3 G3 B3 E4
const STANDARD_TUNING = [40, 45, 50, 55, 59, 64];

interface ChordPosition {
  frets: (number | null)[]; // null = muted, 0 = open
  baseFret: number;
  barres: number[];
}

/** Find a playable chord voicing on guitar. */
function findChordPosition(notes: string[]): ChordPosition | null {
  if (notes.length === 0) return null;

  const midiSet = new Set<number>();
  for (const n of notes) {
    const midi = Note.midi(n + '2');
    if (midi != null) {
      // All octaves of this note class
      for (let oct = 0; oct < 6; oct++) {
        midiSet.add((midi % 12) + oct * 12);
      }
    }
  }

  const noteClasses = new Set(notes.map((n) => Note.chroma(n)).filter((c): c is number => c != null));
  if (noteClasses.size === 0) return null;

  // Try positions from fret 0 to fret 4 (open chords + first position).
  for (let baseFret = 0; baseFret <= 4; baseFret++) {
    const frets: (number | null)[] = [];
    let valid = true;

    for (let s = 0; s < 6; s++) {
      const openMidi = STANDARD_TUNING[s];
      let found = false;

      // Check frets within a 4-fret span.
      for (let f = baseFret; f <= baseFret + 4; f++) {
        const midi = openMidi + f;
        if (noteClasses.has(midi % 12)) {
          frets.push(f);
          found = true;
          break;
        }
      }
      if (!found) {
        // Check open string.
        if (noteClasses.has(openMidi % 12)) {
          frets.push(0);
        } else {
          frets.push(null); // Muted
        }
      }
    }

    // Need at least 4 strings played.
    const played = frets.filter((f) => f !== null).length;
    if (played >= 4) {
      // Detect barres.
      const barres: number[] = [];
      const minFret = Math.min(...frets.filter((f): f is number => f != null && f > 0), 99);
      if (minFret < 99) {
        const count = frets.filter((f) => f === minFret).length;
        if (count >= 2) barres.push(minFret);
      }

      return { frets, baseFret: baseFret > 0 ? baseFret : 1, barres };
    }
  }

  return null;
}

/** Render a chord diagram as SVG. */
function ChordDiagram({
  name,
  position,
}: {
  name: string;
  position: ChordPosition | null;
}) {
  const w = 120;
  const h = 160;
  const padTop = 30;
  const padLeft = 25;
  const stringSpacing = 16;
  const fretSpacing = 25;
  const numFrets = 5;
  const numStrings = 6;

  if (!position) {
    return (
      <Card padding="p-3" className="text-center">
        <div className="font-bold text-amp-text mb-1">{name}</div>
        <div className="text-xs text-amp-muted">Pas de position trouvée</div>
      </Card>
    );
  }

  return (
    <Card padding="p-3" interactive className="flex flex-col items-center">
      <div className="font-bold text-amp-text mb-1 text-sm">{name}</div>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {/* Nut or position indicator */}
        {position.baseFret <= 1 ? (
          <rect
            x={padLeft - 1}
            y={padTop - 3}
            width={stringSpacing * (numStrings - 1) + 2}
            height={4}
            fill="#e5e5e5"
          />
        ) : (
          <text
            x={padLeft - 15}
            y={padTop + fretSpacing / 2 + 4}
            fontSize="10"
            fill="#737373"
            textAnchor="middle"
          >
            {position.baseFret}
          </text>
        )}

        {/* Fret lines */}
        {Array.from({ length: numFrets + 1 }, (_, i) => (
          <line
            key={`fret-${i}`}
            x1={padLeft}
            y1={padTop + i * fretSpacing}
            x2={padLeft + (numStrings - 1) * stringSpacing}
            y2={padTop + i * fretSpacing}
            stroke="#525252"
            strokeWidth={i === 0 ? 2 : 1}
          />
        ))}

        {/* String lines */}
        {Array.from({ length: numStrings }, (_, i) => (
          <line
            key={`str-${i}`}
            x1={padLeft + i * stringSpacing}
            y1={padTop}
            x2={padLeft + i * stringSpacing}
            y2={padTop + numFrets * fretSpacing}
            stroke="#9ca3af"
            strokeWidth={1}
          />
        ))}

        {/* Finger positions + muted/open markers */}
        {position.frets.map((fret, s) => {
          const x = padLeft + s * stringSpacing;
          if (fret === null) {
            // Muted
            return (
              <text
                key={s}
                x={x}
                y={padTop - 8}
                fontSize="12"
                fill="#737373"
                textAnchor="middle"
              >
                ×
              </text>
            );
          }
          if (fret === 0) {
            // Open
            return (
              <circle
                key={s}
                cx={x}
                cy={padTop - 10}
                r={5}
                fill="none"
                stroke="#737373"
                strokeWidth={1.5}
              />
            );
          }
          // Fingered
          const displayFret = fret - (position.baseFret <= 1 ? 0 : position.baseFret - 1);
          const y = padTop + (displayFret - 0.5) * fretSpacing;
          return (
            <circle
              key={s}
              cx={x}
              cy={y}
              r={6}
              fill="#f59e0b"
              stroke="#b45309"
              strokeWidth={1}
            />
          );
        })}
      </svg>
    </Card>
  );
}

export function ChordLibrary() {
  const [root, setRoot] = useState('C');
  const [search, setSearch] = useState('');

  // Generate chord data.
  const chords = useMemo(() => {
    const results: Array<{
      name: string;
      notes: string[];
      position: ChordPosition | null;
    }> = [];

    const rootsToShow = search
      ? ROOTS.filter((r) => r.toLowerCase().includes(search.toLowerCase()))
      : [root];

    for (const r of rootsToShow) {
      for (const q of QUALITIES) {
        const chordName = `${r}${q.short}`;
        const chord = Chord.get(chordName);
        if (chord.empty) continue;
        const notes = chord.notes;
        const position = findChordPosition(notes);
        results.push({ name: chordName, notes, position });
      }
    }
    return results;
  }, [root, search]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="Dictionnaire d'accords"
        subtitle="Diagrammes de position pour guitare en accordage standard."
      />

      {/* Search bar */}
      <Input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher (ex: Am7, Dm, G)..."
        className="w-full max-w-xl mb-4"
        aria-label="Rechercher un accord"
      />

      {/* Root selector (when not searching) — chip grid keyed off the design's
          'Fondamentale' SectionLabel pattern. */}
      {!search && (
        <div className="mb-6">
          <SectionLabel>Fondamentale</SectionLabel>
          <div className="flex gap-1 flex-wrap">
            {ROOTS.map((r) => (
              <Button
                key={r}
                variant={root === r ? 'chipOn' : 'chip'}
                onClick={() => setRoot(r)}
                className="w-10 text-center font-bold"
                aria-pressed={root === r}
              >
                {r}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Chord grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {chords.map((c) => (
          <ChordDiagram key={c.name} name={c.name} position={c.position} />
        ))}
      </div>

      {/* Empty-state — muted paragraph, not an error (matches TabSearch). */}
      {chords.length === 0 && (
        <p className="text-amp-muted text-sm text-center py-8">
          Aucun accord trouvé pour "{search}".
        </p>
      )}
    </div>
  );
}
