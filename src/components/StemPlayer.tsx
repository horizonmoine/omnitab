/**
 * Offline stem player — plays back Demucs-separated stems with per-track
 * volume control. Think of it as a mini mixing console: mute/solo each stem
 * to isolate exactly what you want to hear or practice along with.
 *
 * Stems are stored in IndexedDB (see db.ts) and playable without network.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  getAllStems,
  deleteStem,
  deleteStemsForSong,
  type SavedStem,
  type StemType,
} from '../lib/db';

const STEM_LABELS: Record<StemType, { icon: string; label: string }> = {
  vocals: { icon: '🎤', label: 'Voix' },
  guitar: { icon: '🎸', label: 'Guitare' },
  bass: { icon: '🎸', label: 'Basse' },
  drums: { icon: '🥁', label: 'Batterie' },
  other: { icon: '🎹', label: 'Autre' },
};

export function StemPlayer() {
  const stems = useLiveQuery(getAllStems);

  // Group stems by song title.
  const grouped = useMemo(() => {
    if (!stems) return new Map<string, SavedStem[]>();
    const map = new Map<string, SavedStem[]>();
    for (const s of stems) {
      const arr = map.get(s.songTitle) ?? [];
      arr.push(s);
      map.set(s.songTitle, arr);
    }
    return map;
  }, [stems]);

  if (!stems) {
    return <p className="text-amp-muted p-6">Chargement...</p>;
  }

  if (stems.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center">
        <div className="text-6xl mb-4">🎚️</div>
        <h2 className="text-2xl font-bold mb-2">Aucun stem sauvegardé</h2>
        <p className="text-amp-muted text-sm max-w-sm">
          Sépare les pistes d'une chanson via le module Transcrire, puis
          sauvegarde les stems pour les écouter hors-ligne.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-2">Mes Stems (hors-ligne)</h2>
      <p className="text-amp-muted text-sm mb-6">
        Pistes séparées par Demucs — mute/solo pour pratiquer.
      </p>

      <div className="space-y-6">
        {[...grouped.entries()].map(([title, songStems]) => (
          <SongStemGroup
            key={title}
            title={title}
            stems={songStems}
            onDeleteAll={() => deleteStemsForSong(title)}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Song group with mixer-style controls ──────────────────────────

interface SongStemGroupProps {
  title: string;
  stems: SavedStem[];
  onDeleteAll: () => void;
}

function SongStemGroup({ title, stems, onDeleteAll }: SongStemGroupProps) {
  const [playing, setPlaying] = useState(false);
  const [soloed, setSoloed] = useState<StemType | null>(null);
  const [muted, setMuted] = useState<Set<StemType>>(new Set());
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
  const urlsRef = useRef<Map<string, string>>(new Map());

  // Create object URLs for each stem blob (revoke on cleanup).
  useEffect(() => {
    const urls = new Map<string, string>();
    for (const s of stems) {
      const url = URL.createObjectURL(s.blob);
      urls.set(s.stemType, url);
    }
    urlsRef.current = urls;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
    };
  }, [stems]);

  const playAll = () => {
    for (const el of audioRefs.current.values()) {
      el.currentTime = 0;
      el.play().catch(() => {});
    }
    setPlaying(true);
  };

  const stopAll = () => {
    for (const el of audioRefs.current.values()) {
      el.pause();
      el.currentTime = 0;
    }
    setPlaying(false);
  };

  const toggleMute = (type: StemType) => {
    setMuted((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
    // Clear solo if muting the soloed track.
    if (soloed === type) setSoloed(null);
  };

  const toggleSolo = (type: StemType) => {
    setSoloed((prev) => (prev === type ? null : type));
    setMuted(new Set()); // Clear mutes when soloing.
  };

  // Apply volume/mute/solo to audio elements.
  useEffect(() => {
    for (const [type, el] of audioRefs.current.entries()) {
      const isMuted =
        muted.has(type as StemType) ||
        (soloed !== null && soloed !== type);
      el.volume = isMuted ? 0 : (volumes[type] ?? 0.8);
    }
  }, [muted, soloed, volumes]);

  const setRef = (type: string, el: HTMLAudioElement | null) => {
    if (el) {
      audioRefs.current.set(type, el);
      el.onended = () => setPlaying(false);
    } else {
      audioRefs.current.delete(type);
    }
  };

  return (
    <div className="bg-amp-panel border border-amp-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-amp-panel-2 border-b border-amp-border">
        <h3 className="font-bold truncate">{title}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={playing ? stopAll : playAll}
            className={`px-4 py-1.5 rounded text-sm font-bold transition-colors ${
              playing
                ? 'bg-amp-error hover:bg-red-600 text-white'
                : 'bg-amp-accent hover:bg-amp-accent-hover text-amp-bg'
            }`}
          >
            {playing ? '⏹ Stop' : '▶ Play'}
          </button>
          <button
            onClick={onDeleteAll}
            className="text-amp-muted hover:text-amp-error text-sm transition-colors"
            aria-label="Supprimer tous les stems"
          >
            🗑️
          </button>
        </div>
      </div>

      {/* Mixer channels */}
      <div className="p-4 space-y-3">
        {stems.map((stem) => {
          const { icon, label } = STEM_LABELS[stem.stemType] ?? {
            icon: '🎵',
            label: stem.stemType,
          };
          const isMuted =
            muted.has(stem.stemType) ||
            (soloed !== null && soloed !== stem.stemType);
          const isSoloed = soloed === stem.stemType;

          return (
            <div key={stem.stemType} className="flex items-center gap-3">
              {/* Hidden audio element */}
              <audio
                ref={(el) => setRef(stem.stemType, el)}
                src={urlsRef.current.get(stem.stemType) ?? ''}
                preload="auto"
              />

              {/* Icon + label */}
              <span className="text-lg w-6 text-center" aria-hidden="true">
                {icon}
              </span>
              <span
                className={`w-20 text-sm truncate ${isMuted ? 'text-amp-muted line-through' : 'text-amp-text'}`}
              >
                {label}
              </span>

              {/* Mute button */}
              <button
                onClick={() => toggleMute(stem.stemType)}
                className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
                  muted.has(stem.stemType)
                    ? 'bg-amp-error text-white'
                    : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
                }`}
              >
                M
              </button>

              {/* Solo button */}
              <button
                onClick={() => toggleSolo(stem.stemType)}
                className={`px-2 py-0.5 rounded text-xs font-bold transition-colors ${
                  isSoloed
                    ? 'bg-amp-accent text-amp-bg'
                    : 'bg-amp-panel-2 text-amp-muted hover:text-amp-text'
                }`}
              >
                S
              </button>

              {/* Volume slider */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volumes[stem.stemType] ?? 0.8}
                onChange={(e) =>
                  setVolumes((v) => ({
                    ...v,
                    [stem.stemType]: Number(e.target.value),
                  }))
                }
                className="flex-1 accent-amp-accent"
              />

              {/* Delete single stem */}
              <button
                onClick={() => stem.id != null && deleteStem(stem.id)}
                className="text-amp-muted hover:text-amp-error text-xs transition-colors"
                aria-label={`Supprimer ${label}`}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
