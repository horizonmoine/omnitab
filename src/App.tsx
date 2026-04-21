/**
 * Coque principale de l'app.
 *
 * Connecte Layout (sidebar / bottom-bar) aux 15 pages et gère les passages
 * de main inter-pages via les slots `pendingTab` et `pendingAudio`.
 *
 * Lazy-loaded pages: TabViewer, Transcriber, ScaleLibrary, EarTraining,
 * BackingTrack, ChordLibrary, SpeedTrainer, StemPlayer, AmpSim — these are
 * code-split into separate chunks to keep the initial bundle small.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { Layout, type Page } from './components/Layout';
import { appBus } from './lib/event-bus';
import { TabSearch } from './components/TabSearch';
import { Library } from './components/Library';
import { Tuner } from './components/Tuner';
import { Recorder } from './components/Recorder';
import { Metronome } from './components/Metronome';
import { Settings } from './components/Settings';
import { ToastContainer } from './components/Toast';
import { db, markOpened } from './lib/db';
import { toast } from './components/Toast';

// Lazy-loaded pages — each becomes a separate chunk.
const TabViewer = lazy(() => import('./components/TabViewer').then((m) => ({ default: m.TabViewer })));
const Transcriber = lazy(() => import('./components/Transcriber').then((m) => ({ default: m.Transcriber })));
const AmpSim = lazy(() => import('./components/AmpSim').then((m) => ({ default: m.AmpSim })));
const StemPlayer = lazy(() => import('./components/StemPlayer').then((m) => ({ default: m.StemPlayer })));
const ChordLibrary = lazy(() => import('./components/ChordLibrary').then((m) => ({ default: m.ChordLibrary })));
const SpeedTrainer = lazy(() => import('./components/SpeedTrainer').then((m) => ({ default: m.SpeedTrainer })));
const ScaleLibrary = lazy(() => import('./components/ScaleLibrary').then((m) => ({ default: m.ScaleLibrary })));
const EarTraining = lazy(() => import('./components/EarTraining').then((m) => ({ default: m.EarTraining })));
const BackingTrack = lazy(() => import('./components/BackingTrack').then((m) => ({ default: m.BackingTrack })));
const PracticeJournal = lazy(() => import('./components/PracticeJournal').then((m) => ({ default: m.PracticeJournal })));
const TexEditor = lazy(() => import('./components/TexEditor').then((m) => ({ default: m.TexEditor })));
const Setlists = lazy(() => import('./components/Setlists').then((m) => ({ default: m.Setlists })));

interface PendingTab {
  data: ArrayBuffer | string;
  title: string;
}

interface PendingAudio {
  blob: Blob;
  label: string;
}

/**
 * Active setlist context — `null` when the viewer is showing a tab opened
 * directly from the library/transcriber, populated when the user is
 * working through a setlist. Drives the Prev/Next bar in the viewer.
 */
interface SetlistContext {
  setlistId: number;
  position: number;
  total: number;
  setlistName: string;
}

function PageLoader() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <div className="animate-pulse text-amp-accent text-xl mb-2">Chargement...</div>
      </div>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<Page>('search');
  const [pendingTab, setPendingTab] = useState<PendingTab | null>(null);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [setlistContext, setSetlistContext] = useState<SetlistContext | null>(
    null,
  );

  // Check for shared tab in URL (?tab=base64-encoded-alphaTex).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (tabParam) {
      try {
        const tex = atob(tabParam);
        setPendingTab({ data: tex, title: 'Tab partagée' });
        setPage('viewer');
        // Clean the URL without reloading.
        window.history.replaceState({}, '', window.location.pathname);
      } catch {
        console.warn('[OmniTab] invalid ?tab= param');
      }
      return; // Skip sessionStorage restore when opening a shared link.
    }

    const saved = sessionStorage.getItem('omnitab.page') as Page | null;
    if (saved) setPage(saved);
  }, []);

  useEffect(() => {
    sessionStorage.setItem('omnitab.page', page);
  }, [page]);

  // Wire navigation actions from the global bus (voice "accordeur" → tuner, etc.).
  useEffect(() => {
    const offs = [
      appBus.on('navigate-tuner', () => setPage('tuner')),
      appBus.on('navigate-metronome', () => setPage('metronome')),
      appBus.on('navigate-viewer', () => setPage('viewer')),
    ];
    return () => { for (const off of offs) off(); };
  }, []);

  // Hand-off helpers ────────────────────────────────────────────────
  const openInViewer = (data: ArrayBuffer | string, title: string) => {
    setPendingTab({ data, title });
    // Direct opens (Library, Transcriber, TexEditor, ?tab=…) always exit
    // setlist mode — the user is breaking out of the playlist flow.
    setSetlistContext(null);
    setPage('viewer');
  };

  const sendToTranscriber = (blob: Blob, label: string) => {
    setPendingAudio({ blob, label });
    setPage('transcribe');
  };

  /**
   * Load the tab at `position` within a setlist and switch to the viewer.
   * Updates setlistContext so the viewer renders its Prev/Next bar.
   */
  const playSetlist = async (setlistId: number, position = 0) => {
    const sl = await db.setlists.get(setlistId);
    if (!sl) {
      toast.error('Setlist introuvable.');
      return;
    }
    if (sl.tabIds.length === 0) {
      toast.error('Cette setlist est vide.');
      return;
    }
    const safePos = Math.max(0, Math.min(position, sl.tabIds.length - 1));
    const tabId = sl.tabIds[safePos];
    const tab = await db.library.get(tabId);
    if (!tab) {
      toast.error(
        `Tab #${tabId} introuvable — elle a peut-être été supprimée de la bibliothèque.`,
      );
      return;
    }
    if (tab.id != null) await markOpened(tab.id);
    setPendingTab({
      data: tab.data,
      title: `${tab.artist} – ${tab.title}`,
    });
    setSetlistContext({
      setlistId,
      position: safePos,
      total: sl.tabIds.length,
      setlistName: sl.name,
    });
    setPage('viewer');
  };

  /** Step within the active setlist by ±1 (or any delta). Clamps to bounds. */
  const navigateSetlist = (delta: number) => {
    if (!setlistContext) return;
    void playSetlist(
      setlistContext.setlistId,
      setlistContext.position + delta,
    );
  };

  const exitSetlist = () => setSetlistContext(null);

  // Render the active page.
  const renderPage = () => {
    switch (page) {
      case 'search':
        return <TabSearch />;
      case 'library':
        return <Library onTabSelected={openInViewer} />;
      case 'viewer':
        return pendingTab ? (
          <TabViewer
            source={pendingTab.data}
            setlistContext={setlistContext ?? undefined}
            onSetlistPrev={() => navigateSetlist(-1)}
            onSetlistNext={() => navigateSetlist(1)}
            onSetlistExit={exitSetlist}
          />
        ) : (
          <ViewerPlaceholder onGoToSearch={() => setPage('search')} />
        );
      case 'tuner':
        return <Tuner />;
      case 'amp':
        return <AmpSim />;
      case 'record':
        return <Recorder onTranscribe={sendToTranscriber} />;
      case 'transcribe':
        return (
          <Transcriber
            initialAudio={pendingAudio ?? undefined}
            onTabReady={(tex, title) => openInViewer(tex, title)}
          />
        );
      case 'tex-editor':
        return <TexEditor onTabReady={openInViewer} />;
      case 'metronome':
        return <Metronome />;
      case 'stems':
        return <StemPlayer />;
      case 'chords':
        return <ChordLibrary />;
      case 'speed-trainer':
        return <SpeedTrainer />;
      case 'scales':
        return <ScaleLibrary />;
      case 'ear-training':
        return <EarTraining />;
      case 'backing-track':
        return <BackingTrack />;
      case 'practice':
        return <PracticeJournal />;
      case 'setlists':
        return <Setlists onPlaySetlist={playSetlist} />;
      case 'settings':
        return <Settings />;
      default:
        return null;
    }
  };

  return (
    <>
      <Layout currentPage={page} onNavigate={setPage}>
        <Suspense fallback={<PageLoader />}>
          {renderPage()}
        </Suspense>
      </Layout>
      <ToastContainer />
    </>
  );
}

interface ViewerPlaceholderProps {
  onGoToSearch: () => void;
}

function ViewerPlaceholder({ onGoToSearch }: ViewerPlaceholderProps) {
  return (
    <div className="h-full flex flex-col items-center justify-center p-6 text-center">
      <div className="text-6xl mb-4">🎼</div>
      <h2 className="text-2xl font-bold mb-2">Aucune tab chargée</h2>
      <p className="text-amp-muted text-sm mb-6 max-w-sm">
        Cherche un morceau dans Songsterr, ouvre une tab de ta bibliothèque,
        ou génère-en une à partir d'un audio depuis le module Transcrire.
      </p>
      <button
        onClick={onGoToSearch}
        className="bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-6 py-2 rounded transition-colors"
      >
        🔍 Rechercher une tab
      </button>
    </div>
  );
}
