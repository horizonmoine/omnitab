/**
 * Songsterr search UI.
 *
 * Searches the public Songsterr REST endpoint and opens the player page
 * on songsterr.com in a new tab. We used to support downloading the .gp
 * file and opening it in our own viewer, but Songsterr removed that
 * public endpoint in 2024, so this is now a pure outbound link.
 */

import { useState } from 'react';
import { searchSongsterr } from '../lib/songsterr-api';
import type { SongsterrHit } from '../lib/types';

export function TabSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SongsterrHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
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
      setError('Erreur de recherche. Vérifie ta connexion internet.');
    } finally {
      setIsSearching(false);
    }
  };

  /** Open the Songsterr interactive player in a new tab. */
  const openOnSongsterr = (hit: SongsterrHit) => {
    const slug = `${hit.artist.name}-${hit.title}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    window.open(
      `https://www.songsterr.com/a/wsa/${slug}-tab-s${hit.id}`,
      '_blank',
      'noopener',
    );
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
              onClick={() => openOnSongsterr(hit)}
              className="ml-3 bg-amp-panel-2 hover:bg-amp-accent hover:text-amp-bg text-amp-text px-4 py-1.5 rounded text-sm transition-colors"
            >
              Ouvrir
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
