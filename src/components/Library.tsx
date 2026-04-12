/**
 * Local library — lists tabs stored in IndexedDB.
 *
 * Enhanced features:
 *   - Full text search (title + artist)
 *   - Sort by date added, last opened, title, artist
 *   - Filter by kind (original, cover, generated, my-playing)
 *   - Drag & drop file import
 *   - Favorites section
 *   - Storage usage indicator
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useRef, useState } from 'react';
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

type SortKey = 'addedAt' | 'lastOpenedAt' | 'title' | 'artist';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'addedAt', label: 'Date ajout' },
  { key: 'lastOpenedAt', label: 'Dernier ouvert' },
  { key: 'title', label: 'Titre A–Z' },
  { key: 'artist', label: 'Artiste A–Z' },
];

export function Library({ onTabSelected }: LibraryProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<TabKind | 'all' | 'favorites'>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('addedAt');
  const [dragOver, setDragOver] = useState(false);

  const allTabs = useLiveQuery(() => db.library.toArray());

  // Apply search, filter, and sort.
  const tabs = allTabs
    ?.filter((t) => {
      if (filter === 'favorites') return t.favorite;
      if (filter !== 'all') return t.kind === filter;
      return true;
    })
    .filter((t) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title);
        case 'artist':
          return a.artist.localeCompare(b.artist);
        case 'lastOpenedAt':
          return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0);
        case 'addedAt':
        default:
          return b.addedAt - a.addedAt;
      }
    });

  const handleOpenTab = async (tab: LibraryTab) => {
    if (tab.id != null) await markOpened(tab.id);
    onTabSelected(tab.data, `${tab.artist} – ${tab.title}`);
  };

  const importFiles = useCallback(async (files: FileList | File[]) => {
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
  }, []);

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) await importFiles(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Drag & drop handlers.
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      await importFiles(e.dataTransfer.files);
    }
  };

  // Storage stats.
  const tabCount = allTabs?.length ?? 0;
  const favCount = allTabs?.filter((t) => t.favorite).length ?? 0;

  return (
    <div
      className={`h-full overflow-y-auto p-6 transition-colors ${
        dragOver ? 'bg-amp-accent/10 ring-2 ring-amp-accent ring-inset' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div>
          <h2 className="text-2xl font-bold">Bibliothèque</h2>
          <p className="text-xs text-amp-muted mt-0.5">
            {tabCount} tab{tabCount !== 1 ? 's' : ''} · {favCount} favori{favCount !== 1 ? 's' : ''}
          </p>
        </div>
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

      {/* Search bar */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher titre, artiste ou tag..."
        className="w-full bg-amp-panel border border-amp-border rounded px-4 py-2 text-amp-text placeholder-amp-muted focus:outline-none focus:border-amp-accent mb-4"
      />

      {/* Filters + Sort */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {(
          ['all', 'favorites', 'original', 'cover', 'generated', 'my-playing'] as const
        ).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1 rounded text-sm transition-colors ${
              filter === k
                ? 'bg-amp-accent text-amp-bg'
                : 'bg-amp-panel-2 text-amp-text hover:bg-amp-border'
            }`}
          >
            {k === 'all'
              ? 'Tout'
              : k === 'favorites'
                ? '⭐ Favoris'
                : KIND_LABELS[k]}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs text-amp-muted">Tri:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="bg-amp-panel border border-amp-border rounded px-2 py-1 text-amp-text text-xs focus:outline-none focus:border-amp-accent"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Drag & drop hint */}
      {dragOver && (
        <div className="mb-4 p-4 border-2 border-dashed border-amp-accent rounded-lg text-center text-amp-accent text-sm">
          Lâche ici pour importer
        </div>
      )}

      {/* Tab list */}
      {!tabs ? (
        <p className="text-amp-muted">Chargement...</p>
      ) : tabs.length === 0 ? (
        <div className="text-center py-12 text-amp-muted">
          <p className="mb-2">
            {search ? `Aucun résultat pour "${search}".` : 'Aucune tab dans ta bibliothèque.'}
          </p>
          <p className="text-sm">
            Cherche dans Songsterr, importe un fichier .gp, ou glisse-dépose ici.
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
                className="text-xl flex-shrink-0"
                aria-label={tab.favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
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
                  {tab.tags.length > 0 && (
                    <span className="ml-1 text-amp-accent">
                      {tab.tags.map((t) => `#${t}`).join(' ')}
                    </span>
                  )}
                </div>
                {tab.lastOpenedAt && (
                  <div className="text-xs text-amp-muted mt-0.5">
                    Ouvert {new Date(tab.lastOpenedAt).toLocaleDateString('fr-FR')}
                  </div>
                )}
              </button>
              <button
                onClick={() => tab.id != null && deleteTab(tab.id)}
                className="text-amp-muted hover:text-amp-error transition-colors flex-shrink-0"
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
