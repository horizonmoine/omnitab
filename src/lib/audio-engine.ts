/**
 * Web Audio engine — shared AudioContext + helpers for:
 *   - Microphone / USB audio capture (Web Audio API)
 *   - Amp simulation chain (pedalboard → drive → 3-band EQ → master)
 *   - PCM/WAV export from AudioBuffer (for transcription pipeline)
 *
 * A single AudioContext is reused across components — browsers throttle pages
 * that leak many contexts and Safari limits you to 4 live contexts before
 * silently failing.
 *
 * Signal chain shape:
 *   source → [pedal1] → [pedal2] → ... → drive → bass → mid → treble → master
 * Inactive pedals are simply omitted from the wiring, not bypassed live.
 */

import { buildPedalChain, type PedalChain, type PedalSlot } from './pedals';

let sharedCtx: AudioContext | null = null;

/** Returns the shared AudioContext, creating it lazily. */
export function getAudioContext(): AudioContext {
  if (!sharedCtx) {
    const Ctor =
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext ?? window.AudioContext;
    sharedCtx = new Ctor();
  }
  // iOS Safari starts the context in "suspended" state — it has to be resumed
  // from a user gesture. Components should call `resumeAudioContext()` in their
  // click handlers.
  return sharedCtx;
}

export async function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }
}

/** Request microphone/line-in access and return the raw media stream. */
export async function requestMicStream(
  deviceId?: string,
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // Ask for the highest sample rate the device supports (iRig = 48 kHz).
      sampleRate: 48000,
    } as MediaTrackConstraints,
    video: false,
  });
}

/** List audio input devices — useful for selecting the iRig in the UI. */
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  // Permissions must have been granted at least once before enumerateDevices
  // returns labels.
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === 'audioinput');
}

// ─────────────────────────────────────────────────────────────────────────────
// Amp simulation chain
// ─────────────────────────────────────────────────────────────────────────────

export interface AmpSimChain {
  input: GainNode;
  drive: WaveShaperNode;
  bass: BiquadFilterNode;
  mid: BiquadFilterNode;
  treble: BiquadFilterNode;
  master: GainNode;
  /** Live pedal sub-graphs that were spliced in front of the amp. */
  pedals: PedalChain[];
  /** The final node — connect this to `ctx.destination` to monitor. */
  output: AudioNode;
  /** Dispose the chain (disconnect + null out). */
  dispose: () => void;
}

export interface AmpSimParams {
  /** Input gain, 0–10. Higher = more distortion. */
  drive: number;
  /** −12..+12 dB. */
  bass: number;
  /** −12..+12 dB. */
  mid: number;
  /** −12..+12 dB. */
  treble: number;
  /** 0–1 master volume. */
  master: number;
  /** Flavor of distortion curve. */
  voicing: 'clean' | 'crunch' | 'lead';
}

/**
 * Build an amp sim chain connected to the given source node. Caller is
 * responsible for calling `.dispose()` when unmounted.
 *
 * If `pedalSlots` is provided, active pedals are wired in front of the
 * amp section in the canonical signal-chain order (see PEDAL_ORDER in
 * pedals.ts). Bypassed slots contribute nothing to the wiring — no
 * "thru" gain hack needed since rebuilds are cheap.
 */
export function createAmpSim(
  ctx: AudioContext,
  source: AudioNode,
  params: AmpSimParams,
  pedalSlots: PedalSlot[] = [],
): AmpSimChain {
  // 1. Build active pedal chains in canonical order. The caller's slots
  //    array is already sorted (Pedalboard renders in PEDAL_ORDER), so
  //    we just iterate and skip inactive ones.
  const pedals: PedalChain[] = [];
  let upstream: AudioNode = source;
  for (const slot of pedalSlots) {
    const chain = buildPedalChain(ctx, slot);
    if (!chain) continue;
    upstream.connect(chain.input);
    upstream = chain.output;
    pedals.push(chain);
  }

  // 2. Build the amp section (unchanged from the pre-pedalboard version).
  const input = ctx.createGain();
  input.gain.value = 1 + params.drive * 0.4; // pre-gain before the shaper

  const drive = ctx.createWaveShaper();
  drive.curve = makeDistortionCurve(params.drive, params.voicing);
  drive.oversample = '4x';

  const bass = ctx.createBiquadFilter();
  bass.type = 'lowshelf';
  bass.frequency.value = 200;
  bass.gain.value = params.bass;

  const mid = ctx.createBiquadFilter();
  mid.type = 'peaking';
  mid.frequency.value = 800;
  mid.Q.value = 0.8;
  mid.gain.value = params.mid;

  const treble = ctx.createBiquadFilter();
  treble.type = 'highshelf';
  treble.frequency.value = 3000;
  treble.gain.value = params.treble;

  const master = ctx.createGain();
  master.gain.value = params.master;

  // 3. Wire pedalboard output → amp input → rest of chain.
  upstream.connect(input);
  input.connect(drive);
  drive.connect(bass);
  bass.connect(mid);
  mid.connect(treble);
  treble.connect(master);

  const dispose = () => {
    try {
      // Disconnect every node we own. Pedals dispose their own internals.
      for (const p of pedals) p.dispose();
      // Source can have been wired to either the first pedal's input OR
      // directly to `input` if no pedals were active.
      try { source.disconnect(); } catch { /* ignore */ }
      input.disconnect();
      drive.disconnect();
      bass.disconnect();
      mid.disconnect();
      treble.disconnect();
      master.disconnect();
    } catch {
      /* nodes already disconnected */
    }
  };

  return {
    input,
    drive,
    bass,
    mid,
    treble,
    master,
    pedals,
    output: master,
    dispose,
  };
}

/**
 * Generate a distortion curve for WaveShaperNode. The curve is a lookup table
 * mapping input sample [-1, 1] → output sample [-1, 1].
 *
 * Different "voicings" produce different tones:
 *   - clean: very mild softclip, emulates a transistor preamp
 *   - crunch: moderate asymmetric clipping, emulates a cranked tube amp
 *   - lead: hard clipping with bias, emulates a high-gain master volume amp
 */
function makeDistortionCurve(
  drive: number,
  voicing: 'clean' | 'crunch' | 'lead',
): Float32Array<ArrayBuffer> {
  const samples = 2048;
  // Explicit ArrayBuffer allocation — WaveShaperNode.curve rejects
  // Float32Array<ArrayBufferLike> views (TS 5.7+ strictness).
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const k = Math.max(0.1, drive) * 5; // "drive amount" — more k = more clipping

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1; // map i → [-1, 1]
    switch (voicing) {
      case 'clean':
        // soft tanh-like curve, barely audible at drive < 3
        curve[i] = Math.tanh(x * (1 + k * 0.2));
        break;
      case 'crunch':
        // asymmetric softclip — positive half clips harder than negative
        curve[i] =
          x >= 0
            ? Math.tanh(x * k)
            : Math.tanh(x * k * 0.7) * 0.85;
        break;
      case 'lead':
        // hard-clip with a bit of bias — maximum saturation
        curve[i] = Math.max(-0.95, Math.min(0.95, x * k * 0.8));
        break;
    }
  }
  return curve;
}

// ─────────────────────────────────────────────────────────────────────────────
// WAV encoding (for saving recordings + feeding to basic-pitch)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Encode an AudioBuffer as a 16-bit PCM WAV Blob.
 * Works for mono or stereo inputs; output matches the buffer's channel count.
 */
export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const samples = interleave(buffer);
  const bufferSize = 44 + samples.length * 2;
  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  // RIFF header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  // fmt chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, bitDepth, true);
  // data chunk
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function interleave(buffer: AudioBuffer): Float32Array {
  if (buffer.numberOfChannels === 1) {
    return buffer.getChannelData(0);
  }
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.getChannelData(1);
  const out = new Float32Array(ch0.length + ch1.length);
  let idx = 0;
  for (let i = 0; i < ch0.length; i++) {
    out[idx++] = ch0[i];
    out[idx++] = ch1[i];
  }
  return out;
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * Decode a File/Blob into an AudioBuffer resampled to `targetSampleRate`
 * (basic-pitch expects 22050 Hz mono).
 */
export async function decodeAndResample(
  file: File | Blob,
  targetSampleRate = 22050,
): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const tempCtx = new AudioContext();
  const decoded = await tempCtx.decodeAudioData(arrayBuffer.slice(0));
  await tempCtx.close();

  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * targetSampleRate),
    targetSampleRate,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  return offlineCtx.startRendering();
}
