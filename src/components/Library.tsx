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
import { Button, Card, Input, Select } from './primitives';
import { toast } from './Toast';

/** File extensions our library accepts. Binary formats get ArrayBuffer
 *  storage; textual formats get string storage (the db layer handles both). */
const BINARY_EXTENSIONS = new Set(['gp', 'gp3', 'gp4', 'gp5', 'gpx', 'mxl']);
const TEXT_EXTENSIONS = new Set(['xml', 'musicxml', 'tex', 'alphatex']);

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

  // URL import — inline form that expands when the user clicks "🔗 URL".
  const [urlFormOpen, setUrlFormOpen] = useState(false);
  const [urlValue, setUrlValue] = useState('');
  const [urlFetching, setUrlFetching] = useState(false);

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
      const isText = TEXT_EXTENSIONS.has(ext);

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

  /**
   * Fetch a tab file from an arbitrary URL through our Edge proxy, then
   * save it using the same pipeline as file imports. The proxy enforces
   * HTTPS, an extension whitelist, and a 10 MB size cap — see
   * api/fetch-tab.ts for the exact checks.
   */
  const importFromUrl = useCallback(async (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;

    setUrlFetching(true);
    try {
      const res = await fetch(
        `/api/fetch-tab?url=${encodeURIComponent(trimmed)}`,
      );

      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({
          error: `HTTP ${res.status}`,
        }))) as { error?: string };
        throw new Error(error ?? `Échec HTTP ${res.status}`);
      }

      // Derive filename + extension from the upstream URL (not the proxy).
      const urlPath = new URL(trimmed).pathname;
      const filename = urlPath.split('/').pop() ?? 'tab';
      const ext = filename.split('.').pop()?.toLowerCase() ?? '';
      const title = filename.replace(/\.[^.]+$/, '');

      if (TEXT_EXTENSIONS.has(ext)) {
        const text = await res.text();
        await addTabToLibrary({
          title,
          artist: 'URL importée',
          kind: 'original',
          format: ext,
          data: text,
          favorite: false,
          tags: ['imported', 'from-url'],
          sourceUrl: trimmed,
        });
      } else if (BINARY_EXTENSIONS.has(ext)) {
        const buffer = await res.arrayBuffer();
        const format = detectGpFormat(buffer);
        await addTabToLibrary({
          title,
          artist: 'URL importée',
          kind: 'original',
          format,
          data: buffer,
          favorite: false,
          tags: ['imported', 'from-url'],
          sourceUrl: trimmed,
        });
      } else {
        // The proxy should have rejected this, but guard anyway in case
        // someone slips through via query-string extension trickery.
        throw new Error(`Extension non supportée: .${ext}`);
      }

      toast.success(`Importé : ${title}`);
      setUrlValue('');
      setUrlFormOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUrlFetching(false);
    }
  }, []);

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
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold">Bibliothèque</h2>
          <p className="text-xs text-amp-muted mt-0.5">
            {tabCount} tab{tabCount !== 1 ? 's' : ''} · {favCount} favori{favCount !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Importer un fichier"
          >
            <span aria-hidden="true">📁 </span>Importer
          </Button>
          <Button
            variant="secondary"
            onClick={() => setUrlFormOpen((v) => !v)}
            aria-label="Importer depuis une URL"
            aria-expanded={urlFormOpen}
          >
            <span aria-hidden="true">🔗 </span>URL
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gp,.gp3,.gp4,.gp5,.gpx,.xml,.musicxml,.tex"
          multiple
          onChange={handleImport}
          className="hidden"
        />
      </div>

      {/* URL import panel — collapses when closed so it doesn't shove the
          list around. Submit on Enter, Esc to cancel. */}
      {urlFormOpen && (
        <Card className="mb-4 max-w-2xl" padding="p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              importFromUrl(urlValue);
            }}
            className="flex flex-col gap-2"
          >
            <label className="text-xs text-amp-muted" htmlFor="url-input">
              Colle une URL directe vers un fichier .gp / .gp5 / .xml / .tex
              (max 10 Mo). Beaucoup de sites (mysongbook, azpro…) hébergent des
              tabs en libre accès.
            </label>
            <div className="flex gap-2">
              <Input
                id="url-input"
                type="url"
                value={urlValue}
                onChange={(e) => setUrlValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setUrlFormOpen(false);
                    setUrlValue('');
                  }
                }}
                placeholder="https://example.com/song.gp5"
                disabled={urlFetching}
                autoFocus
                className="flex-1 font-mono text-sm disabled:opacity-50"
              />
              <Button
                type="submit"
                disabled={!urlValue.trim() || urlFetching}
                className="px-4 py-2 text-sm whitespace-nowrap"
              >
                {urlFetching ? '⏳…' : 'Importer'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setUrlFormOpen(false);
                  setUrlValue('');
                }}
                disabled={urlFetching}
                className="px-4 py-2 text-sm"
              >
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Search bar */}
      <Input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Rechercher titre, artiste ou tag..."
        className="w-full mb-4"
        aria-label="Rechercher dans la bibliothèque"
      />

      {/* Filters + Sort */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        {(
          ['all', 'favorites', 'original', 'cover', 'generated', 'my-playing'] as const
        ).map((k) => (
          <Button
            key={k}
            variant={filter === k ? 'chipOn' : 'chip'}
            onClick={() => setFilter(k)}
            aria-pressed={filter === k}
          >
            {k === 'all'
              ? 'Tout'
              : k === 'favorites'
                ? '⭐ Favoris'
                : KIND_LABELS[k]}
          </Button>
        ))}

        <div className="ml-auto flex items-center gap-1">
          <span className="text-xs text-amp-muted">Tri:</span>
          <Select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            aria-label="Trier"
            className="px-2 py-1 text-xs"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </Select>
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
        <div role="list" className="space-y-2">
          {tabs.map((tab) => (
            <Card
              key={tab.id}
              role="listitem"
              interactive
              padding="p-3"
              className="flex items-center gap-3"
            >
              {/* Favoris toggle — visibility matters: the empty glyph (☆)
                  inherits text colour, so on the dark panel we nudge it to
                  amp-muted + amber-on-hover so users spot it. The filled
                  glyph (⭐) renders its own built-in yellow regardless of
                  CSS, so we only need to size it up on active state. */}
              <button
                onClick={() => tab.id != null && toggleFavorite(tab.id)}
                className={`text-2xl flex-shrink-0 leading-none transition-transform hover:scale-110 ${
                  tab.favorite
                    ? 'drop-shadow-[0_0_6px_rgba(245,158,11,0.45)]'
                    : 'text-amp-muted hover:text-amp-accent'
                }`}
                title={
                  tab.favorite
                    ? 'Retirer des favoris'
                    : 'Ajouter aux favoris'
                }
                aria-label={
                  tab.favorite
                    ? 'Retirer des favoris'
                    : 'Ajouter aux favoris'
                }
                aria-pressed={tab.favorite}
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
              {/* Source link — shown only for tabs imported from a URL or
                  transcribed from YouTube. `target="_blank"` opens in a new
                  tab; `rel="noopener noreferrer"` is mandatory to prevent
                  the source page from accessing window.opener. */}
              {tab.sourceUrl && (
                <a
                  href={tab.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amp-muted hover:text-amp-accent transition-colors flex-shrink-0 text-lg"
                  aria-label={`Voir la source : ${tab.sourceUrl}`}
                  title={tab.sourceUrl}
                >
                  ↗
                </a>
              )}
              <button
                onClick={() => tab.id != null && deleteTab(tab.id)}
                className="text-amp-muted hover:text-amp-error transition-colors flex-shrink-0"
                aria-label="Supprimer"
              >
                🗑️
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
