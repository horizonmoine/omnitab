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
