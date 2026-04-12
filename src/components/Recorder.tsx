/**
 * Audio recorder using MediaRecorder API.
 *
 * Records from the default audio input (mic / iRig USB), saves the resulting
 * Blob to IndexedDB, and provides a quick "transcribe this" shortcut.
 */

import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { requestMicStream } from '../lib/audio-engine';
import {
  saveRecording,
  getAllRecordings,
  deleteRecording,
} from '../lib/db';

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

  const recordings = useLiveQuery(getAllRecordings);

  useEffect(() => () => stopAndCleanup(), []);

  const stopAndCleanup = () => {
    if (intervalRef.current != null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setRecording(false);
  };

  const start = async () => {
    setError(null);
    try {
      const stream = await requestMicStream();
      streamRef.current = stream;

      // Pick the first MIME type the browser supports — webm/opus is universal
      // on Chromium, audio/mp4 works on Safari iOS.
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
      <h2 className="text-2xl font-bold mb-2">Enregistrer</h2>
      <p className="text-amp-muted text-sm mb-6">
        Enregistre via l'iRig pour ensuite transcrire automatiquement en tab.
      </p>

      {/* Big record button */}
      <div className="flex flex-col items-center bg-amp-panel border border-amp-border rounded-lg p-8 mb-6">
        <div className="text-5xl font-mono mb-4">
          {recording ? '🔴' : '⚪'} {formatTime(elapsed)}
        </div>
        {!recording ? (
          <button
            onClick={start}
            className="bg-amp-error hover:bg-red-600 text-white font-bold px-8 py-3 rounded-full text-lg transition-colors"
          >
            ● REC
          </button>
        ) : (
          <button
            onClick={stop}
            className="bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-8 py-3 rounded-full text-lg transition-colors"
          >
            ⏹ STOP
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-amp-error/20 border border-amp-error rounded text-amp-error text-sm">
          {error}
        </div>
      )}

      {/* Recording list */}
      <h3 className="text-lg font-bold mb-3">Mes enregistrements</h3>
      {!recordings ? (
        <p className="text-amp-muted">Chargement…</p>
      ) : recordings.length === 0 ? (
        <p className="text-amp-muted">Aucun enregistrement.</p>
      ) : (
        <ul className="space-y-2">
          {recordings.map((rec) => (
            <li
              key={rec.id}
              className="bg-amp-panel border border-amp-border rounded p-3 flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{rec.name}</div>
                <div className="text-sm text-amp-muted">
                  {formatTime(rec.durationSeconds)} ·{' '}
                  {(rec.blob.size / 1024).toFixed(0)} KB
                </div>
              </div>
              <audio
                controls
                src={URL.createObjectURL(rec.blob)}
                className="h-8"
              />
              <button
                onClick={() => onTranscribe(rec.blob, rec.name)}
                className="bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-3 py-1.5 rounded text-sm transition-colors"
              >
                🤖 Transcrire
              </button>
              <button
                onClick={() => rec.id != null && deleteRecording(rec.id)}
                className="text-amp-muted hover:text-amp-error transition-colors"
                aria-label="Supprimer"
              >
                🗑️
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
