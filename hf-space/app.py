"""
OmniTab Demucs backend — Hugging Face Spaces edition.

Streamlined from backend/server.py for single-tenant, CPU-only deployment
on HF Spaces (Docker, CPU Basic, 2 vCPU / 16 GB RAM). The API contract is
identical so the PWA's demucs-client.ts works without changes.

Endpoints:
    GET  /health           → liveness probe with model + device info
    POST /separate-stream  → upload audio → single stem WAV back

HF Spaces serves this on port 7860 over HTTPS automatically.
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
import threading
from pathlib import Path

import torch
import torchaudio
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from demucs.apply import apply_model
from demucs.audio import AudioFile, save_audio
from demucs.pretrained import get_model

# ── Logging ──────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("omnitab.demucs")

# ── Configuration ────────────────────────────────────────────────────────

DEFAULT_MODEL = os.environ.get("OMNITAB_MODEL", "htdemucs")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MAX_UPLOAD_MB = int(os.environ.get("OMNITAB_MAX_UPLOAD_MB", "50"))

# CORS: allow any origin by default. The HF Space is public, the data is
# transient audio that the user uploaded themselves — no auth to protect.
ALLOWED_ORIGINS = os.environ.get("OMNITAB_CORS_ORIGINS", "*").split(",")

log.info("device=%s  default_model=%s  max_upload=%d MB", DEVICE, DEFAULT_MODEL, MAX_UPLOAD_MB)

# ── Model cache ──────────────────────────────────────────────────────────

_model_cache: dict[str, object] = {}
_model_lock = threading.Lock()


def load_model(name: str):
    """Load and cache a Demucs model. Thread-safe."""
    with _model_lock:
        if name not in _model_cache:
            log.info("loading model %s on %s…", name, DEVICE)
            model = get_model(name)
            model.to(DEVICE)
            model.eval()
            _model_cache[name] = model
            log.info("model %s ready (sources=%s)", name, model.sources)
        return _model_cache[name]


# ── Separation core ─────────────────────────────────────────────────────

def separate_audio(file_bytes: bytes, model_name: str) -> dict[str, bytes]:
    """Run Demucs on raw audio bytes → dict of {stem_name: wav_bytes}."""
    model = load_model(model_name)

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_in:
        tmp_in.write(file_bytes)
        in_path = Path(tmp_in.name)

    try:
        wav = AudioFile(in_path).read(
            streams=0,
            samplerate=model.samplerate,
            channels=model.audio_channels,
        )
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / ref.std()

        with torch.no_grad():
            sources = apply_model(
                model,
                wav[None],
                device=DEVICE,
                shifts=1,
                split=True,
                overlap=0.25,
                progress=False,
            )[0]

        sources = sources * ref.std() + ref.mean()

        stems: dict[str, bytes] = {}
        for name, source in zip(model.sources, sources):
            buf = io.BytesIO()
            save_audio(source, buf, samplerate=model.samplerate)
            stems[name] = buf.getvalue()

        return stems
    finally:
        try:
            in_path.unlink()
        except OSError:
            pass


# ── FastAPI app ──────────────────────────────────────────────────────────

app = FastAPI(
    title="OmniTab Demucs",
    description="Stem-separation backend for OmniTab, hosted on Hugging Face Spaces.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _warmup():
    """Pre-load the default model at startup so the first request is fast."""
    try:
        load_model(DEFAULT_MODEL)
    except Exception:
        log.warning("could not pre-load %s — will load on first request", DEFAULT_MODEL)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": DEVICE,
        "default_model": DEFAULT_MODEL,
        "cuda_available": torch.cuda.is_available(),
        "torch_version": torch.__version__,
        "torchaudio_version": torchaudio.__version__,
    }


@app.get("/")
def root():
    """HF Spaces pings / for liveness."""
    return {"status": "ok", "service": "omnitab-demucs"}


def _validate_upload(file: UploadFile) -> bytes:
    data = file.file.read()
    if len(data) == 0:
        raise HTTPException(400, "empty upload")
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"file too large (>{MAX_UPLOAD_MB} MB)")
    return data


@app.post("/separate-stream")
def separate_stream(
    file: UploadFile = File(...),
    stem: str = Query("vocals", description="Stem name to return"),
    model: str = Query(DEFAULT_MODEL),
):
    """
    Upload audio → get back a single isolated stem as WAV.

    This is the only endpoint the OmniTab PWA actually calls. The full
    /separate (ZIP of all stems) from backend/server.py is intentionally
    omitted to keep the Space lean — the PWA only needs one stem per call.
    """
    data = _validate_upload(file)
    log.info(
        "/separate-stream  file=%s  size=%d  stem=%s  model=%s",
        file.filename,
        len(data),
        stem,
        model,
    )

    try:
        stems = separate_audio(data, model)
    except Exception as exc:
        log.exception("separation failed")
        raise HTTPException(500, f"separation failed: {exc}")

    if stem not in stems:
        raise HTTPException(
            404,
            f"stem '{stem}' not in model output. Available: {list(stems.keys())}",
        )

    return StreamingResponse(
        io.BytesIO(stems[stem]),
        media_type="audio/wav",
        headers={"Content-Disposition": f'attachment; filename="{stem}.wav"'},
    )


# ── YouTube audio extraction ─────────────────────────────────────────────
#
# Pulls audio from a YouTube URL via yt-dlp. The PWA then feeds the result
# into basic-pitch (for auto-transcription) or into Demucs (for stem
# separation). We deliberately do NOT chain them here — each model call is
# heavy and the user may only want the raw audio. Keeping concerns split
# also means the HF Space doesn't time-out on long clips.
#
# Safety:
#   - 10-minute cap: no feature films, no podcasts.
#   - MP3 / 128kbps: good enough for pitch detection, tiny over 4G.

YT_MAX_DURATION_S = int(os.environ.get("OMNITAB_YT_MAX_DURATION_S", "600"))


@app.get("/youtube-audio")
def youtube_audio(url: str = Query(..., description="YouTube URL")):
    """Extract audio track from a YouTube video as MP3."""
    try:
        import yt_dlp
    except ImportError:
        raise HTTPException(500, "yt-dlp not installed on backend")

    with tempfile.TemporaryDirectory() as tmpdir:
        out_template = str(Path(tmpdir) / "audio.%(ext)s")
        # YouTube rotates its anti-bot defenses every few weeks. The keys
        # below are the ones that have empirically kept this endpoint alive:
        #
        #   player_client=android,web,ios → yt-dlp falls back through three
        #     different YouTube API surfaces. When the `web` client gets a
        #     fresh cipher / sign-in wall, `android` is usually still happy.
        #   retries / fragment_retries → 5 retries on HTTP errors (the SSL
        #     UNEXPECTED_EOF we saw is one of these).
        #   extractor_retries → 3 retries when YouTube returns a malformed
        #     response (separate code path from network retries in yt-dlp).
        #   socket_timeout=20 → bail fast on a hung connection so we don't
        #     occupy the HF Space's single FastAPI worker.
        opts = {
            "format": "bestaudio/best",
            "outtmpl": out_template,
            "quiet": True,
            "noplaylist": True,
            "max_downloads": 1,
            "retries": 5,
            "fragment_retries": 5,
            "extractor_retries": 3,
            "socket_timeout": 20,
            "extractor_args": {
                "youtube": {
                    "player_client": ["android", "web", "ios"],
                },
            },
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "mp3",
                    "preferredquality": "128",
                }
            ],
        }

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
                duration = info.get("duration") or 0
                if duration > YT_MAX_DURATION_S:
                    raise HTTPException(
                        413,
                        f"video too long ({duration}s) — max {YT_MAX_DURATION_S}s",
                    )
                title = info.get("title", "audio")
                ydl.download([url])
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("yt-dlp failed")
            # Surface a hint to the client when the failure smells like a
            # version-skew issue (YouTube changed something faster than
            # yt-dlp shipped a fix). The PWA shows this string in a toast.
            msg = str(exc)
            hint = ""
            lower = msg.lower()
            if "ssl" in lower or "eof" in lower or "sign in" in lower or "bot" in lower:
                hint = (
                    " — yt-dlp may be out of date on the backend. "
                    "Rebuild the HF Space (touch YTDLP_CACHE_BUST in the Dockerfile) "
                    "or retry in a few minutes."
                )
            raise HTTPException(500, f"youtube extraction failed: {msg}{hint}")

        mp3_path = Path(tmpdir) / "audio.mp3"
        if not mp3_path.exists():
            # yt-dlp may have picked a different ext before post-processing.
            found = list(Path(tmpdir).glob("audio.*"))
            if not found:
                raise HTTPException(500, "no output from yt-dlp")
            mp3_path = found[0]

        data = mp3_path.read_bytes()

    log.info("/youtube-audio  url=%s  title=%s  bytes=%d", url, title, len(data))

    # Sanitize filename for Content-Disposition header (ASCII only).
    safe_title = "".join(c if c.isalnum() or c in " -_" else "_" for c in title)[:80].strip() or "audio"

    return StreamingResponse(
        io.BytesIO(data),
        media_type="audio/mpeg",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_title}.mp3"',
            "X-Omnitab-Title": safe_title,
        },
    )
