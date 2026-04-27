/**
 * AlphaTex editor — live-preview authoring tool.
 *
 * Left pane  : monospace textarea the user types alphaTex into.
 * Right pane : embedded AlphaTab renderer that re-renders on a 500 ms debounce.
 *
 * alphaTex is the text format used by @coderline/alphatab — it's roughly the
 * "markdown of guitar tabs": titles, tempo, tuning, then fret.string groups
 * per beat. Lightweight, version-controllable, and completely portable.
 *
 * We initialise AlphaTab once (empty score) and then call `api.tex(source)`
 * on every debounced change. That avoids tearing down and rebuilding the
 * whole SVG render tree, which would flicker and lose scroll position.
 *
 * Errors from the parser come back through the `error` event — we catch and
 * surface them inline so the user can see "unexpected token at line 3" while
 * they're still editing, without crashing the pane.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlphaTabApi } from '../lib/alphatab-types';
import { addTabToLibrary } from '../lib/db';
import { toast } from './Toast';
import { Button, ErrorStrip, Input, PageHeader, Select } from './primitives';

interface TexEditorProps {
  /** Opens the current tex in the main TabViewer on demand. */
  onTabReady: (alphaTex: string, title: string) => void;
}

const CDN = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.2/dist';

/**
 * Starter templates. To add your own, push an object with a unique `id`,
 * a French `label`, and a valid alphaTex body. Keep the title in the body
 * in sync with the label to avoid confusion when the user switches.
 */
const STARTER_TEMPLATES: {
  id: string;
  label: string;
  title: string;
  tex: string;
}[] = [
  {
    id: 'blank',
    label: '📄 Vierge',
    title: 'Mon morceau',
    tex: `\\title "Mon morceau"
\\subtitle ""
\\artist ""
\\tempo 120
.
:4 0.6 0.5 0.4 0.3 0.2 0.1 |`,
  },
  {
    id: 'power-chord',
    label: '🤘 Power chord riff',
    title: 'Power Chord Riff',
    tex: `\\title "Power Chord Riff"
\\tempo 120
.
:8 (0.6 2.5) (0.6 2.5) (0.6 2.5) (0.6 2.5)
   (3.6 5.5) (3.6 5.5) (3.6 5.5) (3.6 5.5) |`,
  },
  {
    id: 'pentatonic',
    label: '🎸 Pentatonique mineure (La)',
    title: 'A Pentatonic Minor',
    tex: `\\title "A Pentatonic Minor"
\\tempo 90
.
:8 5.6 8.6 5.5 7.5 5.4 7.4 5.3 7.3 |
   5.2 8.2 5.1 8.1 5.1 8.1 5.2 8.2 |`,
  },
  {
    id: 'fingerpicking',
    label: '🤏 Travis picking (Do majeur)',
    title: 'Travis Picking C',
    tex: `\\title "Travis Picking"
\\tempo 80
.
:8 3.5 0.2 2.4 0.1 3.5 0.2 2.4 0.1 |
   3.5 0.2 2.4 0.1 3.5 0.2 2.4 0.1 |`,
  },
  {
    id: 'blues-shuffle',
    label: '🎷 Blues shuffle (E)',
    title: 'Blues Shuffle in E',
    tex: `\\title "Blues Shuffle in E"
\\tempo 110
.
:8 (0.6 2.5) (0.6 4.5) (0.6 2.5) (0.6 4.5)
   (0.5 2.4) (0.5 4.4) (0.5 2.4) (0.5 4.4) |
:8 (0.6 2.5) (0.6 4.5) (0.6 2.5) (0.6 4.5)
   (0.6 2.5) (0.6 4.5) (0.6 2.5) (0.6 4.5) |`,
  },
];

export function TexEditor({ onTabReady }: TexEditorProps) {
  const [templateId, setTemplateId] = useState(STARTER_TEMPLATES[0].id);
  const [tex, setTex] = useState(STARTER_TEMPLATES[0].tex);
  const [title, setTitle] = useState(STARTER_TEMPLATES[0].title);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [initialising, setInitialising] = useState(true);

  const previewRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<AlphaTabApi | null>(null);
  const debounceRef = useRef<number | null>(null);

  // Init AlphaTab once. We render whatever `tex` currently is so the first
  // paint isn't blank; subsequent updates flow through the debounced effect.
  useEffect(() => {
    let cancelled = false;
    setInitialising(true);

    (async () => {
      try {
        const alphatab = await import('@coderline/alphatab');
        if (cancelled || !previewRef.current) return;

        const settings = new alphatab.Settings();
        settings.core.fontDirectory = `${CDN}/font/`;
        settings.core.engine = 'svg';
        // No player in the editor preview — less noise, faster re-renders,
        // and the user can switch to the full Viewer when they want to hear
        // it. Keeping the player off also skips the sf2 download.
        settings.player.enablePlayer = false;
        settings.player.enableCursor = false;
        settings.display.staveProfile = alphatab.StaveProfile.ScoreTab;

        const api = new alphatab.AlphaTabApi(previewRef.current, settings);
        apiRef.current = api;

        api.scoreLoaded.on(() => {
          if (cancelled) return;
          setInitialising(false);
        });

        api.error.on((e: unknown) => {
          // The parser reports errors here. Massage the event into a string —
          // some versions expose `{ message }`, others pass a plain string.
          const msg =
            (e as { message?: string })?.message ??
            (typeof e === 'string' ? e : 'Erreur de parsing.');
          setRenderError(msg);
          setInitialising(false);
        });

        api.tex(tex);
      } catch (e) {
        console.error('[TexEditor] alphaTab init failed:', e);
        if (!cancelled) {
          setRenderError("AlphaTab a échoué à s'initialiser.");
          setInitialising(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        apiRef.current?.destroy?.();
      } catch {
        /* ignore */
      }
      apiRef.current = null;
    };
    // Intentionally empty — we only want to init once. Tex changes go
    // through the debounced effect below, not through re-initialisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced live-preview. 500 ms is the sweet spot — feels responsive
  // while avoiding a re-render on every keystroke while the user's typing
  // `\tempo 120`.
  useEffect(() => {
    if (!apiRef.current || initialising) return;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      try {
        setRenderError(null);
        apiRef.current?.tex(tex);
      } catch (err) {
        setRenderError((err as Error).message);
      }
    }, 500);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [tex, initialising]);

  const loadTemplate = useCallback((id: string) => {
    const tpl = STARTER_TEMPLATES.find((t) => t.id === id);
    if (!tpl) return;
    setTemplateId(id);
    setTex(tpl.tex);
    setTitle(tpl.title);
  }, []);

  const saveToLibrary = useCallback(async () => {
    const finalTitle = title.trim() || 'Tab AlphaTex';
    try {
      await addTabToLibrary({
        title: finalTitle,
        artist: 'Créé avec l\'éditeur',
        kind: 'generated',
        format: 'tex',
        data: tex,
        favorite: false,
        tags: ['hand-written', 'alpha-tex'],
      });
      toast.success(`"${finalTitle}" sauvegardé dans la bibliothèque.`);
    } catch (err) {
      toast.error(`Sauvegarde impossible : ${(err as Error).message}`);
    }
  }, [tex, title]);

  const openInViewer = useCallback(() => {
    onTabReady(tex, title.trim() || 'Tab AlphaTex');
  }, [tex, title, onTabReady]);

  // Keyboard shortcuts — Ctrl/Cmd+S to save, Ctrl/Cmd+Enter to open in viewer.
  // Stash the latest handlers in refs so the global listener doesn't rebind
  // on every keystroke (saveToLibrary / openInViewer change with `tex`+`title`).
  const saveRef = useRef(saveToLibrary);
  const openRef = useRef(openInViewer);
  useEffect(() => {
    saveRef.current = saveToLibrary;
  }, [saveToLibrary]);
  useEffect(() => {
    openRef.current = openInViewer;
  }, [openInViewer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Browsers default Ctrl+S to "save page as" — preventDefault is
      // mandatory or the user gets a download dialog instead of a saved tab.
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        void saveRef.current();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        openRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="Éditeur AlphaTex"
        subtitle="Écris une tab en texte, vois le rendu se mettre à jour en direct. Parfait pour les riffs, exercices, ou notes rapides."
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <label className="block">
          <span className="block text-xs text-amp-muted mb-1">Titre</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Mon morceau"
            className="text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-xs text-amp-muted mb-1">Modèle</span>
          <Select
            value={templateId}
            onChange={(e) => loadTemplate(e.target.value)}
            className="text-sm"
            aria-label="Charger un modèle"
          >
            {STARTER_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex gap-2 ml-auto">
          <Button
            variant="secondary"
            onClick={saveToLibrary}
            className="px-4 py-2 text-sm"
            title="Sauvegarder dans la bibliothèque (Ctrl+S)"
          >
            💾 Sauvegarder
          </Button>
          <Button
            onClick={openInViewer}
            className="px-4 py-2 text-sm"
            title="Ouvrir dans le lecteur (Ctrl+Entrée)"
          >
            📖 Ouvrir dans le lecteur
          </Button>
        </div>
      </div>

      {/* Split layout — stacks on mobile, side-by-side on md+. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Editor pane */}
        <div className="flex flex-col">
          <label
            htmlFor="tex-editor"
            className="block text-xs text-amp-muted mb-1"
          >
            Source AlphaTex
          </label>
          <textarea
            id="tex-editor"
            value={tex}
            onChange={(e) => setTex(e.target.value)}
            spellCheck={false}
            // Monospace + generous line-height keeps fret.string groups
            // readable. `resize-vertical` lets the user grow the pane if
            // they're writing a long piece.
            className="w-full min-h-[480px] bg-amp-panel border border-amp-border rounded p-3 text-amp-text font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-amp-accent resize-vertical"
            aria-label="Éditeur AlphaTex"
          />
          {renderError && (
            <ErrorStrip className="mt-2" role="alert">
              {renderError}
            </ErrorStrip>
          )}
          <div className="mt-1 text-[11px] text-amp-muted">
            Raccourcis : <kbd className="px-1 py-0.5 bg-amp-panel-2 rounded border border-amp-border">Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-amp-panel-2 rounded border border-amp-border">S</kbd> sauve ·{' '}
            <kbd className="px-1 py-0.5 bg-amp-panel-2 rounded border border-amp-border">Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-amp-panel-2 rounded border border-amp-border">Entrée</kbd> ouvre dans le lecteur
          </div>
          <details className="mt-2 text-xs text-amp-muted">
            <summary className="cursor-pointer hover:text-amp-text">
              Aide-mémoire AlphaTex
            </summary>
            <ul className="mt-2 space-y-1 font-mono">
              <li><code>\title "Nom"</code> · <code>\artist "Auteur"</code> · <code>\tempo 120</code></li>
              <li>Terminer l'en-tête par un point seul : <code>.</code></li>
              <li>Durée : <code>:4</code> (noire), <code>:8</code> (croche), <code>:16</code> (double croche)</li>
              <li>Note = <code>frette.corde</code> (corde 1 = mi aigu, 6 = mi grave)</li>
              <li>Accord = <code>(0.6 2.5 2.4 0.3 0.2 0.1)</code> — 6 notes entre parenthèses</li>
              <li>Silence : <code>r</code> · Barre de mesure : <code>|</code></li>
              <li>Doc complète :{' '}
                <a
                  href="https://alphatab.net/docs/alphatex/introduction"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-amp-accent hover:underline"
                >
                  alphatab.net/docs/alphatex
                </a>
              </li>
            </ul>
          </details>
        </div>

        {/* Preview pane */}
        <div className="flex flex-col">
          <div className="text-xs text-amp-muted mb-1">
            Aperçu{' '}
            {initialising && (
              <span className="text-amp-accent">(chargement…)</span>
            )}
          </div>
          <div
            className="bg-white rounded border border-amp-border overflow-auto min-h-[480px]"
            aria-label="Aperçu AlphaTab"
          >
            <div ref={previewRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
