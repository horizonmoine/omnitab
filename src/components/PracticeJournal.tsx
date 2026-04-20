/**
 * Practice Journal — track practice sessions with spaced repetition.
 *
 * Features:
 *   - Log practice sessions (song, duration, max BPM, difficulty rating)
 *   - "Setlist du jour" based on SRS (SuperMemo-2 algorithm)
 *   - Stats: total time, streak days, sessions this week
 *   - History list with per-song progress
 */

import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import {
  db,
  addPracticeEntry,
  getDueForReview,
  deletePracticeEntry,
  type PracticeEntry,
} from '../lib/db';
import { toast } from './Toast';
import {
  Button,
  Card,
  Input,
  PageHeader,
  Readout,
  SectionLabel,
} from './primitives';

export function PracticeJournal() {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [duration, setDuration] = useState(15);
  const [maxBpm, setMaxBpm] = useState(100);
  const [rating, setRating] = useState<1 | 2 | 3>(2);
  const [showForm, setShowForm] = useState(false);

  const allEntries = useLiveQuery(() => db.practice.orderBy('practiceDate').reverse().toArray());
  const dueForReview = useLiveQuery(() => getDueForReview());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    await addPracticeEntry({
      title: title.trim(),
      artist: artist.trim(),
      durationSeconds: duration * 60,
      maxBpm,
      rating,
      practiceDate: Date.now(),
    });

    toast.success('Session enregistrée !');
    setTitle('');
    setArtist('');
    setDuration(15);
    setMaxBpm(100);
    setRating(2);
    setShowForm(false);
  };

  // Compute stats.
  const entries = allEntries ?? [];
  const totalMinutes = Math.round(entries.reduce((a, e) => a + e.durationSeconds, 0) / 60);
  const totalSessions = entries.length;

  // Unique practice days.
  const practiceDays = new Set(
    entries.map((e) => new Date(e.practiceDate).toDateString()),
  ).size;

  // Sessions this week.
  const weekAgo = Date.now() - 7 * 86400000;
  const sessionsThisWeek = entries.filter((e) => e.practiceDate > weekAgo).length;

  // Current streak (consecutive days ending today or yesterday).
  const streak = computeStreak(entries);

  const RATING_LABELS = {
    1: { label: 'Difficile', color: 'text-amp-error', bg: 'bg-amp-error' },
    2: { label: 'Correct', color: 'text-amp-accent', bg: 'bg-amp-accent' },
    3: { label: 'Facile', color: 'text-amp-success', bg: 'bg-amp-success' },
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="Journal de pratique"
        subtitle="Suis ta progression et ne perds jamais un morceau grâce à la répétition espacée."
      />

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard value={`${totalMinutes}`} unit="min" label="Temps total" />
        <StatCard value={`${totalSessions}`} unit="" label="Sessions" />
        <StatCard value={`${streak}`} unit="j" label="Série" />
        <StatCard value={`${sessionsThisWeek}`} unit="" label="Cette semaine" />
      </div>

      {/* Due for review (SRS Setlist) — amber-tinted Card variant to flag
          items the SuperMemo-2 scheduler thinks are due today. */}
      {dueForReview && dueForReview.length > 0 && (
        <div className="mb-6">
          <SectionLabel className="text-amp-accent mb-2">
            Setlist du jour ({dueForReview.length})
          </SectionLabel>
          <div className="space-y-2">
            {dueForReview.map((entry) => (
              <Card
                key={entry.id}
                padding="p-3"
                className="bg-amp-accent/10 border-amp-accent/30 flex items-center justify-between"
              >
                <div>
                  <div className="font-semibold text-amp-text">{entry.title}</div>
                  {entry.artist && (
                    <div className="text-xs text-amp-muted">{entry.artist}</div>
                  )}
                  <div className="text-xs text-amp-muted mt-0.5">
                    Dernier: {new Date(entry.practiceDate).toLocaleDateString('fr-FR')}
                    {' · '}Intervalle: {entry.intervalDays}j
                  </div>
                </div>
                <Button
                  variant="chipOn"
                  onClick={() => {
                    setTitle(entry.title);
                    setArtist(entry.artist);
                    setShowForm(true);
                  }}
                >
                  Pratiquer
                </Button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Add session button / form */}
      {!showForm ? (
        <Button onClick={() => setShowForm(true)} className="mb-6">
          + Nouvelle session
        </Button>
      ) : (
        <Card className="mb-6 max-w-lg">
          <form onSubmit={handleSubmit}>
            <h3 className="font-bold mb-3">Enregistrer une session</h3>
            <div className="space-y-3">
              <Input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Morceau ou exercice"
                className="w-full"
                required
              />
              <Input
                type="text"
                value={artist}
                onChange={(e) => setArtist(e.target.value)}
                placeholder="Artiste (optionnel)"
                className="w-full"
              />
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="text-xs text-amp-muted block mb-1">Durée: {duration} min</label>
                  <input
                    type="range"
                    min={5}
                    max={120}
                    step={5}
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    className="w-full accent-amp-accent"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-amp-muted block mb-1">BPM max: {maxBpm}</label>
                  <input
                    type="range"
                    min={40}
                    max={300}
                    step={5}
                    value={maxBpm}
                    onChange={(e) => setMaxBpm(Number(e.target.value))}
                    className="w-full accent-amp-accent"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-amp-muted block mb-1">Difficulté ressentie</label>
                {/* Rating buttons keep custom per-rating bg colours
                    (error → accent → success) — can't express via Button variants. */}
                <div className="flex gap-2">
                  {([1, 2, 3] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRating(r)}
                      aria-pressed={rating === r}
                      className={`flex-1 py-2 rounded text-sm font-bold transition-colors ${
                        rating === r
                          ? `${RATING_LABELS[r].bg} text-white`
                          : 'bg-amp-panel-2 text-amp-muted'
                      }`}
                    >
                      {RATING_LABELS[r].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit">Enregistrer</Button>
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setShowForm(false)}
                >
                  Annuler
                </Button>
              </div>
            </div>
          </form>
        </Card>
      )}

      {/* History */}
      {entries.length > 0 && (
        <div>
          <SectionLabel>Historique</SectionLabel>
          <div role="list" className="space-y-2">
            {entries.slice(0, 50).map((entry) => (
              <Card
                key={entry.id}
                role="listitem"
                padding="p-3"
                className="flex items-center gap-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{entry.title}</div>
                  <div className="text-xs text-amp-muted">
                    {entry.artist && `${entry.artist} · `}
                    {Math.round(entry.durationSeconds / 60)} min
                    {entry.maxBpm > 0 && ` · ${entry.maxBpm} BPM`}
                    {' · '}
                    <span className={RATING_LABELS[entry.rating].color}>
                      {RATING_LABELS[entry.rating].label}
                    </span>
                  </div>
                  <div className="text-[10px] text-amp-muted mt-0.5">
                    {new Date(entry.practiceDate).toLocaleDateString('fr-FR', {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}Prochaine révision: {new Date(entry.nextReviewDate).toLocaleDateString('fr-FR')}
                  </div>
                </div>
                <button
                  onClick={() => entry.id != null && deletePracticeEntry(entry.id)}
                  className="text-amp-muted hover:text-amp-error transition-colors flex-shrink-0"
                  aria-label="Supprimer"
                >
                  <span aria-hidden="true">🗑️</span>
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ value, unit, label }: { value: string; unit: string; label: string }) {
  // Readout gives us tabular-nums — digits stay aligned as numbers change
  // (streak 9 → 10 used to cause jitter with non-tabular mono).
  return (
    <Card padding="px-4 py-3" className="text-center">
      <Readout size="lg" className="text-amp-accent block">
        {value}
        <span className="text-sm">{unit}</span>
      </Readout>
      <div className="text-xs text-amp-muted">{label}</div>
    </Card>
  );
}

/** Compute consecutive practice day streak ending today or yesterday. */
function computeStreak(entries: PracticeEntry[]): number {
  if (entries.length === 0) return 0;

  const days = new Set(
    entries.map((e) => {
      const d = new Date(e.practiceDate);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }),
  );

  const today = new Date();
  let streak = 0;
  let check = new Date(today);

  // Allow starting from today or yesterday.
  const todayKey = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
  if (!days.has(todayKey)) {
    check.setDate(check.getDate() - 1);
    const yKey = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
    if (!days.has(yKey)) return 0;
  }

  while (true) {
    const key = `${check.getFullYear()}-${check.getMonth()}-${check.getDate()}`;
    if (days.has(key)) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}
