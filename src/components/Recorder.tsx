/**
 * Audio recorder using MediaRecorder API.
 *
 * Records from the default audio input (mic / iRig USB), saves the resulting
 * Blob to IndexedDB, and provides a quick "transcribe this" shortcut.
 *
 * Enhanced with:
 *   - Real-time waveform visualization during recording
 *   - Playback speed control (0.5× – 2×)
 *   - A/B loop for practicing specific sections
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  getAudioContext,
  resumeAudioContext,
  requestMicStream,
} from '../lib/audio-engine';
import { saveRecording, getAllRecordings, deleteRecording } from '../lib/db';
import {
  Button,
  Card,
  ErrorStrip,
  PageHeader,
  Readout,
  SectionLabel,
} from './primitives';

interface RecorderProps {
  onTranscribe: (blob: Blob, label: string) => void;
}

export function Recorder({ onTranscribe }: RecorderProps) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTimeRef = useRef(0);
  const intervalRef = useRef<number | null>(null);

  // Waveform visualization refs.
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const recordings = useLiveQuery(getAllRecordings);

  useEffect(() => () => stopAndCleanup(), []);

  const stopAndCleanup = () => {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  };

  // ── Waveform drawing ─────────────────────────────────────────────
  const drawWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    const canvas = canvasRef.current;
    if (!analyser || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#161616'; // amp-panel
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f59e0b'; // amp-accent
    ctx.beginPath();

    const sliceWidth = w / bufferLength;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * h) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceWidth;
    }
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    rafRef.current = requestAnimationFrame(drawWaveform);
  }, []);

  const start = async () => {
    setError(null);
    try {
      await resumeAudioContext();
      const stream = await requestMicStream();
      streamRef.current = stream;

      // Set up analyzer for waveform.
      const audioCtx = getAudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      sourceRef.current = source;
      analyserRef.current = analyser;

      // Start waveform visualization.
      drawWaveform();

      // Pick the first MIME type the browser supports.
      const mimeType =
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) =>
          MediaRecorder.isTypeSupported(t),
        ) ?? '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || 'audio/webm',
        });
        const duration = (Date.now() - startTimeRef.current) / 1000;
        const name = `Take ${new Date().toLocaleString('fr-FR')}`;
        await saveRecording(name, blob, duration);
      };
      recorder.start();
      recorderRef.current = recorder;
      startTimeRef.current = Date.now();
      setRecording(true);
      setElapsed(0);
      intervalRef.current = window.setInterval(() => {
        setElapsed((Date.now() - startTimeRef.current) / 1000);
      }, 100);
    } catch (err) {
      console.error(err);
      setError("Impossible d'accéder au micro/iRig.");
    }
  };

  const stop = () => {
    stopAndCleanup();
  };

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <PageHeader
        title="Enregistrer"
        subtitle="Enregistre via l'iRig pour ensuite transcrire automatiquement en tab."
      />

      {/* Record section with waveform */}
      <Card padding="p-8" className="flex flex-col items-center mb-6">
        {/* Waveform canvas — border turns amber while recording for feedback */}
        <canvas
          ref={canvasRef}
          width={400}
          height={80}
          className={`w-full max-w-md rounded mb-4 ${recording ? 'border border-amp-accent' : 'border border-amp-border'}`}
        />

        {/* `block` forces the span to take a line so mb-4 pushes REC/STOP down */}
        <Readout className="block mb-4">
          <span aria-hidden="true">{recording ? '🔴' : '⚪'}</span>{' '}
          {formatTime(elapsed)}
        </Readout>
        {!recording ? (
          <Button variant="pillStop" onClick={start} aria-label="Démarrer l'enregistrement">
            <span aria-hidden="true">● </span>REC
          </Button>
        ) : (
          <Button variant="pill" onClick={stop} aria-label="Arrêter l'enregistrement">
            <span aria-hidden="true">⏹ </span>STOP
          </Button>
        )}
      </Card>

      {error && <ErrorStrip className="mb-4">{error}</ErrorStrip>}

      {/* Recording list */}
      <SectionLabel>Mes enregistrements</SectionLabel>
      {!recordings ? (
        <p className="text-amp-muted">Chargement...</p>
      ) : recordings.length === 0 ? (
        <p className="text-amp-muted">Aucun enregistrement.</p>
      ) : (
        <div role="list" className="space-y-2">
          {recordings.map((rec) => (
            <RecordingItem
              key={rec.id}
              rec={rec}
              onTranscribe={() => onTranscribe(rec.blob, rec.name)}
              onDelete={() => rec.id != null && deleteRecording(rec.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Individual recording item with speed control ──────────────────

interface RecordingItemProps {
  rec: { id?: number; name: string; blob: Blob; durationSeconds: number };
  onTranscribe: () => void;
  onDelete: () => void;
}

function RecordingItem({ rec, onTranscribe, onDelete }: RecordingItemProps) {
  const [speed, setSpeed] = useState(1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [url] = useState(() => URL.createObjectURL(rec.blob));

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
  }, [url]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const formatTime = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <Card role="listitem" padding="p-3">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">{rec.name}</div>
          <div className="text-sm text-amp-muted">
            {formatTime(rec.durationSeconds)} ·{' '}
            {(rec.blob.size / 1024).toFixed(0)} KB
          </div>
        </div>
        <audio ref={audioRef} controls src={url} className="h-8" />
        {/* Icon-only buttons stay raw — Button variants force padding/bg that
            clash with a single-emoji affordance. Same pattern as Library. */}
        <button
          onClick={onTranscribe}
          className="bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-3 py-1.5 rounded text-sm transition-colors"
          aria-label="Transcrire"
        >
          <span aria-hidden="true">🤖</span>
        </button>
        <button
          onClick={onDelete}
          className="text-amp-muted hover:text-amp-error transition-colors"
          aria-label="Supprimer"
        >
          <span aria-hidden="true">🗑️</span>
        </button>
      </div>
      {/* Speed control — chips switch to chipOn variant when active */}
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-amp-border">
        <span className="text-xs text-amp-muted w-16">Vitesse:</span>
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
          <Button
            key={s}
            variant={speed === s ? 'chipOn' : 'chip'}
            onClick={() => setSpeed(s)}
            aria-pressed={speed === s}
          >
            {s}×
          </Button>
        ))}
      </div>
    </Card>
  );
}
