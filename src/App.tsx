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

interface PendingTab {
  data: ArrayBuffer | string;
  title: string;
}

interface PendingAudio {
  blob: Blob;
  label: string;
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
    setPage('viewer');
  };

  const sendToTranscriber = (blob: Blob, label: string) => {
    setPendingAudio({ blob, label });
    setPage('transcribe');
  };

  // Render the active page.
  const renderPage = () => {
    switch (page) {
      case 'search':
        return <TabSearch />;
      case 'library':
        return <Library onTabSelected={openInViewer} />;
      case 'viewer':
        return pendingTab ? (
          <TabViewer source={pendingTab.data} />
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
