/**
 * Backing Track Generator — looping chord progressions with Web Audio.
 *
 * Plays common chord progressions in a loop using OscillatorNode stacks.
 * Each chord is rendered as 4-6 simultaneous sine/triangle oscillators
 * to approximate a keyboard pad / clean guitar voicing.
 *
 * Features:
 *   - Preset progressions (I-IV-V-I, I-V-vi-IV, ii-V-I, 12-bar blues…)
 *   - Custom progression builder
 *   - Key selector (12 keys × major/minor)
 *   - BPM control + beats per chord
 *   - Chord quality display
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chord, Note, Progression } from 'tonal';
import { getAudioContext, resumeAudioContext } from '../lib/audio-engine';

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

interface PresetProgression {
  name: string;
  numerals: string[];
  description: string;
}

const PRESETS: PresetProgression[] = [
  { name: 'Pop (I–V–vi–IV)', numerals: ['I', 'V', 'vi', 'IVMaj7'], description: 'La plus populaire au monde' },
  { name: 'Rock (I–IV–V–I)', numerals: ['I', 'IV', 'V', 'I'], description: 'Base du rock & country' },
  { name: 'Jazz ii–V–I', numerals: ['IIm7', 'V7', 'IMaj7', 'IMaj7'], description: 'Cadence jazz classique' },
  { name: '12-bar Blues', numerals: ['I7', 'I7', 'I7', 'I7', 'IV7', 'IV7', 'I7', 'I7', 'V7', 'IV7', 'I7', 'V7'], description: 'Structure blues standard' },
  { name: 'Mineur mélancolique', numerals: ['i', 'VI', 'III', 'VII'], description: 'Boucle mineure (i–VI–III–VII)' },
  { name: 'Canon de Pachelbel', numerals: ['I', 'V', 'vi', 'iii', 'IV', 'I', 'IV', 'V'], description: 'I–V–vi–iii–IV–I–IV–V' },
  { name: 'Andalouse', numerals: ['i', 'VII', 'VI', 'V'], description: 'Flamenco / métal (Am–G–F–E)' },
  { name: 'Soul / R&B', numerals: ['IIm7', 'V7', 'IMaj7', 'VIm7'], description: 'Progression soul classique' },
];

/** Resolve roman numeral progression to actual chord names in a key. */
function resolveProgression(key: string, numerals: string[]): string[] {
  return Progression.fromRomanNumerals(key, numerals);
}

/** Get playable frequencies for a chord (octave 3 voicing). */
function chordToFrequencies(chordName: string): number[] {
  const chord = Chord.get(chordName);
  if (chord.empty) return [];

  return chord.notes.map((noteName) => {
    const chroma = Note.chroma(noteName);
    if (chroma == null) return 0;
    // Voice in octave 3 (MIDI 48-60 range) for a warm pad sound.
    const midi = 48 + chroma;
    return 440 * Math.pow(2, (midi - 69) / 12);
  }).filter((f) => f > 0);
}

export function BackingTrack() {
  const [key, setKey] = useState('C');
  const [mode, setMode] = useState<'major' | 'minor'>('major');
  const [bpm, setBpm] = useState(120);
  const [beatsPerChord, setBeatsPerChord] = useState(4);
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [customNumerals, setCustomNumerals] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentChordIndex, setCurrentChordIndex] = useState(0);

  const playingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const activeOscRef = useRef<OscillatorNode[]>([]);
  const activeGainRef = useRef<GainNode[]>([]);

  const effectiveKey = mode === 'minor' ? key + 'm' : key;

  const numerals = useCustom
    ? customNumerals.split(/[\s,]+/).filter(Boolean)
    : PRESETS[selectedPreset].numerals;

  const chordNames = resolveProgression(effectiveKey, numerals);

  /** Stop all currently playing oscillators. */
  const stopOscillators = useCallback(() => {
    const now = getAudioContext().currentTime;
    for (const g of activeGainRef.current) {
      try {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(g.gain.value, now);
        g.gain.linearRampToValueAtTime(0, now + 0.05);
      } catch { /* already stopped */ }
    }
    for (const osc of activeOscRef.current) {
      try { osc.stop(now + 0.06); } catch { /* already stopped */ }
    }
    activeOscRef.current = [];
    activeGainRef.current = [];
  }, []);

  /** Play a single chord for a given duration. */
  const playChord = useCallback((chordName: string, startTime: number, duration: number) => {
    const ctx = getAudioContext();
    const freqs = chordToFrequencies(chordName);
    if (freqs.length === 0) return;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, startTime);
    masterGain.gain.linearRampToValueAtTime(0.15, startTime + 0.03);
    masterGain.gain.setValueAtTime(0.15, startTime + duration - 0.08);
    masterGain.gain.linearRampToValueAtTime(0, startTime + duration);
    masterGain.connect(ctx.destination);
    activeGainRef.current.push(masterGain);

    for (const freq of freqs) {
      // Layer sine + triangle for a richer pad sound.
      for (const type of ['sine', 'triangle'] as OscillatorType[]) {
        const osc = ctx.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;

        const noteGain = ctx.createGain();
        noteGain.gain.value = type === 'sine' ? 0.6 : 0.3;

        osc.connect(noteGain);
        noteGain.connect(masterGain);
        osc.start(startTime);
        osc.stop(startTime + duration + 0.1);

        activeOscRef.current.push(osc);
        activeGainRef.current.push(noteGain);
      }
    }
  }, []);

  /** Start the looping playback. */
  const startPlayback = useCallback(async () => {
    await resumeAudioContext();
    playingRef.current = true;
    setIsPlaying(true);

    const ctx = getAudioContext();
    let chordIdx = 0;
    setCurrentChordIndex(0);

    const scheduleNext = () => {
      if (!playingRef.current) return;

      const chordDuration = (60 / bpm) * beatsPerChord;
      const now = ctx.currentTime;

      const chordName = chordNames[chordIdx % chordNames.length];
      playChord(chordName, now, chordDuration);
      setCurrentChordIndex(chordIdx % chordNames.length);

      chordIdx++;

      timerRef.current = window.setTimeout(scheduleNext, chordDuration * 1000 - 50);
    };

    scheduleNext();
  }, [bpm, beatsPerChord, chordNames, playChord]);

  /** Stop playback. */
  const stopPlayback = useCallback(() => {
    playingRef.current = false;
    setIsPlaying(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    stopOscillators();
    setCurrentChordIndex(0);
  }, [stopOscillators]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      playingRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      stopOscillators();
    };
  }, [stopOscillators]);

  // Stop when changing parameters.
  useEffect(() => {
    if (isPlaying) stopPlayback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, mode, bpm, beatsPerChord, selectedPreset, useCustom, customNumerals]);

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-2">Backing Track</h2>
      <p className="text-amp-muted text-sm mb-6">
        Joue des progressions d'accords en boucle pour pratiquer.
      </p>

      {/* Key + Mode */}
      <div className="flex gap-4 mb-4 items-start flex-wrap">
        <div>
          <h3 className="text-xs font-bold text-amp-muted mb-1 uppercase tracking-wide">Tonalité</h3>
          <div className="flex gap-1 flex-wrap">
            {KEYS.map((k) => (
              <button
                key={k}
                onClick={() => setKey(k)}
                className={`w-9 h-9 rounded font-bold text-sm transition-colors ${
                  key === k
                    ? 'bg-amp-accent text-amp-bg'
                    : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
                }`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-bold text-amp-muted mb-1 uppercase tracking-wide">Mode</h3>
          <div className="flex gap-2">
            {(['major', 'minor'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-4 py-2 rounded text-sm transition-colors ${
                  mode === m
                    ? 'bg-amp-accent text-amp-bg font-bold'
                    : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
                }`}
              >
                {m === 'major' ? 'Majeur' : 'Mineur'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* BPM + Beats per chord */}
      <div className="flex gap-6 mb-6 items-end flex-wrap">
        <div>
          <h3 className="text-xs font-bold text-amp-muted mb-1 uppercase tracking-wide">
            BPM: {bpm}
          </h3>
          <input
            type="range"
            min={40}
            max={200}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value))}
            className="w-48 accent-amp-accent"
          />
        </div>
        <div>
          <h3 className="text-xs font-bold text-amp-muted mb-1 uppercase tracking-wide">
            Temps par accord
          </h3>
          <div className="flex gap-1">
            {[2, 4, 8].map((b) => (
              <button
                key={b}
                onClick={() => setBeatsPerChord(b)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  beatsPerChord === b
                    ? 'bg-amp-accent text-amp-bg font-bold'
                    : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
                }`}
              >
                {b}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Preset selector */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h3 className="text-xs font-bold text-amp-muted uppercase tracking-wide">Progression</h3>
          <label className="flex items-center gap-1 text-xs text-amp-muted cursor-pointer">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => setUseCustom(e.target.checked)}
              className="accent-amp-accent"
            />
            Personnalisée
          </label>
        </div>

        {useCustom ? (
          <input
            type="text"
            value={customNumerals}
            onChange={(e) => setCustomNumerals(e.target.value)}
            placeholder="ex: I IV V I  ou  IIm7 V7 IMaj7"
            className="w-full max-w-lg bg-amp-panel border border-amp-border rounded px-4 py-2 text-amp-text placeholder-amp-muted focus:outline-none focus:border-amp-accent"
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl">
            {PRESETS.map((p, i) => (
              <button
                key={i}
                onClick={() => setSelectedPreset(i)}
                className={`text-left p-3 rounded border transition-colors ${
                  selectedPreset === i
                    ? 'bg-amp-accent/10 border-amp-accent'
                    : 'bg-amp-panel border-amp-border hover:border-amp-accent/50'
                }`}
              >
                <div className="font-bold text-sm">{p.name}</div>
                <div className="text-xs text-amp-muted">{p.description}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chord display */}
      <div className="bg-amp-panel border border-amp-border rounded-lg p-6 mb-6">
        <div className="flex gap-3 flex-wrap justify-center">
          {chordNames.map((chord, i) => (
            <div
              key={`${chord}-${i}`}
              className={`px-4 py-3 rounded-lg text-center min-w-[70px] transition-all ${
                isPlaying && currentChordIndex === i
                  ? 'bg-amp-accent text-amp-bg scale-110 shadow-lg shadow-amp-accent/30'
                  : 'bg-amp-panel-2 text-amp-text'
              }`}
            >
              <div className="font-bold text-lg">{chord || '?'}</div>
              <div className="text-[10px] opacity-60 mt-0.5">
                {numerals[i] || ''}
              </div>
            </div>
          ))}
        </div>

        {chordNames.length === 0 && (
          <div className="text-center text-amp-muted text-sm">
            Progression invalide — vérifie les chiffres romains.
          </div>
        )}
      </div>

      {/* Play / Stop */}
      <div className="flex justify-center mb-6">
        <button
          onClick={isPlaying ? stopPlayback : startPlayback}
          disabled={chordNames.length === 0}
          className={`px-10 py-4 rounded-full text-lg font-bold transition-colors disabled:opacity-40 ${
            isPlaying
              ? 'bg-amp-error hover:bg-amp-error/80 text-white'
              : 'bg-amp-accent hover:bg-amp-accent-hover text-amp-bg'
          }`}
        >
          {isPlaying ? '■ Stop' : '▶ Jouer'}
        </button>
      </div>

      {/* Tips */}
      <div className="max-w-2xl text-xs text-amp-muted space-y-1">
        <p><strong>Astuce :</strong> Utilise les chiffres romains pour écrire tes progressions.</p>
        <p>Majuscule = majeur (I, IV), minuscule = mineur (i, vi). Ajoute 7, Maj7, m7 pour les extensions.</p>
      </div>
    </div>
  );
}
