/**
 * Coque principale de l'app.
 *
 * Connecte Layout (sidebar / bottom-bar) aux 7 pages et gère les passages
 * de main inter-pages via les slots `pendingTab` et `pendingAudio`.
 *
 * Flux inter-pages :
 *   • Search     → charge la tab dans Viewer
 *   • Library    → ouvre une tab stockée dans Viewer
 *   • Recorder   → passe un Blob au Transcriber
 *   • Transcriber → envoie l'alphaTex généré au Viewer
 */

import { useEffect, useState } from 'react';
import { Layout, type Page } from './components/Layout';
import { TabSearch } from './components/TabSearch';
import { Library } from './components/Library';
import { TabViewer } from './components/TabViewer';
import { Tuner } from './components/Tuner';
import { AmpSim } from './components/AmpSim';
import { Recorder } from './components/Recorder';
import { Transcriber } from './components/Transcriber';
import { Metronome } from './components/Metronome';
import { StemPlayer } from './components/StemPlayer';
import { ChordLibrary } from './components/ChordLibrary';
import { SpeedTrainer } from './components/SpeedTrainer';
import { ScaleLibrary } from './components/ScaleLibrary';
import { EarTraining } from './components/EarTraining';
import { BackingTrack } from './components/BackingTrack';
import { Settings } from './components/Settings';

interface PendingTab {
  data: ArrayBuffer | string;
  title: string;
}

interface PendingAudio {
  blob: Blob;
  label: string;
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
        return <TabSearch onTabLoaded={openInViewer} />;
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
      case 'settings':
        return <Settings />;
      default:
        return null;
    }
  };

  return (
    <Layout currentPage={page} onNavigate={setPage}>
      {renderPage()}
    </Layout>
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
