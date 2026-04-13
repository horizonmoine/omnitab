/**
 * Scale Library — interactive SVG fretboard with scale patterns.
 *
 * Renders scales on a guitar fretboard diagram. Uses the tonal library
 * for scale/note data. Supports all common scales across 5 positions,
 * with the root note highlighted in orange.
 */

import { useMemo, useState } from 'react';
import { Scale, Note } from 'tonal';

const ROOTS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const SCALES = [
  { id: 'major', label: 'Majeure' },
  { id: 'minor', label: 'Mineure naturelle' },
  { id: 'major pentatonic', label: 'Pentatonique majeure' },
  { id: 'minor pentatonic', label: 'Pentatonique mineure' },
  { id: 'blues', label: 'Blues' },
  { id: 'dorian', label: 'Dorien' },
  { id: 'mixolydian', label: 'Mixolydien' },
  { id: 'harmonic minor', label: 'Mineure harmonique' },
  { id: 'melodic minor', label: 'Mineure mélodique' },
  { id: 'phrygian', label: 'Phrygien' },
  { id: 'lydian', label: 'Lydien' },
  { id: 'locrian', label: 'Locrien' },
  { id: 'whole tone', label: 'Tons entiers' },
  { id: 'diminished', label: 'Diminuée' },
];

// Standard tuning: string 6→1 (low E to high E), MIDI values.
const TUNING = [40, 45, 50, 55, 59, 64];
const STRING_LABELS = ['E', 'A', 'D', 'G', 'B', 'e'];
const NUM_FRETS = 15;

interface FretNote {
  string: number; // 0=low E, 5=high E
  fret: number;
  noteName: string;
  chroma: number;
  isRoot: boolean;
  isInScale: boolean;
}

export function ScaleLibrary() {
  const [root, setRoot] = useState('A');
  const [scaleId, setScaleId] = useState('minor pentatonic');
  const [positionFilter, setPositionFilter] = useState<number | null>(null);
  const [showAllNotes, setShowAllNotes] = useState(false);

  // Compute scale notes.
  const scaleData = useMemo(() => {
    const scale = Scale.get(`${root} ${scaleId}`);
    if (scale.empty) return { notes: [], chromas: new Set<number>(), rootChroma: 0 };
    const chromas = new Set(scale.notes.map((n) => Note.chroma(n)).filter((c): c is number => c != null));
    const rootChroma = Note.chroma(root) ?? 0;
    return { notes: scale.notes, chromas, rootChroma };
  }, [root, scaleId]);

  // Build fretboard data.
  const fretboard = useMemo(() => {
    const notes: FretNote[] = [];
    for (let s = 0; s < 6; s++) {
      for (let f = 0; f <= NUM_FRETS; f++) {
        const midi = TUNING[s] + f;
        const chroma = midi % 12;
        const noteName = Note.fromMidi(midi) ?? '';
        notes.push({
          string: s,
          fret: f,
          noteName: noteName.replace(/\d+/, ''),
          chroma,
          isRoot: chroma === scaleData.rootChroma,
          isInScale: scaleData.chromas.has(chroma),
        });
      }
    }
    return notes;
  }, [scaleData]);

  // Position filtering (group by fret ranges).
  const positions = [
    { label: 'Pos 1', min: 0, max: 4 },
    { label: 'Pos 2', min: 3, max: 7 },
    { label: 'Pos 3', min: 5, max: 9 },
    { label: 'Pos 4', min: 7, max: 11 },
    { label: 'Pos 5', min: 9, max: 13 },
  ];

  const visibleFrets = positionFilter !== null
    ? positions[positionFilter]
    : { min: 0, max: NUM_FRETS };

  // SVG dimensions.
  const fretRange = visibleFrets.max - visibleFrets.min + 1;
  const padLeft = 40;
  const padTop = 30;
  const fretWidth = 50;
  const stringSpacing = 28;
  const svgW = padLeft + fretRange * fretWidth + 20;
  const svgH = padTop + 5 * stringSpacing + 30;

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-2">Gammes</h2>
      <p className="text-amp-muted text-sm mb-6">
        Visualise les gammes sur le manche. Clique sur une position pour isoler un pattern.
      </p>

      {/* Root selector */}
      <div className="flex gap-1 mb-4 flex-wrap">
        {ROOTS.map((r) => (
          <button
            key={r}
            onClick={() => setRoot(r)}
            className={`w-10 h-10 rounded font-bold text-sm transition-colors ${
              root === r
                ? 'bg-amp-accent text-amp-bg'
                : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
            }`}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Scale selector */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {SCALES.map((s) => (
          <button
            key={s.id}
            onClick={() => setScaleId(s.id)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              scaleId === s.id
                ? 'bg-amp-accent text-amp-bg font-bold'
                : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Position selector */}
      <div className="flex gap-2 mb-4 items-center">
        <span className="text-xs text-amp-muted">Position:</span>
        <button
          onClick={() => setPositionFilter(null)}
          className={`px-3 py-1 rounded text-xs transition-colors ${
            positionFilter === null
              ? 'bg-amp-accent text-amp-bg font-bold'
              : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
          }`}
        >
          Tout
        </button>
        {positions.map((p, i) => (
          <button
            key={i}
            onClick={() => setPositionFilter(i)}
            className={`px-3 py-1 rounded text-xs transition-colors ${
              positionFilter === i
                ? 'bg-amp-accent text-amp-bg font-bold'
                : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
            }`}
          >
            {p.label}
          </button>
        ))}
        <label className="flex items-center gap-1 ml-4 text-xs text-amp-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showAllNotes}
            onChange={(e) => setShowAllNotes(e.target.checked)}
            className="accent-amp-accent"
          />
          Afficher toutes les notes
        </label>
      </div>

      {/* Scale info */}
      <div className="mb-4 text-sm text-amp-muted">
        <span className="text-amp-text font-bold">{root} {SCALES.find((s) => s.id === scaleId)?.label}</span>
        {' — '}
        {scaleData.notes.join(' · ')}
      </div>

      {/* SVG Fretboard */}
      <div className="overflow-x-auto bg-amp-panel border border-amp-border rounded-lg p-4">
        <svg width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
          {/* Fret markers (dots) */}
          {[3, 5, 7, 9, 12, 15].map((f) => {
            if (f < visibleFrets.min || f > visibleFrets.max) return null;
            const x = padLeft + (f - visibleFrets.min) * fretWidth - fretWidth / 2;
            const y = padTop + 2.5 * stringSpacing;
            return f === 12 ? (
              <g key={f}>
                <circle cx={x} cy={padTop + 1.5 * stringSpacing} r={4} fill="#2a2a2a" />
                <circle cx={x} cy={padTop + 3.5 * stringSpacing} r={4} fill="#2a2a2a" />
              </g>
            ) : (
              <circle key={f} cx={x} cy={y} r={4} fill="#2a2a2a" />
            );
          })}

          {/* Nut */}
          {visibleFrets.min === 0 && (
            <rect x={padLeft - 2} y={padTop - 2} width={4} height={5 * stringSpacing + 4} fill="#e5e5e5" rx={1} />
          )}

          {/* Fret lines */}
          {Array.from({ length: fretRange + 1 }, (_, i) => {
            const x = padLeft + i * fretWidth;
            return (
              <line
                key={i}
                x1={x} y1={padTop}
                x2={x} y2={padTop + 5 * stringSpacing}
                stroke="#525252" strokeWidth={1}
              />
            );
          })}

          {/* String lines */}
          {Array.from({ length: 6 }, (_, s) => {
            const y = padTop + s * stringSpacing;
            return (
              <g key={s}>
                <line
                  x1={padLeft} y1={y}
                  x2={padLeft + fretRange * fretWidth} y2={y}
                  stroke="#9ca3af" strokeWidth={s < 3 ? 1.5 : 1}
                />
                <text
                  x={padLeft - 15} y={y + 4}
                  fontSize="11" fill="#737373" textAnchor="middle"
                >
                  {STRING_LABELS[s]}
                </text>
              </g>
            );
          })}

          {/* Fret numbers */}
          {Array.from({ length: fretRange }, (_, i) => {
            const fretNum = visibleFrets.min + i + 1;
            if (fretNum > NUM_FRETS) return null;
            const x = padLeft + i * fretWidth + fretWidth / 2;
            return (
              <text
                key={i} x={x} y={padTop + 5 * stringSpacing + 18}
                fontSize="10" fill="#525252" textAnchor="middle"
              >
                {fretNum}
              </text>
            );
          })}

          {/* Scale notes */}
          {fretboard
            .filter((n) => n.fret >= visibleFrets.min && n.fret <= visibleFrets.max)
            .filter((n) => showAllNotes || n.isInScale)
            .map((n) => {
              const fretOffset = n.fret - visibleFrets.min;
              const x = n.fret === 0
                ? padLeft - 10
                : padLeft + fretOffset * fretWidth - fretWidth / 2;
              const y = padTop + n.string * stringSpacing;
              const r = 10;

              if (!n.isInScale) {
                // Ghost note (shown only when showAllNotes is on).
                return (
                  <g key={`${n.string}-${n.fret}`}>
                    <circle cx={x} cy={y} r={6} fill="none" stroke="#2a2a2a" strokeWidth={1} />
                    <text x={x} y={y + 3.5} fontSize="7" fill="#525252" textAnchor="middle">
                      {n.noteName}
                    </text>
                  </g>
                );
              }

              return (
                <g key={`${n.string}-${n.fret}`}>
                  <circle
                    cx={x} cy={y} r={r}
                    fill={n.isRoot ? '#f59e0b' : '#10b981'}
                    stroke={n.isRoot ? '#b45309' : '#059669'}
                    strokeWidth={1.5}
                  />
                  <text
                    x={x} y={y + 4}
                    fontSize="9" fontWeight="bold"
                    fill={n.isRoot ? '#0a0a0a' : '#0a0a0a'}
                    textAnchor="middle"
                  >
                    {n.noteName}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex gap-4 mt-4 text-xs text-amp-muted">
        <div className="flex items-center gap-1">
          <span className="w-4 h-4 rounded-full bg-amp-accent inline-block" />
          Fondamentale
        </div>
        <div className="flex items-center gap-1">
          <span className="w-4 h-4 rounded-full bg-amp-success inline-block" />
          Note de la gamme
        </div>
      </div>
    </div>
  );
}
