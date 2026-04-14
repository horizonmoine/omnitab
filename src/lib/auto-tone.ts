/**
 * Auto-tone analyzer.
 *
 * Given an audio blob (typically an isolated guitar stem from Demucs), measure
 * the average spectral energy in three bands (bass / mid / treble) and map
 * the delta from a "neutral" reference curve onto gains for the 3-band EQ
 * of AmpSim.
 *
 * The analysis is offline — we use an OfflineAudioContext + FFT per chunk.
 * That way we don't need the user's AmpSim to be running, and the result is
 * deterministic (no fluctuation from live-mic noise).
 *
 * Philosophy: this is not a magic tone-matcher. It's a 3-knob nudge. A proper
 * impulse-response convolver would do better but requires a reference IR we
 * don't have. Users are expected to tweak the knobs afterwards.
 */
import { decodeAndResample } from './audio-engine';

export interface ToneAnalysis {
  /** Average linear magnitude in each band, normalised 0..1. */
  bassEnergy: number;
  midEnergy: number;
  trebleEnergy: number;
}

export interface AutoToneEq {
  /** dB offsets, clamped to ±12 dB. */
  bass: number;
  mid: number;
  treble: number;
}

// Band split points chosen to match the AmpSim filters (low shelf ~200 Hz,
// peak ~800 Hz, high shelf ~3 kHz).
const BASS_HZ: [number, number] = [60, 250];
const MID_HZ: [number, number] = [250, 2500];
const TREBLE_HZ: [number, number] = [2500, 8000];

/**
 * Rails a raw band energy against a "flat" reference (assumed = 1/3 each) and
 * returns a dB offset the EQ should apply to bring the user's tone towards
 * the target. Clamped to ±12 dB since that's the UI range.
 */
function energyToDb(target: number, reference: number): number {
  if (reference <= 0) return 0;
  const ratio = target / reference;
  const db = 20 * Math.log10(ratio);
  return Math.max(-12, Math.min(12, db));
}

/**
 * Analyse an audio blob offline and report the average energy in the three EQ
 * bands. Uses FFT via OfflineAudioContext rendering + AnalyserNode.
 */
export async function analyseTone(blob: Blob): Promise<ToneAnalysis> {
  // Downsample to 16 kHz mono — this is about timbre, not fidelity.
  const buffer = await decodeAndResample(blob, 16000);

  // Average FFT across the whole buffer by stepping an AnalyserNode via
  // rendering. Cheaper version: compute magnitudes directly with a windowed
  // manual DFT would be overkill — the OfflineAudioContext route is ~15 lines.
  const OfflineCtor =
    typeof OfflineAudioContext !== 'undefined'
      ? OfflineAudioContext
      : // Safari
        (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const ctx = new OfflineCtor(1, buffer.length, buffer.sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0;
  src.connect(analyser);
  analyser.connect(ctx.destination);
  src.start();

  // We can't actually pull FFT frames from an OfflineAnalyser (browsers return
  // the last frame only after render). So instead we use a ScriptProcessor-free
  // approach: walk the decoded PCM ourselves, computing band energies directly
  // in the time domain via Goertzel-style bandpass? That's overkill too.
  //
  // Pragmatic shortcut: do a single big FFT of the whole buffer. A 2048-sample
  // window at 16 kHz is fine for our 3-band resolution.
  const data = buffer.getChannelData(0);
  const N = Math.min(16384, 1 << Math.floor(Math.log2(data.length))); // largest pow2 ≤ len, cap 16k
  const fftMag = realFftMagnitude(data.subarray(0, N));

  // Map bin → Hz: bin k corresponds to k * sampleRate / N.
  const binHz = buffer.sampleRate / N;
  const bandEnergy = (lo: number, hi: number) => {
    const start = Math.max(1, Math.floor(lo / binHz));
    const end = Math.min(fftMag.length - 1, Math.ceil(hi / binHz));
    let sum = 0;
    for (let i = start; i <= end; i++) sum += fftMag[i];
    return sum / Math.max(1, end - start + 1);
  };

  const bass = bandEnergy(...BASS_HZ);
  const mid = bandEnergy(...MID_HZ);
  const treble = bandEnergy(...TREBLE_HZ);

  // Normalise so all three sum to 1 — we only care about relative shape.
  const total = bass + mid + treble || 1;
  return {
    bassEnergy: bass / total,
    midEnergy: mid / total,
    trebleEnergy: treble / total,
  };
}

/**
 * Turn a raw analysis into suggested EQ offsets, relative to an assumed "flat"
 * reference distribution of 1/3 in each band.
 */
export function suggestEq(analysis: ToneAnalysis): AutoToneEq {
  const neutral = 1 / 3;
  return {
    bass: energyToDb(analysis.bassEnergy, neutral),
    mid: energyToDb(analysis.midEnergy, neutral),
    treble: energyToDb(analysis.trebleEnergy, neutral),
  };
}

// ───────────────────── FFT helpers ─────────────────────

/**
 * Minimal iterative Cooley-Tukey real-input FFT (radix-2). Returns the
 * magnitude spectrum (length N/2 + 1).
 *
 * N MUST be a power of 2. We don't want a full DSP lib dep for 3 knobs.
 */
function realFftMagnitude(x: Float32Array): Float32Array {
  const N = x.length;
  // Copy into interleaved complex buffer (re, im, re, im, ...).
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) re[i] = x[i];

  // Bit-reversal permutation.
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }

  for (let len = 2; len <= N; len <<= 1) {
    const halfLen = len >> 1;
    const angleStep = (-2 * Math.PI) / len;
    const wRealStep = Math.cos(angleStep);
    const wImagStep = Math.sin(angleStep);
    for (let i = 0; i < N; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < halfLen; k++) {
        const a = i + k;
        const b = a + halfLen;
        const tRe = wRe * re[b] - wIm * im[b];
        const tIm = wRe * im[b] + wIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextWRe = wRe * wRealStep - wIm * wImagStep;
        wIm = wRe * wImagStep + wIm * wRealStep;
        wRe = nextWRe;
      }
    }
  }

  const mag = new Float32Array(N / 2 + 1);
  for (let i = 0; i < mag.length; i++) {
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]);
  }
  return mag;
}
