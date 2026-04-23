/**
 * Songsterr search UI.
 *
 * Two actions per result:
 *   1. "Voir sur Songsterr" — outbound link to the player page, 100% reliable.
 *   2. "Télécharger" — scrape the page for the .gp CDN URL, download via
 *      /api/fetch-tab, save to library, open in viewer. Scrape is best-effort
 *      because Songsterr removed the public .gp URL from most pages in 2024.
 *      When it fails we surface the Songsterr link as fallback.
 */

import { useState } from 'react';
import { searchSongsterr, detectGpFormat } from '../lib/songsterr-api';
import type { SongsterrHit } from '../lib/types';
import { Button, Card, ErrorStrip, Input, PageHeader } from './primitives';
import { addTabToLibrary } from '../lib/db';
import { toast } from './Toast';

interface TabSearchProps {
  onTabSelected?: (data: ArrayBuffer | string, title: string) => void;
  /** Demande à l'App de router vers la page Transcribe avec une chanson
   *  Songsterr pré-remplie (fallback quand .gp n'est pas téléchargeable). */
  onTranscribeRequested?: (title: string, artist: string) => void;
}

export function TabSearch({
  onTabSelected,
  onTranscribeRequested,
}: TabSearchProps = {}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SongsterrHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Only show the "no results" hint AFTER the user has actually submitted a
  // search. Otherwise the page would permanently display it on first load.
  const [hasSearched, setHasSearched] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  // Tracks the last hit whose download failed — used to surface a prominent
  // "Transcrire" CTA in the error strip so the user has an immediate next step.
  const [failedHit, setFailedHit] = useState<SongsterrHit | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setIsSearching(true);
    setError(null);
    setFailedHit(null);
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

  /** Build the public Songsterr player URL for a given song id. The `-s${id}`
   *  suffix is the only part Songsterr reads — the slug before it is cosmetic. */
  const songsterrPlayerUrl = (id: number) =>
    `https://www.songsterr.com/a/wsa/x-tab-s${id}`;

  /** Outbound action: just open the Songsterr player in a new tab.
   *  This always works — no scraping involved. */
  const openOnSongsterr = (hit: SongsterrHit) => {
    window.open(songsterrPlayerUrl(hit.id), '_blank', 'noopener,noreferrer');
  };

  /** Route the user to the Transcribe page with this hit pre-filled. This is
   *  the fallback we recommend when the .gp download fails — the Transcriber
   *  will run the YT → Demucs → basic-pitch pipeline to synthesise a tab. */
  const transcribeHit = (hit: SongsterrHit) => {
    if (!onTranscribeRequested) return;
    onTranscribeRequested(hit.title, hit.artist.name);
  };

  /** Télécharger le fichier via le scraper et le proxy, puis l'ouvrir. */
  const downloadAndOpenTab = async (hit: SongsterrHit) => {
    try {
      setDownloadingId(hit.id);
      setError(null);
      setFailedHit(null);

      // 1. Scrape the URL. Songsterr stripped the public .gp URL from most
      //    pages in 2024, so this is best-effort — we redirect the user to
      //    the outbound "Voir sur Songsterr" button when the scrape fails.
      const scrapeRes = await fetch(`/api/scrape-songsterr?id=${hit.id}`);
      if (!scrapeRes.ok) {
        throw new Error(
          'Songsterr n’expose plus le fichier .gp publiquement pour cette chanson. Utilise « Voir sur Songsterr » pour la jouer dans leur lecteur.',
        );
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
      // Remember which hit failed so we can offer a one-click "Transcrire"
      // fallback right inside the error strip (no need to scroll back up).
      setFailedHit(hit);
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

      {/* Real error (network / API failure) — red ErrorStrip. When the
          failure came from a specific hit and a Transcribe handler is wired,
          surface a direct call-to-action so the user has a next step. */}
      {error && (
        <div className="mb-4 max-w-none">
          <ErrorStrip>
            <div>{error}</div>
            {failedHit && onTranscribeRequested && (
              <Button
                variant="primary"
                onClick={() => transcribeHit(failedHit)}
                className="mt-2"
              >
                🤖 Transcrire « {failedHit.title} » depuis YouTube
              </Button>
            )}
          </ErrorStrip>
        </div>
      )}

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
            {/* Three distinct actions — outbound (reliable), download
                (best-effort, scraper can fail), and AI transcription fallback
                (pipeline lives on the Transcribe page). `flex-wrap` keeps
                them readable on mobile where 3 buttons + artist/title fight
                for horizontal space. */}
            <div className="ml-3 flex flex-shrink-0 flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => openOnSongsterr(hit)}
                title="Ouvrir la page Songsterr dans un nouvel onglet"
              >
                Voir sur Songsterr
              </Button>
              <Button
                variant="primary"
                onClick={() => downloadAndOpenTab(hit)}
                disabled={downloadingId === hit.id}
                title="Télécharger le .gp et l’ajouter à ta bibliothèque locale"
              >
                {downloadingId === hit.id ? 'Téléchargement…' : 'Télécharger'}
              </Button>
              {onTranscribeRequested && (
                <Button
                  variant="secondary"
                  onClick={() => transcribeHit(hit)}
                  title="Générer un tab via le pipeline YouTube → Demucs → basic-pitch"
                >
                  🤖 Transcrire
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
