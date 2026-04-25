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
  wakeBackend,
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
  /** Metadata pré-remplie lorsqu'on arrive ici depuis un résultat Songsterr
   *  qu'on n'a pas pu télécharger (fallback Transcrire). On pré-remplit le
   *  `label` et on propose une recherche YouTube ciblée. */
  initialSearch?: { title: string; artist: string };
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

export function Transcriber({
  initialAudio,
  initialSearch,
  onTabReady,
}: TranscriberProps) {
  // Entrée. `label` is seeded from `initialAudio` first (explicit blob),
  // then `initialSearch` (outbound from TabSearch). If both are set, the
  // audio wins because the user has already provided real content.
  const [file, setFile] = useState<File | Blob | null>(
    initialAudio?.blob ?? null,
  );
  const [label, setLabel] = useState(
    initialAudio?.label
      ?? (initialSearch
        ? `${initialSearch.artist} - ${initialSearch.title}`
        : ''),
  );

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

  // Pipeline "Tout faire" state — chains yt-dlp → Demucs → basic-pitch.
  // Kept separate from `running` so progress/status UI can be reused cleanly.
  const [pipelining, setPipelining] = useState(false);

  // Cold-start handling for the HF Space (free tier sleeps after 48h).
  // `wakingUp` toggles the spinner; `wakeElapsedSec` is shown in the button
  // so the user sees the wake actually progressing rather than a frozen UI.
  const [wakingUp, setWakingUp] = useState(false);
  const [wakeElapsedSec, setWakeElapsedSec] = useState(0);

  const handleWakeBackend = async () => {
    setWakingUp(true);
    setWakeElapsedSec(0);
    try {
      const health = await wakeBackend((elapsedMs) => {
        setWakeElapsedSec(Math.round(elapsedMs / 1000));
      });
      if (health) {
        setBackend(health);
        toast.success(`Backend réveillé (${health.device.toUpperCase()}).`);
      } else {
        toast.error('Le backend n\'a pas répondu après 90 secondes. Réessaye dans quelques instants.');
      }
    } finally {
      setWakingUp(false);
      setWakeElapsedSec(0);
    }
  };

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
      // Most YT failures hit YouTube's anti-bot wall on cloud IPs (see
      // the <details> block in the JSX). Append a nudge to the toast so
      // users find the workaround without needing to scroll/scan the page.
      toast.error(
        `${(err as Error).message} — astuce : utilise yt-dlp en local pour récupérer le MP3 (voir le panneau « 💡 L'import YouTube a échoué ? » sous le champ).`,
      );
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

  // Propagation d'une recherche Songsterr vers ce panneau — on pré-remplit
  // uniquement le libellé (pas de blob à ce stade). Ne clobbe pas un blob
  // déjà chargé par l'utilisateur.
  useEffect(() => {
    if (initialSearch && !initialAudio) {
      setLabel(`${initialSearch.artist} - ${initialSearch.title}`);
    }
  }, [initialSearch, initialAudio]);

  /** Recherche YouTube ciblée — ouvre la page des résultats dans un nouvel
   *  onglet pour que l'utilisateur copie une URL de vidéo. `+ audio` biaise
   *  les résultats vers une version "clean" du morceau (moins de live/cover). */
  const openYoutubeSearchFor = (title: string, artist: string) => {
    const q = encodeURIComponent(`${artist} ${title} audio`);
    window.open(
      `https://www.youtube.com/results?search_query=${q}`,
      '_blank',
      'noopener,noreferrer',
    );
  };

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
    const tabTitle = label || 'Transcription';
    await addTabToLibrary({
      title: tabTitle,
      artist: mode === 'guitar' ? 'Transcrit (IA)' : 'Arrangé (IA)',
      kind,
      format: 'tex',
      data: resultTex,
      favorite: false,
      tags: ['ai-transcribed', modeTag, useDemucs ? 'demucs' : 'raw'],
    });
    // Mirror the pipeline's "where it lands" cue — without the toast the
    // only feedback was the button briefly flickering, leaving the user
    // wondering whether the save actually happened.
    toast.success(`« ${tabTitle} » sauvée dans 📚 Bibliothèque.`);
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

  /**
   * "Tout faire" — end-to-end pipeline from YouTube URL (or local file) to
   * a fully transcribed tab + 4 offline stems, all saved to IndexedDB.
   *
   * Progress budget:
   *   0–15%  : yt-dlp download (or skipped if a local file is already set)
   *   15–70% : Demucs — 4 stems saved to IndexedDB (~13.75% each)
   *   70–72% : audio decode + resample on the isolated stem
   *   72–97% : basic-pitch polyphonic note detection
   *   97–100%: Viterbi fret placement + alphaTex + library save
   *
   * Stem selection for basic-pitch input:
   *   • mode='guitar'       → 'other'  (htdemucs lumps guitars+piano here)
   *   • mode='vocal-chords' → 'vocals' (clean isolated voice)
   * This dodges the htdemucs_6s requirement and gives basic-pitch a much
   * cleaner signal than the raw mix.
   */
  const runFullPipeline = async () => {
    if (!backend) {
      toast.error('Backend requis pour le pipeline complet.');
      return;
    }
    if (!ytUrl.trim() && !file) {
      toast.error('Colle une URL YouTube ou choisis un fichier audio.');
      return;
    }

    setError(null);
    setResultTex(null);
    setTranscription(null);
    setPipelining(true);
    setProgress(0);

    try {
      let inputBlob: Blob = file!;
      let inputLabel = label;
      // Capture the YT URL before we clear the input — we'll persist it as
      // sourceUrl on the saved tab so the user can re-find the original.
      let sourceYtUrl: string | undefined;

      // Step 1 — fetch YouTube audio (skipped if we already have a file).
      if (ytUrl.trim()) {
        sourceYtUrl = ytUrl.trim();
        setProgress(0.03);
        setStatus('📥 Téléchargement YouTube (yt-dlp)…');
        const yt = await fetchYoutubeAudio(sourceYtUrl);
        inputBlob = yt.blob;
        inputLabel = yt.title;
        setFile(yt.blob);
        setLabel(yt.title);
        setYtUrl('');
        setProgress(0.15);
        setStatus(`✅ Audio récupéré : ${yt.title}`);
      }

      const songTitle = inputLabel || 'Pipeline sans titre';

      // Step 2 — Demucs, 4 stems, saved to IndexedDB as we go.
      const stemTypes = ['vocals', 'drums', 'bass', 'other'] as const;
      const stemBlobs: Partial<Record<(typeof stemTypes)[number], Blob>> = {};
      for (let i = 0; i < stemTypes.length; i++) {
        const stem = stemTypes[i];
        const baseProgress = 0.15 + (i / stemTypes.length) * 0.55;
        setProgress(baseProgress);
        setStatus(`🐍 Demucs — stem ${stem} (${i + 1}/${stemTypes.length})…`);
        const blob = await separateStem(inputBlob, stem);
        stemBlobs[stem] = blob;
        const durationEstimate = blob.size / 44100;
        await saveStem(songTitle, stem, blob, durationEstimate);
      }
      setProgress(0.7);
      setStatus('✅ 4 stems sauvegardés hors-ligne.');

      // Step 3 — pick the cleanest stem for basic-pitch and decode it.
      const transcriptionSource =
        mode === 'guitar' ? stemBlobs.other : stemBlobs.vocals;
      if (!transcriptionSource) {
        throw new Error('Stem source introuvable pour la transcription.');
      }
      setProgress(0.71);
      setStatus(
        `Décodage du stem "${mode === 'guitar' ? 'other' : 'vocals'}"…`,
      );
      const audioBuffer = await decodeAndResample(transcriptionSource, 22050);

      // Step 4 — basic-pitch. Map its 0..1 progress into our 72..97% slice.
      const detected = await transcribeAudio(
        audioBuffer,
        undefined,
        ({ progress: p, status: s }) => {
          setProgress(0.72 + p * 0.25);
          setStatus(s);
        },
      );

      // Step 5 — Viterbi fret placement + tempo + alphaTex.
      setProgress(0.97);
      setStatus('Placement des notes sur le manche…');
      const effectiveTuning = applyCapo(tuning, capo);
      const { costWeights } = getSettings();
      const tabNotes = runModePipeline(
        mode,
        detected,
        effectiveTuning,
        costWeights,
      );

      if (tabNotes.length === 0) {
        throw new Error(
          `Aucune note détectée dans le stem "${
            mode === 'guitar' ? 'other' : 'vocals'
          }". Essaie en mode brut sans pipeline.`,
        );
      }

      const { bpm: detectedBpm, confidence: tempoConf } = detectTempo(detected);
      const tempoBpm = tempoConf > 0.2 ? detectedBpm : 120;

      const transcriptionData: Transcription = {
        notes: tabNotes,
        tuning: effectiveTuning,
        capo,
        durationSeconds: audioBuffer.duration,
        tempoBpm,
      };
      setTranscription(transcriptionData);

      const modeLabel = mode === 'guitar' ? 'Guitare réelle' : 'Chant+accords';
      const alphaTex = transcriptionToAlphaTex(
        transcriptionData,
        songTitle,
        modeLabel,
      );
      setResultTex(alphaTex);

      // Step 6 — auto-save to library. The pipeline always lands in the lib
      // (unlike the manual `run` which leaves saving to the user) because
      // running 5 minutes of compute without persisting would be cruel.
      setProgress(0.99);
      setStatus('Sauvegarde dans la bibliothèque…');
      const kind = mode === 'guitar' ? 'generated' : 'cover';
      const modeTag = mode === 'guitar' ? 'guitare-reelle' : 'chant-accords';
      await addTabToLibrary({
        title: songTitle,
        artist: mode === 'guitar' ? 'Transcrit (IA)' : 'Arrangé (IA)',
        kind,
        format: 'tex',
        data: alphaTex,
        favorite: false,
        tags: ['ai-transcribed', modeTag, 'pipeline', 'demucs'],
        sourceUrl: sourceYtUrl,
      });

      setProgress(1);
      setStatus(
        `🎉 Pipeline terminé : ${tabNotes.length} notes · 4 stems · ${tempoBpm} BPM.`,
      );
      toast.success(`Pipeline OK — "${songTitle}" est dans la bibliothèque.`);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : 'Erreur pendant le pipeline.',
      );
    } finally {
      setPipelining(false);
    }
  };

  const activeMode = MODES.find((m) => m.id === mode)!;

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="Transcrire"
        subtitle="Transforme n'importe quel audio en tablature. Tout tourne dans le navigateur — le fichier ne quitte pas ton appareil."
      />

      {/* Fallback banner — user arrived here from a Songsterr result we
          couldn't download. We pre-filled the label and we hand them a
          one-click YouTube search so they can grab a URL quickly. */}
      {initialSearch && !initialAudio && !file && (
        <Card className="mb-6 max-w-2xl border-amp-accent/40">
          <h3 className="font-bold mb-1">
            🔁 Transcrire « {initialSearch.artist} — {initialSearch.title} »
          </h3>
          <p className="text-xs text-amp-muted mb-3">
            Songsterr ne laisse plus télécharger le fichier Guitar Pro pour
            cette chanson. Ouvre YouTube ci-dessous, copie l'URL d'une bonne
            version, colle-la dans le champ «&nbsp;URL YouTube&nbsp;» (étape 2)
            et clique «&nbsp;🚀 Tout faire&nbsp;». OmniTab construira un tab en
            ~5&nbsp;min.
          </p>
          <Button
            variant="secondary"
            onClick={() =>
              openYoutubeSearchFor(initialSearch.title, initialSearch.artist)
            }
          >
            🔍 Chercher « {initialSearch.title} » sur YouTube
          </Button>
        </Card>
      )}

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

        {/* YouTube import — requires the HF Space backend.
            NOTE: as of April 2026 YouTube actively blocks the HF Space's
            shared-IP TLS handshake (SSL: UNEXPECTED_EOF), so this path
            fails *most of the time* on free HF infra. We keep it here
            because (a) it works when YouTube's anti-bot sleeps, and
            (b) self-hosters with their own backend (see vps/) get a
            reliable fast path. The collapsible panel below documents
            the always-works browser workaround for everyone else. */}
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
          {!backend && !backendChecking && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-amp-muted">
              <span>
                Backend assoupi (le HF Space gratuit dort après 48h).
              </span>
              <Button
                variant="secondary"
                onClick={handleWakeBackend}
                disabled={wakingUp}
                className="px-3 py-1 text-xs"
              >
                {wakingUp
                  ? `⏳ Réveil… ${wakeElapsedSec}s`
                  : '🔌 Réveiller le backend'}
              </Button>
            </div>
          )}

          {/* Always-works fallback. YouTube blocks our cloud backend at the
              TLS layer in 2025-2026, and the public converters that used
              to work (cobalt.tools etc.) have all disabled YouTube too
              for the same reason. The only thing that reliably works is
              yt-dlp running on the user's OWN machine — residential IP,
              real TLS fingerprint, not blocked. We list two paths:
                a) yt-dlp (one command, bulletproof, dev-friendly)
                b) consumer YT-to-MP3 sites (work today, may break tomorrow)
              Collapsed by default so successful users never see it. */}
          <details className="mt-2 rounded border border-amp-accent/30 bg-amp-accent/5 px-3 py-2 text-xs">
            <summary className="cursor-pointer font-semibold text-amp-accent">
              💡 L'import YouTube a échoué ? Clique pour la solution
            </summary>
            <div className="mt-2 space-y-3 text-amp-muted">
              <p>
                YouTube bloque tous les services cloud au niveau TLS depuis
                2025 — notre backend, cobalt.tools, Piped, Invidious, tous
                touchés. Le seul truc qui marche de façon fiable, c'est{' '}
                <strong className="text-amp-text">yt-dlp lancé sur ta
                machine</strong> (ton IP résidentielle n'est pas blacklistée).
              </p>

              <div>
                <div className="font-semibold text-amp-text mb-1">
                  Option A — yt-dlp (recommandé, ~30s setup une fois pour
                  toutes)
                </div>
                <ol className="ml-4 list-decimal space-y-1">
                  <li>
                    Télécharge{' '}
                    <a
                      href="https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-amp-accent underline hover:no-underline"
                    >
                      yt-dlp.exe
                    </a>{' '}
                    (Windows, ~15 MB) — ou{' '}
                    <code className="rounded bg-amp-bg/50 px-1">
                      brew install yt-dlp
                    </code>{' '}
                    sur Mac,{' '}
                    <code className="rounded bg-amp-bg/50 px-1">
                      pip install yt-dlp
                    </code>{' '}
                    partout
                  </li>
                  <li>
                    Lance dans un terminal :{' '}
                    <code className="block mt-1 rounded bg-amp-bg/50 p-2 font-mono text-amp-text">
                      yt-dlp -x --audio-format mp3 "URL_YOUTUBE_ICI"
                    </code>
                  </li>
                  <li>
                    Tu obtiens un MP3 dans le dossier courant — clique
                    « Choose File » ci-dessus pour le charger
                  </li>
                </ol>
              </div>

              <div>
                <div className="font-semibold text-amp-text mb-1">
                  Option B — Convertisseur en ligne (rapide mais fragile)
                </div>
                <p>
                  Cherche{' '}
                  <a
                    href="https://www.google.com/search?q=youtube+to+mp3"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-amp-accent underline hover:no-underline"
                  >
                    « youtube to mp3 »
                  </a>{' '}
                  et essaie un site (ytmp3.cc, yt5s.com, ssyoutube.com…).
                  Ces sites changent souvent — si le premier essayé ne
                  marche pas, prends le suivant dans les résultats. Attention
                  aux pubs/popups, ne télécharge rien d'autre que le MP3.
                </p>
              </div>

              <p className="text-amp-muted/80">
                Le reste du pipeline OmniTab (Demucs + basic-pitch) tourne
                sans problème — c'est uniquement l'étape YouTube qui est
                bloquée.
              </p>
            </div>
          </details>
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
                  Backend Demucs assoupi (HF Space gratuit). Utilise le bouton{' '}
                  <strong>« Réveiller le backend »</strong> ci-dessus, puis
                  recoche cette case.
                </>
              )}
            </div>
          </div>
        </label>
      </section>

      {/* Étape 4 — Lancement */}
      <section className="mb-6">
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={run}
            disabled={!file || running || pipelining}
            className="px-6 py-3"
          >
            {running
              ? '⏳ Transcription en cours…'
              : `${activeMode.icon} Lancer la transcription`}
          </Button>

          {/* End-to-end pipeline — only shown when the Demucs backend is
              reachable, since the whole point is to leverage stem separation. */}
          {backend && (
            <Button
              onClick={runFullPipeline}
              disabled={
                (!ytUrl.trim() && !file) || pipelining || running
              }
              className="px-6 py-3"
            >
              {pipelining
                ? '⏳ Pipeline en cours…'
                : '🚀 Tout faire (audio → stems + tab)'}
            </Button>
          )}
        </div>

        {backend && (
          <p className="mt-2 text-xs text-amp-muted max-w-md">
            <strong>Tout faire</strong> chaîne YouTube/fichier → Demucs (4 stems
            hors-ligne) → basic-pitch sur le stem le plus propre → tab sauvée
            dans la bibliothèque.
          </p>
        )}

        {(running || pipelining || progress > 0) && (
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
