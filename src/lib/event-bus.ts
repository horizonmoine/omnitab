/**
 * Global event bus for app-wide actions (MIDI, voice, keyboard shortcuts).
 *
 * Why: MIDI pedals and voice commands need to reach ANY active page.
 * A dedicated bus decouples input sources (MIDI/voice) from handlers
 * (TabViewer, SpeedTrainer, AmpSim) — no prop drilling, no context.
 *
 * Usage (emit):
 *   import { appBus } from './event-bus';
 *   appBus.emit('play-pause');
 *
 * Usage (listen, typically in a useEffect):
 *   const off = appBus.on('play-pause', () => playPause());
 *   return off; // cleanup
 */

export type AppAction =
  | 'play-pause'
  | 'stop'
  | 'loop-toggle'
  | 'speed-down'
  | 'speed-up'
  | 'next-bar'
  | 'prev-bar'
  | 'metronome-toggle'
  | 'amp-clean'
  | 'amp-crunch'
  | 'amp-lead'
  | 'navigate-tuner'
  | 'navigate-metronome'
  | 'navigate-viewer';

type Handler = () => void;

class EventBus {
  private handlers = new Map<AppAction, Set<Handler>>();

  on(action: AppAction, handler: Handler): () => void {
    let set = this.handlers.get(action);
    if (!set) {
      set = new Set();
      this.handlers.set(action, set);
    }
    set.add(handler);
    return () => { set!.delete(handler); };
  }

  emit(action: AppAction): void {
    const set = this.handlers.get(action);
    if (!set) return;
    for (const handler of set) {
      try { handler(); } catch (err) {
        console.warn(`[event-bus] handler for ${action} threw:`, err);
      }
    }
  }

  /** Debug helper — list all active subscriptions. */
  listSubscriptions(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [action, set] of this.handlers) {
      out[action] = set.size;
    }
    return out;
  }
}

export const appBus = new EventBus();
