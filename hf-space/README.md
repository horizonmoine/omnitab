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

- `GET /health` — liveness probe
- `POST /separate-stream?stem=guitar` — upload audio file, get back the isolated stem as WAV

## Usage from OmniTab

1. Copy this Space's URL (e.g. `https://your-user-demucs.hf.space`)
2. In OmniTab, go to **Settings** → **Backend Demucs**
3. Paste the URL and save
4. The Transcriber page will now show "Demucs disponible" and use stem isolation before transcription
