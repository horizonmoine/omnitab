/**
 * App layout: sidebar navigation on desktop, bottom tab bar on mobile.
 *
 * Pages are rendered as simple route components (we don't use react-router
 * here — the app is a single shell with tab-switching, which fits the PWA
 * model and avoids routing library weight).
 */

import { useEffect, useState, type ReactNode } from 'react';

export type Page =
  | 'viewer'
  | 'search'
  | 'library'
  | 'tuner'
  | 'amp'
  | 'record'
  | 'transcribe'
  | 'tex-editor'
  | 'metronome'
  | 'stems'
  | 'chords'
  | 'speed-trainer'
  | 'scales'
  | 'ear-training'
  | 'backing-track'
  | 'practice'
  | 'settings';

interface NavItem {
  id: Page;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { id: 'search', label: 'Rechercher', icon: '🔍' },
  { id: 'library', label: 'Bibliothèque', icon: '📚' },
  { id: 'viewer', label: 'Lecteur', icon: '🎼' },
  { id: 'tuner', label: 'Accordeur', icon: '🎯' },
  { id: 'metronome', label: 'Métronome', icon: '🥁' },
  { id: 'amp', label: 'Ampli', icon: '🎚️' },
  { id: 'record', label: 'Enregistrer', icon: '🎙️' },
  { id: 'transcribe', label: 'Transcrire', icon: '🤖' },
  { id: 'tex-editor', label: 'Éditeur Tex', icon: '✍️' },
  { id: 'stems', label: 'Stems', icon: '🎛️' },
  { id: 'chords', label: 'Accords', icon: '🎵' },
  { id: 'speed-trainer', label: 'Speed Trainer', icon: '🏎️' },
  { id: 'scales', label: 'Gammes', icon: '🎹' },
  { id: 'ear-training', label: 'Ear Training', icon: '👂' },
  { id: 'backing-track', label: 'Backing Track', icon: '🔁' },
  { id: 'practice', label: 'Journal', icon: '📓' },
  { id: 'settings', label: 'Réglages', icon: '⚙️' },
];

interface LayoutProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  children: ReactNode;
}

export function Layout({ currentPage, onNavigate, children }: LayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleNav = (page: Page) => {
    onNavigate(page);
    setMobileNavOpen(false);
  };

  // Escape closes the mobile nav sheet. Listener is only attached when
  // the sheet is open so we don't keep a keydown handler live forever.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileNavOpen]);

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-60 flex-col bg-amp-panel border-r border-amp-border">
        <div className="px-5 py-5 border-b border-amp-border">
          <h1 className="text-xl font-bold text-amp-accent">OmniTab</h1>
          <p className="text-xs text-amp-muted mt-1">Guitar Companion</p>
        </div>
        {/* overflow-y-auto so the 16-item nav scrolls on short viewports
            (laptop 1366×768 @ 125% zoom clips without this). */}
        <nav
          className="flex-1 p-3 space-y-1 overflow-y-auto"
          aria-label="Navigation principale"
        >
          {NAV.map((item) => (
            <NavButton
              key={item.id}
              item={item}
              active={currentPage === item.id}
              onClick={() => handleNav(item.id)}
            />
          ))}
        </nav>
        <div className="p-3 text-xs text-amp-muted border-t border-amp-border">
          v0.1.0 · PWA offline
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden bg-amp-panel border-b border-amp-border flex items-center justify-between px-4 py-3">
        <h1 className="text-lg font-bold text-amp-accent">OmniTab</h1>
        <button
          onClick={() => setMobileNavOpen((o) => !o)}
          className="text-amp-text p-2"
          aria-label={mobileNavOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
          aria-expanded={mobileNavOpen}
          aria-controls="mobile-nav-sheet"
        >
          <span aria-hidden="true">☰</span>
        </button>
      </header>

      {/* Mobile nav sheet — modal overlay. Closes on:
          - tapping any nav item (handleNav sets state to false)
          - tapping the backdrop (click fires on the outer div, but the
            <nav> swallows its own clicks via stopPropagation so we don't
            double-close when a nav item is tapped)
          - pressing Escape (useEffect handler above) */}
      {mobileNavOpen && (
        <div
          id="mobile-nav-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="Menu de navigation"
          onClick={() => setMobileNavOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-amp-bg/95 flex flex-col pt-16 overflow-y-auto"
        >
          <nav
            className="p-4 space-y-2"
            aria-label="Navigation principale"
            onClick={(e) => e.stopPropagation()}
          >
            {NAV.map((item) => (
              <NavButton
                key={item.id}
                item={item}
                active={currentPage === item.id}
                onClick={() => handleNav(item.id)}
              />
            ))}
          </nav>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-hidden pb-16 md:pb-0">{children}</main>

      {/* Mobile bottom tab bar — shows the 5 most-used pages */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-amp-panel border-t border-amp-border flex z-30"
        aria-label="Navigation rapide"
      >
        {MOBILE_TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => handleNav(item.id)}
            aria-current={currentPage === item.id ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center py-2 transition-colors ${
              currentPage === item.id
                ? 'text-amp-accent'
                : 'text-amp-muted'
            }`}
          >
            <span className="text-lg" aria-hidden="true">{item.icon}</span>
            <span className="text-[10px] mt-0.5">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

/** Mobile bottom bar: most important 5 pages. */
const MOBILE_TABS: NavItem[] = [
  { id: 'search', label: 'Rechercher', icon: '🔍' },
  { id: 'library', label: 'Biblio', icon: '📚' },
  { id: 'viewer', label: 'Lecteur', icon: '🎼' },
  { id: 'transcribe', label: 'Transcrire', icon: '🤖' },
  { id: 'settings', label: 'Plus', icon: '☰' },
];

interface NavButtonProps {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}

function NavButton({ item, active, onClick }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded text-left transition-colors ${
        active
          ? 'bg-amp-accent text-amp-bg font-semibold'
          : 'text-amp-text hover:bg-amp-panel-2'
      }`}
    >
      <span className="text-lg" aria-hidden="true">
        {item.icon}
      </span>
      <span>{item.label}</span>
    </button>
  );
}
