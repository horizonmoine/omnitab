/**
 * App-level input router: keeps MIDI + Voice active across page navigation.
 *
 * Singletons that:
 *   - Bridge MIDI controller actions → appBus actions
 *   - Bridge voice commands → appBus actions + page navigation
 *   - Persist enable/disable state in IndexedDB settings
 *
 * Components call `ensureMidiStarted()` / `ensureVoiceStarted()` from a
 * user-gesture handler (e.g. Settings toggle). Stopping releases hardware
 * access.
 */

import { MidiController, type MidiAction } from './midi-controller';
import { VoiceCommandEngine, type VoiceAction } from './voice-commands';
import { appBus, type AppAction } from './event-bus';

const MIDI_TO_APP: Record<MidiAction, AppAction> = {
  'play-pause': 'play-pause',
  'stop': 'stop',
  'loop-toggle': 'loop-toggle',
  'speed-down': 'speed-down',
  'speed-up': 'speed-up',
  'next-bar': 'next-bar',
  'prev-bar': 'prev-bar',
  'metronome-toggle': 'metronome-toggle',
};

const VOICE_TO_APP: Record<VoiceAction, AppAction> = {
  'play': 'play-pause',
  'pause': 'play-pause',
  'stop': 'stop',
  'loop': 'loop-toggle',
  'speed-down': 'speed-down',
  'speed-up': 'speed-up',
  'amp-clean': 'amp-clean',
  'amp-crunch': 'amp-crunch',
  'amp-lead': 'amp-lead',
  'tuner': 'navigate-tuner',
  'metronome': 'navigate-metronome',
};

let midi: MidiController | null = null;
let voice: VoiceCommandEngine | null = null;

export interface InputRouterStatus {
  midiConnected: boolean;
  midiDevices: string[];
  voiceListening: boolean;
}

const listeners = new Set<(s: InputRouterStatus) => void>();

function status(): InputRouterStatus {
  return {
    midiConnected: midi !== null,
    midiDevices: midi?.getDevices() ?? [],
    voiceListening: voice?.isListening ?? false,
  };
}

function notify() {
  const s = status();
  for (const fn of listeners) fn(s);
}

export function subscribeInputRouter(fn: (s: InputRouterStatus) => void): () => void {
  listeners.add(fn);
  fn(status());
  return () => { listeners.delete(fn); };
}

export function getInputRouterStatus(): InputRouterStatus {
  return status();
}

export async function startMidi(): Promise<string[]> {
  if (midi) return midi.getDevices();

  const ctrl = new MidiController();
  if (!ctrl.isSupported) throw new Error('Web MIDI non supporté');

  ctrl.onAction = (action: MidiAction) => {
    appBus.emit(MIDI_TO_APP[action]);
  };
  ctrl.onDeviceChange = () => notify();

  const devices = await ctrl.connect();
  midi = ctrl;
  notify();
  return devices;
}

export function stopMidi(): void {
  midi?.disconnect();
  midi = null;
  notify();
}

export function startVoice(): boolean {
  if (voice?.isListening) return true;

  const engine = new VoiceCommandEngine();
  if (!engine.isSupported) return false;

  engine.onAction = (action: VoiceAction) => {
    appBus.emit(VOICE_TO_APP[action]);
  };

  const ok = engine.start();
  if (ok) {
    voice = engine;
    notify();
  }
  return ok;
}

export function stopVoice(): void {
  voice?.stop();
  voice = null;
  notify();
}
