/**
 * Web MIDI API controller — maps MIDI pedal/controller messages to app actions.
 *
 * Supports:
 *   - MIDI foot controllers (CC messages)
 *   - Note on/off for simple pedal switches
 *   - Configurable mappings stored in settings
 *
 * Usage:
 *   const midi = new MidiController();
 *   midi.onAction = (action) => { ... };
 *   await midi.connect();
 */

export type MidiAction =
  | 'play-pause'
  | 'stop'
  | 'loop-toggle'
  | 'speed-down'
  | 'speed-up'
  | 'next-bar'
  | 'prev-bar'
  | 'metronome-toggle';

export interface MidiMapping {
  /** MIDI CC number or note number. */
  number: number;
  /** Type of MIDI message. */
  type: 'cc' | 'note';
  /** Action to trigger. */
  action: MidiAction;
}

const DEFAULT_MAPPINGS: MidiMapping[] = [
  { number: 64, type: 'cc', action: 'play-pause' },    // Sustain pedal
  { number: 65, type: 'cc', action: 'loop-toggle' },    // Portamento
  { number: 66, type: 'cc', action: 'speed-down' },     // Sostenuto
  { number: 67, type: 'cc', action: 'speed-up' },       // Soft pedal
  { number: 60, type: 'note', action: 'play-pause' },   // C4
  { number: 62, type: 'note', action: 'loop-toggle' },  // D4
  { number: 64, type: 'note', action: 'speed-down' },   // E4
  { number: 65, type: 'note', action: 'speed-up' },     // F4
];

export class MidiController {
  private access: MIDIAccess | null = null;
  private mappings: MidiMapping[] = DEFAULT_MAPPINGS;
  onAction: ((action: MidiAction) => void) | null = null;
  onDeviceChange: ((devices: string[]) => void) | null = null;

  get isSupported(): boolean {
    return 'requestMIDIAccess' in navigator;
  }

  async connect(): Promise<string[]> {
    if (!this.isSupported) return [];

    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.refreshInputs();
    return this.refreshInputs();
  }

  disconnect(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = null;
    }
    this.access = null;
  }

  setMappings(mappings: MidiMapping[]): void {
    this.mappings = mappings;
  }

  getDevices(): string[] {
    if (!this.access) return [];
    return Array.from(this.access.inputs.values()).map(
      (input) => input.name ?? 'Unknown MIDI device',
    );
  }

  private refreshInputs(): string[] {
    if (!this.access) return [];

    const devices: string[] = [];
    for (const input of this.access.inputs.values()) {
      devices.push(input.name ?? 'Unknown');
      input.onmidimessage = (e) => this.handleMessage(e);
    }

    this.onDeviceChange?.(devices);
    return devices;
  }

  private handleMessage(event: MIDIMessageEvent): void {
    if (!event.data || event.data.length < 3) return;

    const status = event.data[0] & 0xf0;
    const number = event.data[1];
    const value = event.data[2];

    // CC message (status 0xB0).
    if (status === 0xb0 && value > 63) {
      const mapping = this.mappings.find(
        (m) => m.type === 'cc' && m.number === number,
      );
      if (mapping) this.onAction?.(mapping.action);
    }

    // Note On (status 0x90, velocity > 0).
    if (status === 0x90 && value > 0) {
      const mapping = this.mappings.find(
        (m) => m.type === 'note' && m.number === number,
      );
      if (mapping) this.onAction?.(mapping.action);
    }
  }
}
