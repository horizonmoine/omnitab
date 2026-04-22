/**
 * Virtual pedalboard — 8 stompboxes wired as Web Audio sub-graphs.
 *
 * Each pedal is a self-contained `PedalChain` with `input` / `output`
 * AudioNodes that you splice into the main signal path BEFORE the amp:
 *
 *   source → [comp] → [wah] → [fuzz] → [od] → [dist]
 *          → [chorus] → [delay] → [reverb] → amp → speakers
 *
 * The order is canonical (Eric Johnson textbook):
 *   1. Compressor — even out dynamics first
 *   2. Wah        — pre-distortion = vocal-like, post = honky
 *   3. Fuzz       — loves clean input (responds to volume knob)
 *   4. Overdrive  — stacks into distortion ("gain stacking")
 *   5. Distortion — heavier saturation
 *   6. Chorus     — modulation goes after dirt
 *   7. Delay      — time-based effects last so echoes don't get distorted
 *   8. Reverb     — final ambience
 *
 * Why fixed order? V1 simplicity. A reorderable pedalboard is doable but
 * adds drag-and-drop UX complexity. This order is what 90 % of guitarists
 * use anyway.
 *
 * Bypass strategy: when a pedal is inactive, we simply DON'T include its
 * nodes in the chain — the amp sim rebuilds the signal path on toggle.
 * Web Audio handles 100+ reconnections per second, so the user perceives
 * a single click as instant.
 */
// ─── Types ────────────────────────────────────────────────────────────────

/** Stable IDs for the 8 v1 pedals. */
export type PedalKind =
  | 'compressor'
  | 'wah'
  | 'fuzz'
  | 'overdrive'
  | 'distortion'
  | 'chorus'
  | 'delay'
  | 'reverb';

/**
 * Canonical signal-chain order — used by the amp sim to wire active
 * pedals in the right sequence regardless of UI display order.
 */
export const PEDAL_ORDER: readonly PedalKind[] = [
  'compressor',
  'wah',
  'fuzz',
  'overdrive',
  'distortion',
  'chorus',
  'delay',
  'reverb',
] as const;

/** Free-form parameter bag. Keys are pedal-specific (see KNOB_DEFS). */
export type PedalParams = Record<string, number>;

/** Definition of one knob on a pedal — drives the UI + the audio engine. */
export interface KnobDef {
  /** Unique key within the pedal — must match the param bag. */
  key: string;
  /** Human-readable label shown under the knob. */
  label: string;
  min: number;
  max: number;
  step?: number;
  /** Default value if the user hasn't tweaked the knob yet. */
  default: number;
  /** Optional formatter for the value display under the knob. */
  format?: (v: number) => string;
}

/** Live audio sub-graph for one pedal. */
export interface PedalChain {
  /** Connect the previous node to this. */
  input: AudioNode;
  /** Connect this to the next pedal / amp. */
  output: AudioNode;
  /**
   * Update one parameter live without rebuilding the whole graph.
   * Returns false if the param can't be tweaked live (rare — see fuzz).
   */
  setParam: (key: string, value: number) => boolean;
  /** Tear down — disconnect every node + cancel any timers/oscillators. */
  dispose: () => void;
}

/** Static definition of one pedal kind — UI metadata + audio factory. */
export interface PedalDef {
  kind: PedalKind;
  /** Display name (e.g. "Tube Screamer"). */
  name: string;
  /** Short description shown in the UI. */
  blurb: string;
  /** Hex color for the pedal box (matches real-world stomp colors where it makes sense). */
  color: string;
  /** Knobs on this pedal — order = display order. */
  knobs: KnobDef[];
  /** Build the audio sub-graph. Caller wires input/output and disposes. */
  build: (ctx: AudioContext, params: PedalParams) => PedalChain;
}

/**
 * Pedal slot in the user's virtual board. The user sees 8 of these
 * (one per pedal kind), can toggle `active`, and tweak `params`.
 */
export interface PedalSlot {
  kind: PedalKind;
  /** True = pedal is engaged (LED on). False = bypassed. */
  active: boolean;
  /** Knob values keyed by KnobDef.key. */
  params: PedalParams;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Map a 0..10 knob to a sensible gain factor (1 = unity, 10 = ~32×). */
function knobToGain(v: number, max = 32): number {
  // Geometric scaling: feels "linear" to the ear (gain perception is logarithmic).
  return Math.pow(max, v / 10);
}

/** Map a 0..10 tone knob to a tilt EQ in dB (-12 dark .. +12 bright). */
function knobToTone(v: number): number {
  return (v - 5) * 2.4;
}

/**
 * Generic curve generator for soft-clipping waveshapers. `amount` 0..1.
 * Higher = harder clip. We use a smooth tanh-like curve for musical
 * harmonics rather than the brittle `sign(x)` square wave.
 */
function makeSoftClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  // Length-based ctor → Float32Array<ArrayBuffer> (narrower than ArrayBufferLike)
  // which is what WaveShaperNode.curve requires under TS 5.7+.
  const curve = new Float32Array(n);
  const k = 1 + amount * 30; // 1..31 — drive amount
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(x * k);
  }
  return curve;
}

/** Hard-clip curve with bias — emulates a RAT or DS-1 style distortion. */
function makeHardClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + amount * 50;
  const bias = 0.05; // small DC bias = asymmetric harmonics = "warmer"
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    const driven = (x + bias) * k;
    curve[i] = Math.max(-0.95, Math.min(0.95, driven));
  }
  return curve;
}

/**
 * Quasi-square clip curve for fuzz. We stop at ±0.85 with a steep
 * approach so the fundamental survives but harmonics scream.
 */
function makeFuzzCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 5 + amount * 80;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    // tanh with very high gain → near-square
    curve[i] = Math.tanh(x * k) * 0.85;
  }
  return curve;
}

/**
 * Generate a synthetic reverb impulse response: decaying noise.
 * `seconds` = decay time. Stereo (L/R independent noise) for natural width.
 */
function makeReverbIR(
  ctx: AudioContext | OfflineAudioContext,
  seconds: number,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(seconds * sr));
  const ir = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // Exponential decay × white noise. The (1 - t)^2 envelope is what
      // makes it sound like a "room" rather than a flat noise burst.
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2);
    }
  }
  return ir;
}

// ─── 1. Compressor ────────────────────────────────────────────────────────
/**
 * Native DynamicsCompressorNode wrapped as a pedal. Threshold + ratio
 * + attack + release are all live-tweakable AudioParams, so no rebuild
 * needed when the user moves a knob.
 */
function buildCompressor(ctx: AudioContext, params: PedalParams): PedalChain {
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = params.threshold ?? -24;
  comp.ratio.value = params.ratio ?? 4;
  comp.attack.value = (params.attack ?? 3) / 1000; // ms → s
  comp.release.value = (params.release ?? 250) / 1000;
  comp.knee.value = 6;

  // Make-up gain — compressor reduces level, we boost back up.
  const makeup = ctx.createGain();
  makeup.gain.value = knobToGain(params.makeup ?? 5, 4); // 1×..4×

  comp.connect(makeup);

  return {
    input: comp,
    output: makeup,
    setParam: (key, value) => {
      switch (key) {
        case 'threshold': comp.threshold.value = value; return true;
        case 'ratio': comp.ratio.value = value; return true;
        case 'attack': comp.attack.value = value / 1000; return true;
        case 'release': comp.release.value = value / 1000; return true;
        case 'makeup': makeup.gain.value = knobToGain(value, 4); return true;
        default: return false;
      }
    },
    dispose: () => {
      try { comp.disconnect(); makeup.disconnect(); } catch { /* already gone */ }
    },
  };
}

// ─── 2. Wah ───────────────────────────────────────────────────────────────
/**
 * Auto-wah: a bandpass filter whose center frequency sweeps via an LFO.
 *
 * Why LFO instead of a foot-pedal? The user is on a phone — no expression
 * pedal. An LFO gives a rhythmic "wah-wah-wah" suitable for funk grooves.
 * Future v2: envelope-follower (auto-wah triggered by playing dynamics).
 */
function buildWah(ctx: AudioContext, params: PedalParams): PedalChain {
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = 800;
  bandpass.Q.value = params.q ?? 5;

  // LFO that modulates the filter frequency.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = params.rate ?? 2; // Hz
  lfo.type = 'sine';

  // Depth scales the LFO output — controls how wide the sweep is.
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = (params.depth ?? 0.5) * 1500; // ±1500 Hz around 800

  lfo.connect(lfoGain);
  lfoGain.connect(bandpass.frequency);
  lfo.start();

  // Mix the wet (bandpass) with a touch of dry to keep some body.
  const splitter = ctx.createGain();
  splitter.gain.value = 1;
  const dry = ctx.createGain();
  dry.gain.value = 0.2;
  const wet = ctx.createGain();
  wet.gain.value = 1;
  const merger = ctx.createGain();
  merger.gain.value = 1;

  splitter.connect(dry);
  splitter.connect(bandpass);
  bandpass.connect(wet);
  dry.connect(merger);
  wet.connect(merger);

  return {
    input: splitter,
    output: merger,
    setParam: (key, value) => {
      switch (key) {
        case 'rate': lfo.frequency.value = value; return true;
        case 'depth': lfoGain.gain.value = value * 1500; return true;
        case 'q': bandpass.Q.value = value; return true;
        default: return false;
      }
    },
    dispose: () => {
      try {
        lfo.stop();
        lfo.disconnect();
        lfoGain.disconnect();
        bandpass.disconnect();
        splitter.disconnect();
        dry.disconnect();
        wet.disconnect();
        merger.disconnect();
      } catch { /* already gone */ }
    },
  };
}

// ─── 3. Fuzz ──────────────────────────────────────────────────────────────
/**
 * Big Muff style: massive gain into a near-square clipper, with a
 * mid-scoop tone control (the famous "Pi" sound). Knobs require chain
 * rebuild for sustain (curve regen) — others are live.
 */
function buildFuzz(ctx: AudioContext, params: PedalParams): PedalChain {
  const preGain = ctx.createGain();
  preGain.gain.value = knobToGain(params.sustain ?? 7, 12);

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeFuzzCurve((params.sustain ?? 7) / 10);
  shaper.oversample = '4x';

  // Mid-scoop tone: a peaking filter with NEGATIVE gain at 1 kHz, more
  // pronounced as the tone knob goes higher.
  const tone = ctx.createBiquadFilter();
  tone.type = 'peaking';
  tone.frequency.value = 1000;
  tone.Q.value = 0.9;
  tone.gain.value = -((params.tone ?? 5) - 5) * 2; // -10..+10 dB scoop

  const volume = ctx.createGain();
  volume.gain.value = (params.volume ?? 5) / 10 * 0.3; // fuzz is LOUD, scale down

  preGain.connect(shaper);
  shaper.connect(tone);
  tone.connect(volume);

  return {
    input: preGain,
    output: volume,
    setParam: (key, value) => {
      switch (key) {
        case 'sustain':
          preGain.gain.value = knobToGain(value, 12);
          shaper.curve = makeFuzzCurve(value / 10);
          return true;
        case 'tone': tone.gain.value = -(value - 5) * 2; return true;
        case 'volume': volume.gain.value = value / 10 * 0.3; return true;
        default: return false;
      }
    },
    dispose: () => {
      try {
        preGain.disconnect();
        shaper.disconnect();
        tone.disconnect();
        volume.disconnect();
      } catch { /* already gone */ }
    },
  };
}

// ─── 4. Overdrive ─────────────────────────────────────────────────────────
/**
 * TS9 (Tube Screamer) emulation: pre-highpass → soft clip → mid-bump.
 *
 * The pre-highpass is the secret sauce — it cuts the muddy lows BEFORE
 * the clipper, so harmonics stay clean. The post bandpass adds the
 * famous "mid hump" at 720 Hz that makes a TS sit on top of an amp mix.
 */
function buildOverdrive(ctx: AudioContext, params: PedalParams): PedalChain {
  // Pre-highpass: kill mud below 120 Hz before it gets clipped.
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 120;
  highpass.Q.value = 0.7;

  const drive = ctx.createGain();
  drive.gain.value = knobToGain(params.drive ?? 5, 16);

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeSoftClipCurve((params.drive ?? 5) / 10);
  shaper.oversample = '4x';

  // Post bandpass: the "TS9 mid hump".
  const midBump = ctx.createBiquadFilter();
  midBump.type = 'peaking';
  midBump.frequency.value = 720;
  midBump.Q.value = 1.5;
  midBump.gain.value = 4;

  // Tone control: tilt EQ toward bright (high values) or dark (low).
  const tone = ctx.createBiquadFilter();
  tone.type = 'highshelf';
  tone.frequency.value = 2500;
  tone.gain.value = knobToTone(params.tone ?? 5);

  const level = ctx.createGain();
  level.gain.value = (params.level ?? 5) / 10 * 0.7;

  highpass.connect(drive);
  drive.connect(shaper);
  shaper.connect(midBump);
  midBump.connect(tone);
  tone.connect(level);

  return {
    input: highpass,
    output: level,
    setParam: (key, value) => {
      switch (key) {
        case 'drive':
          drive.gain.value = knobToGain(value, 16);
          shaper.curve = makeSoftClipCurve(value / 10);
          return true;
        case 'tone': tone.gain.value = knobToTone(value); return true;
        case 'level': level.gain.value = value / 10 * 0.7; return true;
        default: return false;
      }
    },
    dispose: () => {
      try {
        highpass.disconnect();
        drive.disconnect();
        shaper.disconnect();
        midBump.disconnect();
        tone.disconnect();
        level.disconnect();
      } catch { /* already gone */ }
    },
  };
}

// ─── 5. Distortion ────────────────────────────────────────────────────────
/**
 * RAT/DS-1 style: harder clipping, scooped mids, brighter top end.
 * Less subtle than the OD — when you want grindy modern rock or metal.
 */
function buildDistortion(ctx: AudioContext, params: PedalParams): PedalChain {
  const drive = ctx.createGain();
  drive.gain.value = knobToGain(params.distortion ?? 5, 24);

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeHardClipCurve((params.distortion ?? 5) / 10);
  shaper.oversample = '4x';

  // Bright tone shelf — DS-1 cuts darker the lower the tone, brighter the higher.
  const tone = ctx.createBiquadFilter();
  tone.type = 'highshelf';
  tone.frequency.value = 3000;
  tone.gain.value = knobToTone(params.tone ?? 5);

  // Slight low cut to keep things tight.
  const lowCut = ctx.createBiquadFilter();
  lowCut.type = 'highpass';
  lowCut.frequency.value = 80;

  const level = ctx.createGain();
  level.gain.value = (params.level ?? 5) / 10 * 0.6;

  lowCut.connect(drive);
  drive.connect(shaper);
  shaper.connect(tone);
  tone.connect(level);

  return {
    input: lowCut,
    output: level,
    setParam: (key, value) => {
      switch (key) {
        case 'distortion':
          drive.gain.value = knobToGain(value, 24);
          shaper.curve = makeHardClipCurve(value / 10);
          return true;
        case 'tone': tone.gain.value = knobToTone(value); return true;
        case 'level': level.gain.value = value / 10 * 0.6; return true;
        default: return false;
      }
    },
    dispose: () => {
      try {
        lowCut.disconnect();
        drive.disconnect();
        shaper.disconnect();
        tone.disconnect();
        level.disconnect();
      } catch { /* already gone */ }
    },
  };
}

// ─── 6. Chorus ────────────────────────────────────────────────────────────
/**
 * Boss CE-2 style chorus: short modulated delay mixed with dry.
 * The LFO modulates delay time around 15 ms — the ear hears it as
 * pitch wobble that doubles the signal.
 */
function buildChorus(ctx: AudioContext, params: PedalParams): PedalChain {
  const split = ctx.createGain();
  split.gain.value = 1;

  const dry = ctx.createGain();
  dry.gain.value = 1 - (params.mix ?? 0.5) * 0.5; // dry never goes below 0.5

  const wet = ctx.createGain();
  wet.gain.value = (params.mix ?? 0.5);

  const delay = ctx.createDelay(0.05);
  delay.delayTime.value = 0.015; // 15 ms base

  const lfo = ctx.createOscillator();
  lfo.frequency.value = params.rate ?? 1.5;
  lfo.type = 'sine';

  const lfoGain = ctx.createGain();
  // Depth is in seconds — small values (0.001..0.005) sound like chorus,
  // larger values become flanger/vibrato territory.
  lfoGain.gain.value = (params.depth ?? 0.5) * 0.005;

  lfo.connect(lfoGain);
  lfoGain.connect(delay.delayTime);
  lfo.start();

  const out = ctx.createGain();
  out.gain.value = 1;

  split.connect(dry);
  split.connect(delay);
  delay.connect(wet);
  dry.connect(out);
  wet.connect(out);

  return {
    input: split,
    output: out,
    setParam: (key, value) => {
      switch (key) {
        case 'rate': lfo.frequency.value = value; return true;
        case 'depth': lfoGain.gain.value = value * 0.005; return true;
        case 'mix':
          dry.gain.value = 1 - value * 0.5;
          wet.gain.value = value;
          return true;
        default: return false;
      }
    },
    dispose: () => {
      try {
        lfo.stop();
        lfo.disconnect();
        lfoGain.disconnect();
        delay.disconnect();
        split.disconnect();
        dry.disconnect();
        wet.disconnect();
        out.disconnect();
      } catch { /* already gone */ }
    },
  };
}

// ─── 7. Delay ─────────────────────────────────────────────────────────────
/**
 * Standard analog-ish delay with feedback loop. Capped at 1.5 s — enough
 * for "U2 The Edge" dotted-eighth stuff, short enough that runaway
 * feedback can't blow the user's eardrums.
 */
function buildDelay(ctx: AudioContext, params: PedalParams): PedalChain {
  const split = ctx.createGain();
  split.gain.value = 1;

  const delay = ctx.createDelay(1.5);
  delay.delayTime.value = (params.time ?? 400) / 1000; // ms → s

  const feedback = ctx.createGain();
  // Hard-cap feedback at 0.85 — anything higher self-oscillates and
  // can hurt headphones.
  feedback.gain.value = Math.min(0.85, (params.feedback ?? 4) / 10);

  const wet = ctx.createGain();
  wet.gain.value = (params.mix ?? 0.4);

  const dry = ctx.createGain();
  dry.gain.value = 1;

  const out = ctx.createGain();
  out.gain.value = 1;

  // Wet path: split → delay → feedback loop → wet → out
  split.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay); // feedback loop
  delay.connect(wet);
  wet.connect(out);

  // Dry path: split → dry → out
  split.connect(dry);
  dry.connect(out);

  return {
    input: split,
    output: out,
    setParam: (key, value) => {
      switch (key) {
        case 'time': delay.delayTime.value = value / 1000; return true;
        case 'feedback': feedback.gain.value = Math.min(0.85, value / 10); return true;
        case 'mix': wet.gain.value = value; return true;
        default: return false;
      }
    },
    dispose: () => {
      try {
        delay.disconnect();
        feedback.disconnect();
        wet.disconnect();
        dry.disconnect();
        split.disconnect();
        out.disconnect();
      } catch { /* already gone */ }
    },
  };
}

// ─── 8. Reverb ────────────────────────────────────────────────────────────
/**
 * Convolution reverb with a synthetic decaying-noise IR.
 * Time knob = decay seconds. Mix = wet/dry.
 *
 * For a free, lightweight IR-less approach, we generate the IR in JS
 * once when the pedal is built. Not as realistic as a sampled hall IR
 * but plenty for "add some space".
 */
function buildReverb(ctx: AudioContext, params: PedalParams): PedalChain {
  const split = ctx.createGain();
  split.gain.value = 1;

  const convolver = ctx.createConvolver();
  convolver.buffer = makeReverbIR(ctx, (params.time ?? 5) / 10 * 4 + 0.5);
  // 0.5..4.5 s decay range

  const wet = ctx.createGain();
  wet.gain.value = (params.mix ?? 0.3);

  const dry = ctx.createGain();
  dry.gain.value = 1;

  const out = ctx.createGain();
  out.gain.value = 1;

  split.connect(convolver);
  convolver.connect(wet);
  wet.connect(out);
  split.connect(dry);
  dry.connect(out);

  return {
    input: split,
    output: out,
    setParam: (key, value) => {
      switch (key) {
        case 'time':
          // IR has to be regenerated when time changes — short enough
          // (a few ms) that the user doesn't notice.
          convolver.buffer = makeReverbIR(ctx, value / 10 * 4 + 0.5);
          return true;
        case 'mix': wet.gain.value = value; return true;
        default: return false;
      }
    },
    dispose: () => {
      try {
        convolver.disconnect();
        wet.disconnect();
        dry.disconnect();
        split.disconnect();
        out.disconnect();
      } catch { /* already gone */ }
    },
  };
}

// ─── Pedal definitions registry ───────────────────────────────────────────

const fmtPercent = (v: number) => `${Math.round(v * 100)}%`;
const fmtMs = (v: number) => `${Math.round(v)} ms`;
const fmtHz = (v: number) => `${v.toFixed(1)} Hz`;
const fmtRatio = (v: number) => `${v.toFixed(1)}:1`;
const fmtDb = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(0)} dB`;

export const PEDAL_DEFS: Record<PedalKind, PedalDef> = {
  compressor: {
    kind: 'compressor',
    name: 'Compressor',
    blurb: 'Égalise les dynamiques (funk, country, clean leads).',
    color: '#3b82f6', // blue
    knobs: [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, default: -24, format: fmtDb },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, default: 4, format: fmtRatio },
      { key: 'attack', label: 'Attack', min: 0, max: 50, step: 1, default: 3, format: fmtMs },
      { key: 'release', label: 'Release', min: 50, max: 1000, step: 10, default: 250, format: fmtMs },
      { key: 'makeup', label: 'Make-up', min: 0, max: 10, step: 0.1, default: 5 },
    ],
    build: buildCompressor,
  },
  wah: {
    kind: 'wah',
    name: 'Auto-Wah',
    blurb: 'Sweep rythmé (Hendrix, RHCP, funk).',
    color: '#a855f7', // purple
    knobs: [
      { key: 'rate', label: 'Rate', min: 0.2, max: 8, step: 0.1, default: 2, format: fmtHz },
      { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, default: 0.5, format: fmtPercent },
      { key: 'q', label: 'Q', min: 1, max: 15, step: 0.5, default: 5 },
    ],
    build: buildWah,
  },
  fuzz: {
    kind: 'fuzz',
    name: 'Fuzz',
    blurb: 'Saturation extrême (Hendrix, Smashing Pumpkins).',
    color: '#dc2626', // red
    knobs: [
      { key: 'sustain', label: 'Sustain', min: 0, max: 10, step: 0.1, default: 7 },
      { key: 'tone', label: 'Tone', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'volume', label: 'Volume', min: 0, max: 10, step: 0.1, default: 5 },
    ],
    build: buildFuzz,
  },
  overdrive: {
    kind: 'overdrive',
    name: 'Overdrive',
    blurb: 'Tube Screamer — boost lead, blues, gain stacking.',
    color: '#16a34a', // TS9 green
    knobs: [
      { key: 'drive', label: 'Drive', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'tone', label: 'Tone', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'level', label: 'Level', min: 0, max: 10, step: 0.1, default: 5 },
    ],
    build: buildOverdrive,
  },
  distortion: {
    kind: 'distortion',
    name: 'Distortion',
    blurb: 'RAT/DS-1 — rock moderne, metal léger.',
    color: '#f97316', // orange
    knobs: [
      { key: 'distortion', label: 'Distortion', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'tone', label: 'Tone', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'level', label: 'Level', min: 0, max: 10, step: 0.1, default: 5 },
    ],
    build: buildDistortion,
  },
  chorus: {
    kind: 'chorus',
    name: 'Chorus',
    blurb: "Doublage modulé (clean '80s, Police, Nirvana).",
    color: '#06b6d4', // cyan
    knobs: [
      { key: 'rate', label: 'Rate', min: 0.1, max: 5, step: 0.1, default: 1.5, format: fmtHz },
      { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, default: 0.5, format: fmtPercent },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.5, format: fmtPercent },
    ],
    build: buildChorus,
  },
  delay: {
    kind: 'delay',
    name: 'Delay',
    blurb: 'Écho — slap, dotted-eighth (The Edge), ambient.',
    color: '#8b5cf6', // violet
    knobs: [
      { key: 'time', label: 'Time', min: 50, max: 1500, step: 10, default: 400, format: fmtMs },
      { key: 'feedback', label: 'Feedback', min: 0, max: 8.5, step: 0.1, default: 4 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.4, format: fmtPercent },
    ],
    build: buildDelay,
  },
  reverb: {
    kind: 'reverb',
    name: 'Reverb',
    blurb: 'Espace — room, hall, ambient.',
    color: '#0ea5e9', // sky blue
    knobs: [
      { key: 'time', label: 'Time', min: 0, max: 10, step: 0.1, default: 5 },
      { key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, default: 0.3, format: fmtPercent },
    ],
    build: buildReverb,
  },
};

// ─── Factory helpers ──────────────────────────────────────────────────────

/** Build the default param bag for a pedal kind from its KnobDefs. */
export function makeDefaultParams(kind: PedalKind): PedalParams {
  const def = PEDAL_DEFS[kind];
  const out: PedalParams = {};
  for (const k of def.knobs) out[k.key] = k.default;
  return out;
}

/** Build the initial 8-slot pedalboard, all bypassed. */
export function makeDefaultPedalboard(): PedalSlot[] {
  return PEDAL_ORDER.map((kind) => ({
    kind,
    active: false,
    params: makeDefaultParams(kind),
  }));
}

/**
 * Build the live audio sub-graph for a slot. Returns null if the slot is
 * inactive — caller should skip it in the chain.
 */
export function buildPedalChain(
  ctx: AudioContext,
  slot: PedalSlot,
): PedalChain | null {
  if (!slot.active) return null;
  return PEDAL_DEFS[slot.kind].build(ctx, slot.params);
}
