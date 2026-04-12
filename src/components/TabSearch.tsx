/**
 * Songsterr search UI.
 *
 * Searches against the public Songsterr REST endpoint, then on click
 * downloads the .gp/.gpx file and stores it in the IndexedDB library.
 */

import { useState } from 'react';
import {
  searchSongsterr,
  resolveTabFileUrl,
  downloadTabFile,
  detectGpFormat,
} from '../lib/songsterr-api';
import { addTabToLibrary } from '../lib/db';
import type { SongsterrHit } from '../lib/types';

interface TabSearchProps {
  onTabLoaded: (data: ArrayBuffer, title: string) => void;
}

export function TabSearch({ onTabLoaded }: TabSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SongsterrHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    try {
      const hits = await searchSongsterr(query);
      setResults(hits);
      if (hits.length === 0) setError('Aucun résultat trouvé.');
    } catch (err) {
      console.error(err);
      setError(
        'Erreur de recherche. Songsterr peut être bloqué par CORS — ' +
          'configure VITE_SONGSTERR_PROXY dans .env.local pour contourner.',
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownload = async (hit: SongsterrHit) => {
    setDownloadingId(hit.id);
    setError(null);
    try {
      const url = await resolveTabFileUrl(hit.id);
      const buffer = await downloadTabFile(url);
      const format = detectGpFormat(buffer);
      await addTabToLibrary({
        title: hit.title,
        artist: hit.artist.name,
        kind: 'original',
        format,
        data: buffer,
        favorite: false,
        tags: [],
      });
      onTabLoaded(buffer, `${hit.artist.name} – ${hit.title}`);
    } catch (err) {
      console.error(err);
      setError(`Échec du téléchargement de "${hit.title}".`);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <h2 className="text-2xl font-bold mb-4">Rechercher une tablature</h2>
      <p className="text-amp-muted mb-6 text-sm">
        Plus d'1 million de tabs vérifiées via l'API publique Songsterr.
      </p>

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ex: Stairway to Heaven, Jeff Buckley Hallelujah…"
          className="flex-1 bg-amp-panel border border-amp-border rounded px-4 py-2 text-amp-text placeholder-amp-muted focus:outline-none focus:border-amp-accent"
        />
        <button
          type="submit"
          disabled={isSearching}
          className="bg-amp-accent hover:bg-amp-accent-hover disabled:bg-amp-muted text-amp-bg font-bold px-6 py-2 rounded transition-colors"
        >
          {isSearching ? '…' : 'Chercher'}
        </button>
      </form>

      {error && (
        <div className="mb-4 p-3 bg-amp-error/20 border border-amp-error rounded text-amp-error text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {results.map((hit) => (
          <div
            key={hit.id}
            className="bg-amp-panel border border-amp-border rounded p-3 flex items-center justify-between hover:border-amp-accent transition-colors"
          >
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-amp-text truncate">
                {hit.title}
              </div>
              <div className="text-sm text-amp-muted truncate">
                {hit.artist.name}
                {hit.tracks && hit.tracks.length > 0 && (
                  <>
                    {' · '}
                    {hit.tracks.map((t) => t.instrument).join(', ')}
                  </>
                )}
              </div>
            </div>
            <button
              onClick={() => handleDownload(hit)}
              disabled={downloadingId === hit.id}
              className="ml-3 bg-amp-panel-2 hover:bg-amp-accent hover:text-amp-bg text-amp-text px-4 py-1.5 rounded text-sm transition-colors disabled:bg-amp-muted disabled:cursor-wait"
            >
              {downloadingId === hit.id ? '⏳' : '📥 Télécharger'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
