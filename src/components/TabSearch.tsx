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
import { Button, Card, ErrorStrip, Input, PageHeader } from './primitives';

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
      <PageHeader
        title="Rechercher une tablature"
        subtitle="Plus d'1 million de tabs vérifiées via l'API publique Songsterr."
      />

      <form onSubmit={handleSearch} className="flex gap-2 mb-6">
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ex: Stairway to Heaven, Jeff Buckley Hallelujah…"
          className="flex-1"
        />
        <Button type="submit" disabled={isSearching}>
          {isSearching ? '…' : 'Chercher'}
        </Button>
      </form>

      {error && <div className="mb-4 max-w-none"><ErrorStrip>{error}</ErrorStrip></div>}

      <div className="space-y-2">
        {results.map((hit) => (
          <Card
            key={hit.id}
            interactive
            padding="p-3"
            className="flex items-center justify-between"
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
            <Button
              variant="secondary"
              onClick={() => openOnSongsterr(hit)}
              className="ml-3"
            >
              Ouvrir
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
