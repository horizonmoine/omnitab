/**
 * Local library — lists tabs stored in IndexedDB.
 *
 * Uses dexie-react-hooks `useLiveQuery` so the list updates automatically
 * when other components add/remove tabs.
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import {
  db,
  toggleFavorite,
  deleteTab,
  markOpened,
  addTabToLibrary,
} from '../lib/db';
import { detectGpFormat } from '../lib/songsterr-api';
import type { LibraryTab, TabKind } from '../lib/types';

interface LibraryProps {
  onTabSelected: (data: ArrayBuffer | string, title: string) => void;
}

const KIND_LABELS: Record<TabKind, string> = {
  original: '🎼 Original',
  cover: '🎵 Cover',
  generated: '🤖 Généré',
  'my-playing': '🎸 Mon jeu',
};

export function Library({ onTabSelected }: LibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<TabKind | 'all'>('all');

  const tabs = useLiveQuery(async () => {
    const all = await db.library.orderBy('addedAt').reverse().toArray();
    return filter === 'all' ? all : all.filter((t) => t.kind === filter);
  }, [filter]);

  const handleOpenTab = async (tab: LibraryTab) => {
    if (tab.id != null) await markOpened(tab.id);
    onTabSelected(tab.data, `${tab.artist} – ${tab.title}`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      const isText = ['xml', 'musicxml', 'tex', 'alphatex'].includes(ext);

      if (isText) {
        const text = await file.text();
        await addTabToLibrary({
          title: file.name.replace(/\.[^.]+$/, ''),
          artist: 'Importé',
          kind: 'original',
          format: ext,
          data: text,
          favorite: false,
          tags: ['imported'],
        });
      } else {
        const buffer = await file.arrayBuffer();
        const format = detectGpFormat(buffer);
        await addTabToLibrary({
          title: file.name.replace(/\.[^.]+$/, ''),
          artist: 'Importé',
          kind: 'original',
          format,
          data: buffer,
          favorite: false,
          tags: ['imported'],
        });
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">Bibliothèque</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          className="bg-amp-panel-2 hover:bg-amp-accent hover:text-amp-bg text-amp-text px-4 py-2 rounded text-sm transition-colors"
        >
          📁 Importer
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.tex"
          multiple
          onChange={handleImport}
          className="hidden"
        />
      </div>

      {/* Kind filter */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {(['all', 'original', 'cover', 'generated', 'my-playing'] as const).map(
          (k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                filter === k
                  ? 'bg-amp-accent text-amp-bg'
                  : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
              }`}
            >
              {k === 'all' ? 'Tout' : KIND_LABELS[k]}
            </button>
          ),
        )}
      </div>

      {!tabs ? (
        <p className="text-amp-muted">Chargement…</p>
      ) : tabs.length === 0 ? (
        <div className="text-center py-12 text-amp-muted">
          <p className="mb-2">Aucune tab dans ta bibliothèque.</p>
          <p className="text-sm">
            Cherche-en une dans Songsterr ou importe un fichier .gp/.gp5.
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {tabs.map((tab) => (
            <li
              key={tab.id}
              className="bg-amp-panel border border-amp-border rounded p-3 flex items-center gap-3 hover:border-amp-accent transition-colors"
            >
              <button
                onClick={() => tab.id != null && toggleFavorite(tab.id)}
                className="text-xl"
                aria-label="Favori"
              >
                {tab.favorite ? '⭐' : '☆'}
              </button>
              <button
                onClick={() => handleOpenTab(tab)}
                className="flex-1 text-left min-w-0"
              >
                <div className="font-semibold truncate">{tab.title}</div>
                <div className="text-sm text-amp-muted truncate">
                  {tab.artist} · {KIND_LABELS[tab.kind]} · .{tab.format}
                </div>
              </button>
              <button
                onClick={() => tab.id != null && deleteTab(tab.id)}
                className="text-amp-muted hover:text-amp-error transition-colors"
                aria-label="Supprimer"
              >
                🗑️
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
