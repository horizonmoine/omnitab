/**
 * Module "Transcrire" — le cœur de l'app.
 *
 * Pipeline commun :
 *   Fichier audio ──→ (opt. Demucs pour isoler un stem) ──→ basic-pitch
 *                 ──→ liste de notes détectées
 *
 * Puis selon le MODE choisi par l'utilisateur :
 *
 *   • Mode A — "Guitare réelle"
 *       Filtre les notes au registre guitare → Viterbi → tab 1 piste.
 *       Décrit ce que le guitariste original joue sur l'enregistrement.
 *
 *   • Mode B — "Chant + accords"
 *       extractMelodyAndAccompaniment() sépare voix haute et basse,
 *       fusionne les deux en une seule séquence → Viterbi → tab fingerstyle.
 *       Une seule guitare joue la mélodie chantée + le rythme/basse.
 *
 * Les deux modes peuvent optionnellement pré-traiter l'audio avec Demucs
 * (si le backend local est joignable) pour isoler respectivement le stem
 * guitare ou le stem vocal avant la transcription.
 */

import { useEffect, useState } from 'react';
import { transcribeAudio, filterGuitarNotes } from '../lib/basic-pitch';
import { decodeAndResample } from '../lib/audio-engine';
import { assignViterbi } from '../lib/midi-to-tab';
import { transcriptionToAlphaTex } from '../lib/alpha-tab-converter';
import { TUNINGS, applyCapo } from '../lib/guitarTunings';
import { addTabToLibrary, saveStem } from '../lib/db';
import {
  fetchYoutubeAudio,
  isBackendAvailable,
  separateStem,
  type BackendHealth,
} from '../lib/demucs-client';
import { toast } from './Toast';
import { extractMelodyAndAccompaniment } from '../lib/chord-melody';
import { detectTempo } from '../lib/tempo-detection';
import {
  getDefaultTuning,
  getSettings,
  subscribeSettings,
} from '../lib/settings';
import type { DetectedNote, Tuning, Transcription } from '../lib/types';
import {
  Button,
  Card,
  ErrorStrip,
  Input,
  PageHeader,
  SectionLabel,
  Select,
} from './primitives';

type Mode = 'guitar' | 'vocal-chords';

interface TranscriberProps {
  /** Blob préchargé (depuis le Recorder par exemple). */
  initialAudio?: { blob: Blob; label: string };
  onTabReady: (alphaTex: string, title: string) => void;
}

const MODES: {
  id: Mode;
  label: string;
  hint: string;
  icon: string;
}[] = [
  {
    id: 'guitar',
    label: 'Guitare réelle',
    hint: 'Retranscrit exactement ce que le guitariste joue sur l\'enregistrement.',
    icon: '🎸',
  },
  {
    id: 'vocal-chords',
    label: 'Chant + accords',
    hint: 'Une seule guitare qui joue la ligne vocale aiguë + la basse/accords. Idéal pour s\'accompagner.',
    icon: '🎤',
  },
];

export function Transcriber({ initialAudio, onTabReady }: TranscriberProps) {
  // Entrée
  const [file, setFile] = useState<File | Blob | null>(
    initialAudio?.blob ?? null,
  );
  const [label, setLabel] = useState(initialAudio?.label ?? '');

  // Configuration — seed tuning from persisted user settings if any.
  const [mode, setMode] = useState<Mode>('guitar');
  const [tuning, setTuning] = useState<Tuning>(() => getDefaultTuning());
  const [capo, setCapo] = useState(0);
  const [useDemucs, setUseDemucs] = useState(false);
  const [backend, setBackend] = useState<BackendHealth | null>(null);
  const [backendChecking, setBackendChecking] = useState(true);

  // État d'exécution
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultTex, setResultTex] = useState<string | null>(null);
  const [transcription, setTranscription] = useState<Transcription | null>(
    null,
  );
  // Stem separation state
  const [separating, setSeparating] = useState(false);
  const [separateProgress, setSeparateProgress] = useState('');

  // YouTube import state
  const [ytUrl, setYtUrl] = useState('');
  const [ytFetching, setYtFetching] = useState(false);

  const importYoutube = async () => {
    if (!ytUrl.trim()) return;
    if (!backend) {
      toast.error('Backend requis pour l\'import YouTube (voir Réglages).');
      return;
    }
    setYtFetching(true);
    try {
      const { blob, title } = await fetchYoutubeAudio(ytUrl.trim());
      setFile(blob);
      setLabel(title);
      setResultTex(null);
      setError(null);
      toast.success(`Audio YouTube récupéré (${(blob.size / 1024 / 1024).toFixed(1)} MB)`);
      setYtUrl('');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setYtFetching(false);
    }
  };

  // Au montage ET à chaque changement d'URL backend (Réglages) : re-ping.
  // Ça permet à l'utilisateur de changer `demucsUrl` dans la page Réglages
  // sans avoir à recharger l'app.
  useEffect(() => {
    let cancelled = false;
    let lastUrl = getSettings().demucsUrl;

    const probe = () => {
      setBackendChecking(true);
      isBackendAvailable().then((h) => {
        if (cancelled) return;
        setBackend(h);
        setBackendChecking(false);
      });
    };

    probe();
    const unsub = subscribeSettings((s) => {
      if (s.demucsUrl !== lastUrl) {
        lastUrl = s.demucsUrl;
        probe();
      }
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Propagation d'un audio pré-chargé depuis le Recorder.
  useEffect(() => {
    if (initialAudio) {
      setFile(initialAudio.blob);
      setLabel(initialAudio.label);
      setResultTex(null);
      setError(null);
    }
  }, [initialAudio]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setLabel(f.name.replace(/\.[^.]+$/, ''));
    setResultTex(null);
    setError(null);
  };

  const run = async () => {
    if (!file) return;
    setRunning(true);
    setError(null);
    setProgress(0);
    setResultTex(null);

    try {
      // Étape 1 : pré-traitement Demucs (optionnel).
      let audioSource: File | Blob = file;
      if (useDemucs && backend) {
        const wantedStem = mode === 'guitar' ? 'guitar' : 'vocals';
        setStatus(`🐍 Demucs : isolation du stem "${wantedStem}"…`);
        try {
          audioSource = await separateStem(file, wantedStem, (p) => {
            setProgress(p.progress * 0.3); // 0 → 30% alloué à Demucs
            setStatus(p.status);
          });
        } catch (demucsErr) {
          console.warn('Demucs a échoué, on retombe sur l\'audio original', demucsErr);
          setStatus(`⚠ Demucs indisponible, transcription sur audio brut`);
          audioSource = file;
        }
      }

      // Étape 2 : décodage + resampling à 22050 Hz mono.
      setStatus('Décodage de l\'audio…');
      setProgress(useDemucs ? 0.32 : 0.05);
      const audioBuffer = await decodeAndResample(audioSource, 22050);

      // Étape 3 : basic-pitch — note detection polyphonique.
      const detected = await transcribeAudio(
        audioBuffer,
        undefined,
        ({ progress: p, status: s }) => {
          // On mappe 0..1 de basic-pitch dans la plage 32..90% de notre UI.
          const base = useDemucs ? 0.32 : 0.05;
          setProgress(base + p * (0.9 - base));
          setStatus(s);
        },
      );

      // Étape 4 : divergence selon le mode choisi.
      setStatus('Placement des notes sur le manche…');
      setProgress(0.92);
      const effectiveTuning = applyCapo(tuning, capo);
      // User-tunable Viterbi weights (Settings page). Falls back to defaults.
      const { costWeights } = getSettings();
      const tabNotes = runModePipeline(
        mode,
        detected,
        effectiveTuning,
        costWeights,
      );

      if (tabNotes.length === 0) {
        throw new Error(
          mode === 'guitar'
            ? 'Aucune note dans le registre guitare n\'a été détectée.'
            : 'Impossible d\'extraire une mélodie claire de cet audio.',
        );
      }

      // Étape 4.5 : estimation du tempo depuis les onsets basic-pitch.
      // Si la confiance est faible on retombe sur 120 BPM (défaut raisonnable).
      const { bpm: detectedBpm, confidence: tempoConf } = detectTempo(detected);
      const tempoBpm = tempoConf > 0.2 ? detectedBpm : 120;

      // Étape 5 : export alphaTex.
      const transcription: Transcription = {
        notes: tabNotes,
        tuning: effectiveTuning,
        capo,
        durationSeconds: audioBuffer.duration,
        tempoBpm,
      };
      setTranscription(transcription);

      const modeLabel = mode === 'guitar' ? 'Guitare réelle' : 'Chant+accords';
      const alphaTex = transcriptionToAlphaTex(
        transcription,
        label || 'Transcription',
        modeLabel,
      );
      setResultTex(alphaTex);
      setStatus(
        `✅ ${tabNotes.length} notes transcrites (${modeLabel}) · ${tempoBpm} BPM${
          tempoConf > 0.2 ? ' (détecté)' : ' (défaut)'
        }.`,
      );
      setProgress(1);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error
          ? err.message
          : 'Erreur lors de la transcription.',
      );
    } finally {
      setRunning(false);
    }
  };

  const sendToViewer = () => {
    if (!resultTex) return;
    onTabReady(resultTex, label || 'Transcription');
  };

  const saveToLibrary = async () => {
    if (!resultTex) return;
    const kind = mode === 'guitar' ? 'generated' : 'cover';
    const modeTag = mode === 'guitar' ? 'guitare-reelle' : 'chant-accords';
    await addTabToLibrary({
      title: label || 'Transcription',
      artist: mode === 'guitar' ? 'Transcrit (IA)' : 'Arrangé (IA)',
      kind,
      format: 'tex',
      data: resultTex,
      favorite: false,
      tags: ['ai-transcribed', modeTag, useDemucs ? 'demucs' : 'raw'],
    });
  };

  /** Separate all 4 stems via Demucs and save to IndexedDB for offline playback. */
  const separateAllStems = async () => {
    if (!file || !backend) return;
    setSeparating(true);
    setSeparateProgress('');
    const songTitle = label || 'Sans titre';
    const stemTypes = ['vocals', 'drums', 'bass', 'other'] as const;
    try {
      for (let i = 0; i < stemTypes.length; i++) {
        const stem = stemTypes[i];
        setSeparateProgress(`Séparation ${stem} (${i + 1}/${stemTypes.length})...`);
        const blob = await separateStem(file, stem);
        // Estimate duration from blob size (WAV: 16-bit mono 22050Hz ≈ 44KB/s).
        const durationEstimate = blob.size / 44100;
        await saveStem(songTitle, stem, blob, durationEstimate);
      }
      setSeparateProgress(`✅ 4 stems sauvegardés pour "${songTitle}". Va dans Stems pour mixer.`);
    } catch (err) {
      console.error(err);
      setSeparateProgress(`❌ Erreur : ${err instanceof Error ? err.message : 'échec de la séparation'}`);
    } finally {
      setSeparating(false);
    }
  };

  const activeMode = MODES.find((m) => m.id === mode)!;

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="Transcrire"
        subtitle="Transforme n'importe quel audio en tablature. Tout tourne dans le navigateur — le fichier ne quitte pas ton appareil."
      />

      {/* Étape 1 — Choix du mode. Mode cards stay raw: the amber-bordered
          selection state + per-mode text colour can't be expressed as a
          single Button variant without bloating the primitive. */}
      <section className="mb-6">
        <SectionLabel className="mb-2 text-xs">1. Que veux-tu obtenir ?</SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              className={`p-4 rounded-lg border-2 text-left transition-colors ${
                mode === m.id
                  ? 'border-amp-accent bg-amp-accent/10'
                  : 'border-amp-border bg-amp-panel hover:border-amp-muted'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-2xl" aria-hidden="true">
                  {m.icon}
                </span>
                <span
                  className={`font-bold ${
                    mode === m.id ? 'text-amp-accent' : 'text-amp-text'
                  }`}
                >
                  {m.label}
                </span>
              </div>
              <p className="text-xs text-amp-muted">{m.hint}</p>
            </button>
          ))}
        </div>
      </section>

      {/* Étape 2 — Fichier audio. File input keeps its `file:` pseudo-element
          styling (not expressible via the Input primitive). */}
      <section className="mb-6">
        <SectionLabel className="mb-2 text-xs">2. Fichier audio</SectionLabel>
        <input
          type="file"
          accept="audio/*"
          onChange={handleFile}
          className="block w-full max-w-md text-amp-text file:bg-amp-accent file:hover:bg-amp-accent-hover file:text-amp-bg file:font-bold file:px-4 file:py-2 file:rounded file:border-0 file:cursor-pointer file:mr-3"
        />

        {/* YouTube import — requires the HF Space backend */}
        <div className="mt-3 max-w-md">
          <div className="text-xs text-amp-muted mb-1">
            Ou coller une URL YouTube (max 10 min) :
          </div>
          <div className="flex gap-2">
            <Input
              type="url"
              value={ytUrl}
              onChange={(e) => setYtUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              disabled={ytFetching || !backend}
              aria-label="URL YouTube"
              className="flex-1 px-3 py-2 text-sm font-mono disabled:opacity-50"
            />
            <Button
              onClick={importYoutube}
              disabled={!ytUrl.trim() || ytFetching || !backend}
              className="px-4 py-2 text-sm whitespace-nowrap"
            >
              {ytFetching ? '⏳…' : '📥 Importer'}
            </Button>
          </div>
          {!backend && (
            <div className="text-xs text-amp-muted mt-1">
              Backend requis — configure l'URL dans Réglages.
            </div>
          )}
        </div>

        {file && (
          <p className="mt-2 text-sm text-amp-muted">
            📄 {label} ({((file.size ?? 0) / 1024).toFixed(0)} KB)
          </p>
        )}
      </section>

      {/* Étape 3 — Options. Tuning + capo use the Select primitive; the
          Demucs panel below stays raw because its disabled border/opacity
          state depends on `backend` and is specific to this page. */}
      <section className="mb-6 max-w-md">
        <SectionLabel className="mb-2 text-xs">3. Options</SectionLabel>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="block text-xs text-amp-muted mb-1">Accordage</span>
            <Select
              value={tuning.id}
              onChange={(e) => setTuning(TUNINGS[e.target.value])}
              className="w-full text-sm"
            >
              {Object.values(TUNINGS).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="block text-xs text-amp-muted mb-1">Capodastre</span>
            <Select
              value={capo}
              onChange={(e) => setCapo(Number(e.target.value))}
              className="w-full text-sm"
            >
              {Array.from({ length: 13 }, (_, i) => (
                <option key={i} value={i}>
                  {i === 0 ? 'Aucun' : `Frette ${i}`}
                </option>
              ))}
            </Select>
          </label>
        </div>

        {/* Option Demucs */}
        <label
          className={`flex items-start gap-2 p-3 rounded border ${
            backend
              ? 'border-amp-border bg-amp-panel cursor-pointer hover:border-amp-muted'
              : 'border-amp-border bg-amp-panel opacity-60 cursor-not-allowed'
          }`}
        >
          <input
            type="checkbox"
            checked={useDemucs}
            disabled={!backend}
            onChange={(e) => setUseDemucs(e.target.checked)}
            className="mt-1 accent-amp-accent"
          />
          <div className="flex-1 text-xs">
            <div className="font-bold text-amp-text mb-0.5">
              🐍 Pré-traiter avec Demucs{' '}
              {mode === 'guitar'
                ? '(isoler le stem guitare)'
                : '(isoler la voix)'}
            </div>
            <div className="text-amp-muted">
              {backendChecking && 'Test du backend local…'}
              {!backendChecking && backend && (
                <>
                  Backend prêt ({backend.device.toUpperCase()} ·{' '}
                  {backend.default_model}). Meilleure qualité mais plus lent.
                </>
              )}
              {!backendChecking && !backend && (
                <>
                  Backend Demucs non joignable. Démarre{' '}
                  <code className="text-amp-accent">backend/server.py</code>{' '}
                  pour activer cette option.
                </>
              )}
            </div>
          </div>
        </label>
      </section>

      {/* Étape 4 — Lancement */}
      <section className="mb-6">
        <Button
          onClick={run}
          disabled={!file || running}
          className="px-6 py-3"
        >
          {running
            ? '⏳ Transcription en cours…'
            : `${activeMode.icon} Lancer la transcription`}
        </Button>

        {(running || progress > 0) && (
          <div className="mt-4 max-w-md">
            <div
              className="text-sm text-amp-muted mb-1"
              aria-live="polite"
              aria-atomic="true"
            >
              {status}
            </div>
            <div
              className="w-full bg-amp-panel rounded-full h-2 overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-label="Progression de la transcription"
            >
              <div
                className="bg-amp-accent h-full transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          </div>
        )}

        {error && (
          <ErrorStrip className="mt-4 max-w-md" role="alert">
            {error}
          </ErrorStrip>
        )}
      </section>

      {/* Résultat */}
      {resultTex && transcription && (
        <Card className="max-w-md mb-6">
          <h3 className="font-bold text-amp-success mb-2">
            ✅ Transcription prête
          </h3>
          <p className="text-sm text-amp-muted mb-3">
            {transcription.notes.length} notes ·{' '}
            {transcription.durationSeconds.toFixed(1)}s ·{' '}
            {transcription.tuning.name}
            {capo > 0 && ` · capo ${capo}`}
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={sendToViewer} className="px-4 py-2 text-sm">
              📖 Ouvrir dans le lecteur
            </Button>
            <Button
              variant="secondary"
              onClick={saveToLibrary}
              className="px-4 py-2"
            >
              💾 Sauvegarder dans la bibliothèque
            </Button>
          </div>
        </Card>
      )}

      {/* Stem separation (offline cache) */}
      {file && backend && !running && (
        <Card className="max-w-md">
          <h3 className="font-bold mb-2">🎛️ Séparer toutes les pistes</h3>
          <p className="text-xs text-amp-muted mb-3">
            Isole voix, batterie, basse et autres via Demucs. Les stems
            sont sauvegardés hors-ligne dans l'onglet Stems.
          </p>
          <Button
            variant="secondary"
            onClick={separateAllStems}
            disabled={separating}
            className="font-bold px-4 py-2"
          >
            {separating ? '⏳ Séparation en cours…' : '🎛️ Séparer les 4 stems'}
          </Button>
          {separateProgress && (
            <p className="mt-2 text-sm text-amp-muted">{separateProgress}</p>
          )}
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Pipelines par mode
// ─────────────────────────────────────────────────────────────────────────

/**
 * Transforme la sortie de basic-pitch en positions de frettes selon le mode.
 *
 * Convention des cordes dans tuning.strings : index 0 = corde 6 (mi grave),
 * index 5 = corde 1 (mi aigu). Donc :
 *   cordes basses 6/5/4 → indices [0..2]
 *   cordes aiguës 3/2/1 → indices [3..5]
 */
function runModePipeline(
  mode: Mode,
  notes: DetectedNote[],
  tuning: Tuning,
  costWeights?: import('../lib/midi-to-tab').FretCostWeights,
) {
  if (mode === 'guitar') {
    // Mode A — "Guitare réelle"
    // On garde toutes les notes dans le registre de la guitare (E2..E6) et
    // on laisse Viterbi choisir le meilleur doigté global sur les 6 cordes.
    const filtered = filterGuitarNotes(notes);
    return assignViterbi(filtered, tuning, costWeights);
  }

  // Mode B — "Chant + accords"
  // On sépare mélodie (voix haute) et basse, on place chacune sur sa propre
  // plage de cordes pour que Viterbi ne panique pas avec les sauts d'octave,
  // puis on fusionne les deux pistes par ordre chronologique.
  const { melody, bass } = extractMelodyAndAccompaniment(notes);
  const melodyTab = assignViterbi(
    melody,
    tuning,
    costWeights,
    [3, 5], // cordes 3-2-1 (aiguës) pour la mélodie chantée
  );
  const bassTab = assignViterbi(
    bass,
    tuning,
    costWeights,
    [0, 2], // cordes 6-5-4 (graves) pour la ligne de basse
  );
  return [...bassTab, ...melodyTab].sort(
    (a, b) => a.startTimeSeconds - b.startTimeSeconds,
  );
}
