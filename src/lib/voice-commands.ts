/**
 * Voice command engine — uses Web Speech API for hands-free control.
 *
 * Supports French commands:
 *   "joue" / "lecture" → play
 *   "pause" / "stop" → pause/stop
 *   "boucle" → toggle loop
 *   "ralentis" / "plus lent" → speed down
 *   "accélère" / "plus vite" → speed up
 *   "clean" / "crunch" / "drive" / "disto" → amp voicing change
 *   "accorde" → open tuner
 *
 * Falls back gracefully when SpeechRecognition is unavailable.
 */

export type VoiceAction =
  | 'play'
  | 'pause'
  | 'stop'
  | 'loop'
  | 'speed-down'
  | 'speed-up'
  | 'amp-clean'
  | 'amp-crunch'
  | 'amp-lead'
  | 'tuner'
  | 'metronome';

interface CommandPattern {
  keywords: string[];
  action: VoiceAction;
}

const COMMANDS: CommandPattern[] = [
  { keywords: ['joue', 'lecture', 'play', 'lance'], action: 'play' },
  { keywords: ['pause', 'arrête', 'stop'], action: 'pause' },
  { keywords: ['boucle', 'loop', 'répète'], action: 'loop' },
  { keywords: ['ralentis', 'plus lent', 'slower'], action: 'speed-down' },
  { keywords: ['accélère', 'plus vite', 'faster'], action: 'speed-up' },
  { keywords: ['clean', 'clair'], action: 'amp-clean' },
  { keywords: ['crunch'], action: 'amp-crunch' },
  { keywords: ['drive', 'disto', 'distorsion', 'lead'], action: 'amp-lead' },
  { keywords: ['accorde', 'tuner', 'accordeur'], action: 'tuner' },
  { keywords: ['métronome', 'metronome', 'tempo'], action: 'metronome' },
];

/* eslint-disable @typescript-eslint/no-explicit-any */

export class VoiceCommandEngine {
  private recognition: any = null;
  private _isListening = false;

  onAction: ((action: VoiceAction) => void) | null = null;
  onTranscript: ((text: string) => void) | null = null;
  onError: ((error: string) => void) | null = null;

  get isSupported(): boolean {
    return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
  }

  get isListening(): boolean {
    return this._isListening;
  }

  start(): boolean {
    if (!this.isSupported) return false;
    if (this._isListening) return true;

    const Ctor =
      (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition;

    if (!Ctor) return false;

    const recognition = new Ctor();
    recognition.lang = 'fr-FR';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        const transcript = event.results[i][0].transcript.toLowerCase().trim();
        this.onTranscript?.(transcript);
        this.processTranscript(transcript);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.onError?.(event.error);
    };

    recognition.onend = () => {
      // Auto-restart if we're still supposed to be listening.
      if (this._isListening) {
        try { recognition.start(); } catch { /* already started */ }
      }
    };

    this.recognition = recognition;
    this._isListening = true;

    try {
      recognition.start();
    } catch {
      this._isListening = false;
      return false;
    }

    return true;
  }

  stop(): void {
    this._isListening = false;
    try {
      this.recognition?.stop();
    } catch { /* not started */ }
    this.recognition = null;
  }

  private processTranscript(text: string): void {
    for (const cmd of COMMANDS) {
      if (cmd.keywords.some((kw) => text.includes(kw))) {
        this.onAction?.(cmd.action);
        return;
      }
    }
  }
}
