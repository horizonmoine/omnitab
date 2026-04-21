/**
 * Setlists page — ordered playlists of library tabs.
 *
 * Use cases:
 *   - Gigs: chain "Sweet Child O' Mine" → "Wonderwall" → "Smells Like
 *     Teen Spirit" with single-click navigation between songs
 *   - Practice sessions: a focused list of 5 songs to drill today
 *   - Setlist as a "lesson plan" for teachers
 *
 * Design choices:
 *   - Reactive UI via useLiveQuery — adding a tab anywhere updates here
 *   - One setlist expanded at a time (accordion). Saves vertical real
 *     estate when you have many setlists with long tab lists
 *   - Up/down arrows for reordering — drag-and-drop is overkill for the
 *     typical 5-15 tab setlist, and keyboard-accessible by default
 *   - Tab picker uses the live library — no need to refresh after import
 *   - Missing tabs (deleted from library after being added to a setlist)
 *     show as a "Tab introuvable" placeholder with a remove option
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import {
  addTabToSetlist,
  createSetlist,
  db,
  deleteSetlist,
  getAllSetlists,
  moveTabInSetlist,
  removeTabFromSetlist,
  renameSetlist,
} from '../lib/db';
import type { LibraryTab, Setlist } from '../lib/types';
import { Button, Card, Input, PageHeader, SectionLabel } from './primitives';
import { toast } from './Toast';

interface SetlistsProps {
  /** App-level handler that loads the tab at `position` and routes to the viewer. */
  onPlaySetlist: (setlistId: number, position?: number) => void;
}

export function Setlists({ onPlaySetlist }: SetlistsProps) {
  const setlists = useLiveQuery(getAllSetlists, []);
  const allTabs = useLiveQuery(() => db.library.toArray(), []);

  const [newName, setNewName] = useState('');
  // Track which setlist is expanded — null means all collapsed. We use a
  // single-expanded model rather than a Set<number> because the typical
  // user only edits one setlist at a time, and rendering all expanded
  // can be visually noisy with many tabs.
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Index library by id for O(1) lookup when rendering setlist tab rows.
  // useMemo so we don't rebuild on every keystroke in the create-name input.
  const tabById = useMemo(() => {
    const map = new Map<number, LibraryTab>();
    for (const t of allTabs ?? []) {
      if (t.id != null) map.set(t.id, t);
    }
    return map;
  }, [allTabs]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const id = await createSetlist(name);
    setNewName('');
    setExpandedId(id);
    toast.success(`Setlist « ${name} » créée.`);
  };

  const handleRename = async (sl: Setlist) => {
    const next = window.prompt('Nouveau nom de la setlist :', sl.name);
    if (next == null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === sl.name) return;
    if (sl.id != null) {
      await renameSetlist(sl.id, trimmed);
      toast.success('Setlist renommée.');
    }
  };

  const handleDelete = async (sl: Setlist) => {
    if (sl.id == null) return;
    if (!window.confirm(`Supprimer la setlist « ${sl.name} » ?`)) return;
    await deleteSetlist(sl.id);
    if (expandedId === sl.id) setExpandedId(null);
    toast.success('Setlist supprimée.');
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="Setlists"
        subtitle="Crée des playlists de tabs pour tes répétitions, concerts ou sessions de travail. Navigue d'un morceau au suivant sans quitter le lecteur."
      />

      {/* Create form */}
      <Card className="mb-6 max-w-2xl" padding="p-4">
        <SectionLabel className="mb-2 text-xs">Nouvelle setlist</SectionLabel>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreate();
          }}
          className="flex gap-2"
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Ex. Concert mai 2026, Setlist Métal, Travail jazz…"
            className="flex-1"
            aria-label="Nom de la nouvelle setlist"
          />
          <Button
            type="submit"
            disabled={!newName.trim()}
            className="px-4 py-2 whitespace-nowrap"
          >
            ➕ Créer
          </Button>
        </form>
      </Card>

      {/* List */}
      {!setlists ? (
        <p className="text-amp-muted">Chargement…</p>
      ) : setlists.length === 0 ? (
        <div className="text-center py-12 text-amp-muted">
          <div className="text-5xl mb-3">📋</div>
          <p className="mb-1">Aucune setlist pour le moment.</p>
          <p className="text-sm">Crée-en une ci-dessus pour démarrer.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {setlists.map((sl) => (
            <SetlistCard
              key={sl.id}
              setlist={sl}
              tabById={tabById}
              expanded={expandedId === sl.id}
              onToggleExpand={() =>
                setExpandedId((cur) => (cur === sl.id ? null : sl.id ?? null))
              }
              onPlay={() => sl.id != null && onPlaySetlist(sl.id, 0)}
              onJump={(position) =>
                sl.id != null && onPlaySetlist(sl.id, position)
              }
              onRename={() => handleRename(sl)}
              onDelete={() => handleDelete(sl)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// SetlistCard — single setlist row with expand/play/edit affordances.
// ─────────────────────────────────────────────────────────────────────────

interface SetlistCardProps {
  setlist: Setlist;
  tabById: Map<number, LibraryTab>;
  expanded: boolean;
  onToggleExpand: () => void;
  onPlay: () => void;
  /** Jump to a specific tab in the setlist. */
  onJump: (position: number) => void;
  onRename: () => void;
  onDelete: () => void;
}

function SetlistCard({
  setlist,
  tabById,
  expanded,
  onToggleExpand,
  onPlay,
  onJump,
  onRename,
  onDelete,
}: SetlistCardProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');

  const tabCount = setlist.tabIds.length;
  const isEmpty = tabCount === 0;

  // Library tabs not yet in this setlist — these are the candidates for
  // the picker. We compute it inline (small N) rather than memoising.
  const candidates = Array.from(tabById.values())
    .filter((t) => t.id != null && !setlist.tabIds.includes(t.id))
    .filter((t) => {
      if (!pickerSearch.trim()) return true;
      const q = pickerSearch.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q)
      );
    })
    .slice(0, 50); // cap so a 500-tab library doesn't blow up the dropdown

  const handleAdd = async (tabId: number) => {
    if (setlist.id == null) return;
    await addTabToSetlist(setlist.id, tabId);
    setPickerSearch('');
    // Keep the picker open so the user can add several in a row without
    // re-clicking "Ajouter" each time.
  };

  const handleRemove = async (position: number) => {
    if (setlist.id == null) return;
    await removeTabFromSetlist(setlist.id, position);
  };

  const handleMove = async (position: number, delta: number) => {
    if (setlist.id == null) return;
    await moveTabInSetlist(setlist.id, position, delta);
  };

  return (
    <Card className="max-w-3xl" padding="p-0">
      {/* Header — collapsed view always visible */}
      <div className="flex items-center gap-2 p-3">
        <button
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? 'Réduire' : 'Développer'}
          className="text-amp-muted hover:text-amp-accent transition-colors text-lg flex-shrink-0 w-6"
        >
          {expanded ? '▾' : '▸'}
        </button>
        <button
          onClick={onToggleExpand}
          className="flex-1 text-left min-w-0"
        >
          <div className="font-semibold truncate">{setlist.name}</div>
          <div className="text-xs text-amp-muted">
            {tabCount} tab{tabCount !== 1 ? 's' : ''}
            {' · maj '}
            {new Date(setlist.updatedAt).toLocaleDateString('fr-FR')}
          </div>
        </button>
        <Button
          onClick={onPlay}
          disabled={isEmpty}
          className="px-3 py-1.5 text-sm whitespace-nowrap"
          title={isEmpty ? 'Ajoute des tabs avant de lire' : 'Lire la setlist'}
        >
          ▶ Lire
        </Button>
        <Button
          variant="secondary"
          onClick={onRename}
          aria-label="Renommer"
          className="px-2 py-1.5 text-sm"
          title="Renommer"
        >
          ✏️
        </Button>
        <Button
          variant="secondary"
          onClick={onDelete}
          aria-label="Supprimer la setlist"
          className="px-2 py-1.5 text-sm"
          title="Supprimer"
        >
          🗑️
        </Button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="px-3 pb-3 space-y-1 border-t border-amp-border pt-3">
          {isEmpty ? (
            <p className="text-sm text-amp-muted italic">
              Setlist vide — ajoute des tabs depuis ta bibliothèque.
            </p>
          ) : (
            <ol className="space-y-1">
              {setlist.tabIds.map((tabId, position) => {
                const tab = tabById.get(tabId);
                return (
                  <li
                    key={`${tabId}-${position}`}
                    className="flex items-center gap-2 p-2 bg-amp-panel-2 rounded"
                  >
                    <span className="text-amp-muted text-xs w-6 text-right tabular-nums">
                      {position + 1}.
                    </span>
                    {tab ? (
                      <button
                        onClick={() => onJump(position)}
                        className="flex-1 text-left min-w-0 hover:text-amp-accent transition-colors"
                        title="Jouer depuis cette tab"
                      >
                        <div className="font-medium truncate text-sm">
                          {tab.title}
                        </div>
                        <div className="text-xs text-amp-muted truncate">
                          {tab.artist} · .{tab.format}
                        </div>
                      </button>
                    ) : (
                      <div className="flex-1 text-sm text-amp-muted italic">
                        Tab introuvable (id {tabId}) — supprimée de la
                        bibliothèque ?
                      </div>
                    )}
                    <button
                      onClick={() => handleMove(position, -1)}
                      disabled={position === 0}
                      className="text-amp-muted hover:text-amp-accent disabled:opacity-30 px-1"
                      aria-label="Monter"
                      title="Monter"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => handleMove(position, 1)}
                      disabled={position === tabCount - 1}
                      className="text-amp-muted hover:text-amp-accent disabled:opacity-30 px-1"
                      aria-label="Descendre"
                      title="Descendre"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => handleRemove(position)}
                      className="text-amp-muted hover:text-amp-error px-1"
                      aria-label="Retirer"
                      title="Retirer de la setlist"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {/* Add-tab picker */}
          <div className="pt-2">
            {!pickerOpen ? (
              <Button
                variant="secondary"
                onClick={() => setPickerOpen(true)}
                className="px-3 py-1.5 text-sm"
              >
                + Ajouter une tab depuis la bibliothèque
              </Button>
            ) : (
              <div className="bg-amp-panel-2 rounded p-2 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder="Filtrer par titre ou artiste…"
                    className="flex-1 text-sm"
                    autoFocus
                  />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setPickerOpen(false);
                      setPickerSearch('');
                    }}
                    className="px-3 py-1.5 text-sm"
                  >
                    Fermer
                  </Button>
                </div>
                {candidates.length === 0 ? (
                  <p className="text-xs text-amp-muted italic">
                    {tabById.size === 0
                      ? 'Bibliothèque vide.'
                      : pickerSearch.trim()
                        ? 'Aucune tab ne correspond.'
                        : 'Toutes les tabs de la bibliothèque sont déjà dans cette setlist.'}
                  </p>
                ) : (
                  <ul className="max-h-64 overflow-y-auto space-y-1">
                    {candidates.map((tab) => (
                      <li key={tab.id}>
                        <button
                          onClick={() => tab.id != null && handleAdd(tab.id)}
                          className="w-full text-left p-2 hover:bg-amp-border rounded transition-colors"
                        >
                          <div className="font-medium text-sm truncate">
                            {tab.title}
                          </div>
                          <div className="text-xs text-amp-muted truncate">
                            {tab.artist} · .{tab.format}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
