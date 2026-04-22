/**
 * Songsterr search UI.
 *
 * Searches the public Songsterr REST endpoint and opens the player page
 * on songsterr.com in a new tab. We used to support downloading the .gp
 * file and opening it in our own viewer, but Songsterr removed that
 * public endpoint in 2024, so this is now a pure outbound link.
 */

import { useState } from 'react';
import { searchSongsterr, detectGpFormat } from '../lib/songsterr-api';
import type { SongsterrHit } from '../lib/types';
import { Button, Card, ErrorStrip, Input, PageHeader } from './primitives';
import { addTabToLibrary } from '../lib/db';
import { toast } from './Toast';

interface TabSearchProps {
  onTabSelected?: (data: ArrayBuffer | string, title: string) => void;
}

export function TabSearch({ onTabSelected }: TabSearchProps = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SongsterrHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only show the "no results" hint AFTER the user has actually submitted a
  // search. Otherwise the page would permanently display it on first load.
  const [hasSearched, setHasSearched] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    setHasSearched(true);
    try {
      const hits = await searchSongsterr(query);
      setResults(hits);
    } catch (err) {
      console.error(err);
      setError('Erreur de recherche. Vérifie ta connexion internet.');
    } finally {
      setIsSearching(false);
    }
  };

  /** Télécharger le fichier via le scraper et le proxy, puis l'ouvrir. */
  const downloadAndOpenTab = async (hit: SongsterrHit) => {
    try {
      setDownloadingId(hit.id);
      setError(null);

      // 1. Scrape the URL
      const scrapeRes = await fetch(`/api/scrape-songsterr?id=${hit.id}`);
      if (!scrapeRes.ok) {
        throw new Error('Impossible de trouver le fichier sur Songsterr.');
      }
      const { url } = await scrapeRes.json();

      // 2. Download through proxy
      const downloadRes = await fetch(`/api/fetch-tab?url=${encodeURIComponent(url)}`);
      if (!downloadRes.ok) {
        throw new Error('Erreur lors du téléchargement du fichier.');
      }

      const buf = await downloadRes.arrayBuffer();
      const format = detectGpFormat(buf);

      // 3. Save to library — match the LibraryTab schema (kind/format/favorite/tags
      // are required). sourceUrl points back to the Songsterr player so the user
      // can re-find the original revisions list.
      await addTabToLibrary({
        title: hit.title,
        artist: hit.artist.name,
        kind: 'original',
        format: format === 'unknown' ? 'gp' : format,
        data: buf,
        favorite: false,
        tags: ['imported', 'songsterr'],
        sourceUrl: `https://www.songsterr.com/a/wsa/x-tab-s${hit.id}`,
      });

      toast.success('Tablature téléchargée avec succès !');

      // 4. Open in viewer
      if (onTabSelected) {
        onTabSelected(buf, `${hit.artist.name} - ${hit.title}`);
      }

    } catch (err) {
      console.error(err);
      setError((err as Error).message);
    } finally {
      setDownloadingId(null);
    }
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

      {/* Real error (network / API failure) — red ErrorStrip. */}
      {error && <div className="mb-4 max-w-none"><ErrorStrip>{error}</ErrorStrip></div>}

      {/* Empty result set — muted paragraph, not an error. */}
      {hasSearched && !isSearching && !error && results.length === 0 && (
        <p className="text-amp-muted text-sm">Aucun résultat trouvé.</p>
      )}

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
              onClick={() => downloadAndOpenTab(hit)}
              className="ml-3"
              disabled={downloadingId === hit.id}
            >
              {downloadingId === hit.id ? 'Téléchargement...' : 'Télécharger & Ouvrir'}
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
