# OmniTab — AI Context File

> This file captures the full project context so any AI agent (Claude, Codex, Gemini)
> can pick up development without lengthy onboarding.

## What is OmniTab?

A PWA guitar companion — our own Songsterr + Ultimate Guitar, but better and free.
Built for Samsung A52s + iRig Micro Amp. Works 100% offline after first load.

## URLs

| Service | URL |
|---------|-----|
| Frontend (Vercel) | https://omnitab-henna.vercel.app |
| GitHub | https://github.com/horizonmoine/omnitab |
| Demucs Backend (HF Space) | https://horizonmoine30-omnitab-demucs.hf.space |
| Vercel scope | markos-projects-92eb7d30 |
| HF username | horizonmoine30 |
| GitHub username | horizonmoine |

## Stack

- **Frontend:** Vite 6 + React 19 + TypeScript 5.6 (strict) + Tailwind CSS 3.4
- **Tab rendering:** AlphaTab 1.5.0 (CDN: jsdelivr)
- **AI transcription:** @spotify/basic-pitch 1.0.1 (TF.js in Web Worker)
- **Stem separation:** Demucs via FastAPI on HuggingFace Spaces (htdemucs, CPU)
- **Storage:** IndexedDB via Dexie v3 (tables: library, settings, recordings, stems, practice)
- **PWA:** vite-plugin-pwa + Workbox (autoUpdate, CacheFirst for CDN)
- **Deploy:** Vercel (auto-deploy on push to master) + Edge Function CORS proxy
- **CI:** GitHub Actions (typecheck → test → build on Node 20)
- **Music theory:** tonal 6.3.0
- **Tuner:** pitchy 4.1.0

## Architecture

```
src/
├── App.tsx              # Main shell — lazy-loaded routing (React.lazy + Suspense)
├── main.tsx             # Entry: PWA registration + basic-pitch model prefetch
├── components/          # 16 page components + Toast system
│   ├── TabViewer.tsx    # AlphaTab Pro (tracks, loop, count-in, zoom, speed, share)
│   ├── TabSearch.tsx    # Songsterr search → open on Songsterr
│   ├── Library.tsx      # IndexedDB library (search, sort, drag&drop, favorites)
│   ├── Tuner.tsx        # Real-time pitch detection
│   ├── Metronome.tsx    # Web Audio look-ahead scheduler
│   ├── AmpSim.tsx       # Drive → 3-band EQ → master chain
│   ├── Recorder.tsx     # MediaRecorder + waveform + speed control
│   ├── Transcriber.tsx  # basic-pitch → Viterbi → alphaTex pipeline
│   ├── StemPlayer.tsx   # Offline mixer (mute/solo/volume per stem)
│   ├── ChordLibrary.tsx # SVG chord diagrams (12 roots × 12 qualities)
│   ├── SpeedTrainer.tsx # Progressive tempo practice
│   ├── ScaleLibrary.tsx # Interactive SVG fretboard (14 scales, 5 CAGED positions)
│   ├── EarTraining.tsx  # Interval identification game with SRS-like scoring
│   ├── BackingTrack.tsx # Looping chord progressions (8 presets + custom)
│   ├── PracticeJournal.tsx # Practice journal with SRS (SuperMemo-2)
│   ├── Settings.tsx     # A4, tuning, Demucs URL, Viterbi weights, MIDI, voice
│   ├── Layout.tsx       # Sidebar + mobile bottom bar + Page type
│   ├── Toast.tsx        # Global toast notification system
│   ├── HealerOverlay.tsx # Coloured dots over AlphaTab glyphs (click-to-seek)
│   └── ErrorBoundary.tsx
├── hooks/               # Feature-isolated React hooks (consumed by TabViewer)
│   ├── useRocksmith.ts    # Mic detector + hit/miss stats + flash
│   ├── useTakeRecorder.ts # MediaRecorder + IndexedDB persistence
│   ├── useTabHealer.ts    # basic-pitch diff + seek helper
│   └── useStemSync.ts     # Demucs stems driven by AlphaTab transport
├── lib/                 # Core logic (no React)
│   ├── types.ts         # DetectedNote, TabNote, Transcription, SongsterrHit...
│   ├── db.ts            # Dexie schema v3 + CRUD + SRS (SuperMemo-2) helpers
│   ├── settings.ts      # Persistent settings with pub/sub
│   ├── audio-engine.ts  # Shared AudioContext + AmpSim chain + WAV encoding
│   ├── basic-pitch.ts   # Persistent worker facade with idle timeout
│   ├── midi-to-tab.ts   # Viterbi algorithm for fret placement
│   ├── midi-controller.ts # Web MIDI API — pedal/controller → app actions
│   ├── voice-commands.ts  # Web Speech API — French voice commands
│   ├── chord-melody.ts  # Melody/bass extraction
│   ├── alpha-tab-converter.ts  # Transcription → alphaTex
│   ├── guitarTunings.ts # Tuning definitions
│   ├── pitch-detection.ts
│   ├── tempo-detection.ts
│   ├── songsterr-api.ts # Songsterr /api/songs proxy client
│   ├── demucs-client.ts # HF Space FastAPI client (+ /youtube-audio)
│   ├── event-bus.ts     # Pub/sub bus for cross-page actions
│   ├── input-router.ts  # App-level MIDI + voice singletons
│   ├── rocksmith-detector.ts # pitchy + AlphaTab beat sync
│   ├── auto-tone.ts     # Offline FFT → 3-band EQ suggestion
│   ├── tab-healer.ts    # Diff human tab vs basic-pitch detection
│   ├── alpha-tab-beats.ts # Score → flat TabBeat[] for healer
│   ├── stem-sync.ts     # HTMLAudioElement multi-stem player + drift sync
│   └── take-recorder.ts # MediaRecorder wrapper for play-along takes
├── workers/
│   └── basic-pitch.worker.ts  # TF.js inference (module cached)
api/
└── songsterr.ts         # Vercel Edge Function CORS proxy
hf-space/
├── Dockerfile           # python:3.10-slim + torch 2.5.1 CPU
├── app.py               # FastAPI + Demucs htdemucs
└── requirements.txt
```

## Key Features

- **16 pages:** Search, Library, Viewer, Tuner, Metronome, Amp, Record, Transcribe, Stems, Chords, Speed Trainer, Scales, Ear Training, Backing Track, Practice Journal, Settings
- **Lazy loading:** 9 heavy pages are code-split via React.lazy (TabViewer, Transcriber, AmpSim, StemPlayer, ChordLibrary, SpeedTrainer, ScaleLibrary, EarTraining, BackingTrack)
- **Tab sharing:** `?tab=<base64>` URL param encodes alphaTex for link sharing
- **Toast notifications:** `toast.success()` / `toast.error()` / `toast.info()` — global, no context needed
- **Web MIDI:** Foot pedal support for play/pause, loop, speed control (Settings page)
- **Voice commands:** French-language hands-free control via Web Speech API (Settings page)
- **PWA install prompt:** Shown in Settings when `beforeinstallprompt` fires
- **Practice Journal (SRS):** SuperMemo-2 spaced repetition for maintaining song repertoire

## Conventions

- **UI language:** French
- **Code language:** English
- **Theme:** Dark "amp" palette — classes: amp-bg, amp-panel, amp-accent (#f59e0b orange)
- **Adding a new page:** 3 files to touch:
  1. New component in `src/components/`
  2. Add to `Page` type + `NAV` array in `Layout.tsx`
  3. Add lazy import + `case` in `App.tsx` renderPage switch
- **Commit style:** `type(scope): description` in English
- **No React Router** — simple state-based tab switching
- **No external component libraries** — pure Tailwind
- **Minimize new deps** — tonal is already installed for music theory
- **Toast for user feedback** — use `import { toast } from './Toast'` instead of console.warn

## Commands

```bash
npm run build        # tsc -b && vite build
npx vitest run       # run 47 tests
npx tsc --noEmit     # typecheck only
npm run dev          # dev server on :5173
git push origin master  # auto-deploys to Vercel
```

## Known Issues / Tech Debt

1. chord-melody.ts:174 has a TODO for bass rhythm enhancement
2. HF Space free tier sleeps after ~48h inactivity (first request takes 30-60s to wake)

## Songsterr API (April 2026)

Old endpoint (`/a/ra/songs.json`) is DEAD (404). New endpoints:
- Search: `GET https://www.songsterr.com/api/songs?pattern=...&size=40`
- Song detail: `GET https://www.songsterr.com/api/song/{songId}`
- Revisions: `GET https://www.songsterr.com/api/meta/{songId}/revisions`
- GP file downloads: NO LONGER PUBLIC — use player page instead

Our Edge proxy at `/api/songsterr?path=...` handles CORS for prod.

## Future Ideas (R&D)

- ✅ **Rocksmith mode:** Real-time pitch detection synced with AlphaTab cursor (green/red note feedback)
- ✅ **Auto-tone matching:** FFT analysis of isolated guitar stem → auto-adjust amp EQ
- ✅ **YouTube → audio pipeline:** yt-dlp on HF Space → MP3 → user feeds into Transcriber/Demucs
- ✅ **Tab Healer:** Compare basic-pitch transcription vs human tab to flag potential errors
- ✅ **Demucs + AlphaTab sync:** Stems play in lock-step with the tab cursor, mute-per-stem, speed mirrored
- ✅ **Healer overlay:** Coloured dots pinned to beat glyphs via `api.boundsLookup.findBeat`, click-to-seek
- **Auto-tone v2:** Live mic comparison vs reference, not just static FFT
- **Setlist mode:** Chain multiple tabs from the library with auto-progression
