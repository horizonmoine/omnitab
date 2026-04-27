/**
 * App entry point.
 *
 * Mounts <App /> into #root and registers the service worker via
 * vite-plugin-pwa's virtual module. The PWA plugin emits a manifest +
 * Workbox runtime, so the app keeps working offline after first load.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { loadSettings } from './lib/settings';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root container #root missing in index.html');
}

// Hydrate user settings from IndexedDB before first render. If this fails
// (e.g. private browsing with no storage) we fall through to the defaults
// baked into settings.ts — the app still works, just without persistence.
loadSettings()
  .catch((err) => {
    console.warn('[OmniTab] settings failed to load, using defaults', err);
  })
  .finally(() => {
    createRoot(container).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
  });

// Register the service worker. autoUpdate makes new versions take effect on
// next visit without prompting (matches the PWA plugin config in vite.config).
const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(swUrl) {
    console.info(`[OmniTab] service worker registered: ${swUrl}`);
    // Once the SW is alive, warm its CacheFirst bucket for the basic-pitch
    // model. Doing this at idle (not at transcription click time) means the
    // first transcription run won't stall on a ~20 MB download over 4G.
    // The CacheFirst handler in vite.config dedupes — calling fetch() here
    // just populates the cache and the response body is immediately GC'd.
    schedulePrefetch(() => {
      const MODEL_URL =
        'https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json';
      fetch(MODEL_URL, { cache: 'force-cache', mode: 'cors' })
        .then(() => console.info('[OmniTab] basic-pitch model pre-cached'))
        .catch((err) => {
          // Offline on first visit → nothing to cache yet, that's fine.
          console.info('[OmniTab] basic-pitch pre-cache skipped:', err.message);
        });
    });
  },
  onOfflineReady() {
    console.info('[OmniTab] ready to work offline.');
  },
  onNeedRefresh() {
    // New version detected — reload immediately so users always run the
    // latest JS without having to close all tabs manually.
    console.info('[OmniTab] new version available — reloading…');
    updateSW(true);
  },
});

/**
 * Fire `task` at browser idle so it never competes with first-paint work.
 * Falls back to a short `setTimeout` on Safari (which still lacks
 * `requestIdleCallback` as of 2026).
 */
function schedulePrefetch(task: () => void): void {
  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(task, { timeout: 5_000 });
  } else {
    setTimeout(task, 2_000);
  }
}
