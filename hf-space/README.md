---
title: OmniTab Demucs
emoji: 🎸
colorFrom: yellow
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
---

# OmniTab Demucs

Stem-separation backend for [OmniTab](https://github.com/horizonmoine/omnitab), a PWA guitar companion.

Powered by [Meta's Demucs](https://github.com/facebookresearch/demucs) (Hybrid Transformer model).

## API

- `GET /health` — liveness probe (returns device, model, torch version)
- `GET /` — root liveness ping (HF Spaces uses this)
- `POST /separate-stream?stem=guitar` — upload audio file, get back the isolated stem as WAV
- `GET /youtube-audio?url=…` — extract MP3 from a YouTube URL via yt-dlp (10 min cap, configurable via `OMNITAB_YT_MAX_DURATION_S`). Title returned in `X-Omnitab-Title` header.

## Usage from OmniTab

The PWA defaults to this Space in production. To self-host instead:

1. Copy your Space's URL (e.g. `https://your-user-demucs.hf.space`)
2. In OmniTab, go to **Settings** → **Backend Demucs**
3. Paste the URL and save
4. The Transcriber page will then show "Demucs disponible" and use stem isolation + YouTube import against your Space.
