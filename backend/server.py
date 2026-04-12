"""
OmniTab Demucs backend.

A tiny FastAPI server that wraps Facebook Research's Demucs model so the
PWA can hand off a song and get back isolated stems (vocals, bass, drums,
other, guitar, piano if using `htdemucs_6s`).

Why this exists:
    Demucs is a Python-only Hybrid Transformer model. We can't run it in the
    browser, so we expose it as a REST endpoint that the PWA hits over the
    local LAN (typically http://192.168.x.x:8000).

Endpoints:
    GET  /health           - liveness probe with model + device info
    GET  /models           - list installed Demucs models
    POST /separate         - upload audio file -> ZIP of stems
    POST /separate-stream  - upload audio file -> single stem (?stem=vocals)
    GET  /jobs/{job_id}    - poll progress for a long-running separation

Run:
    pip install -r requirements.txt
    python server.py
    # or
    uvicorn server:app --host 0.0.0.0 --port 8000

Hardware notes:
    htdemucs_ft     - 4 stems, best quality, ~3 GB VRAM, ~30s/min on RTX 3060
    htdemucs_6s     - 6 stems (adds guitar + piano), ~3.5 GB VRAM
    htdemucs        - 4 stems, original, faster fallback for CPU-only
"""

from __future__ import annotations

import io
import logging
import os
import tempfile
import threading
import time
import uuid
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import torch
import torchaudio
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from demucs.apply import apply_model
from demucs.audio import AudioFile, save_audio
from demucs.pretrained import get_model

# ─────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("omnitab.demucs")

# ─────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────

DEFAULT_MODEL = os.environ.get("OMNITAB_MODEL", "htdemucs_6s")
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
MAX_UPLOAD_MB = int(os.environ.get("OMNITAB_MAX_UPLOAD_MB", "60"))
ALLOWED_ORIGINS = os.environ.get(
    "OMNITAB_CORS_ORIGINS",
    "http://localhost:5173,http://localhost:4173",
).split(",")

log.info("device=%s default_model=%s", DEVICE, DEFAULT_MODEL)

# ─────────────────────────────────────────────────────────────────────────
# Model cache
# ─────────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────────
# Job tracking (for long-running separations)
# ─────────────────────────────────────────────────────────────────────────


@dataclass
class Job:
    id: str
    status: str = "pending"  # pending | running | done | error
    progress: float = 0.0
    message: str = ""
    result_path: Optional[Path] = None
    started_at: float = field(default_factory=time.time)
    error: Optional[str] = None


_jobs: dict[str, Job] = {}
_jobs_lock = threading.Lock()


def get_job(job_id: str) -> Job:
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return job


def update_job(job_id: str, **kwargs) -> None:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            return
        for k, v in kwargs.items():
            setattr(job, k, v)


# ─────────────────────────────────────────────────────────────────────────
# Separation core
# ─────────────────────────────────────────────────────────────────────────


def separate_audio(
    file_bytes: bytes,
    model_name: str,
    on_progress=None,
) -> dict[str, bytes]:
    """
    Run Demucs on raw audio bytes and return a dict of {stem_name: wav_bytes}.

    Uses Demucs' streaming API so big files don't OOM. The on_progress
    callback (if provided) is called with (stage, fraction).
    """
    model = load_model(model_name)

    # Demucs needs a file path — write to a tempfile.
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_in:
        tmp_in.write(file_bytes)
        in_path = Path(tmp_in.name)

    try:
        if on_progress:
            on_progress("loading", 0.05)

        wav = AudioFile(in_path).read(
            streams=0,
            samplerate=model.samplerate,
            channels=model.audio_channels,
        )
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / ref.std()

        if on_progress:
            on_progress("separating", 0.2)

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

        if on_progress:
            on_progress("encoding", 0.85)

        # Encode each stem to WAV bytes in-memory.
        stems: dict[str, bytes] = {}
        for name, source in zip(model.sources, sources):
            buf = io.BytesIO()
            save_audio(source, buf, samplerate=model.samplerate)
            stems[name] = buf.getvalue()

        if on_progress:
            on_progress("done", 1.0)

        return stems
    finally:
        try:
            in_path.unlink()
        except OSError:
            pass


# ─────────────────────────────────────────────────────────────────────────
# FastAPI app
# ─────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="OmniTab Demucs Backend",
    description="Local-only stem-separation server for the OmniTab PWA.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


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


@app.get("/models")
def models():
    return {
        "available": [
            "htdemucs",
            "htdemucs_ft",
            "htdemucs_6s",
            "mdx",
            "mdx_extra",
        ],
        "default": DEFAULT_MODEL,
        "loaded": list(_model_cache.keys()),
    }


def _validate_upload(file: UploadFile) -> bytes:
    data = file.file.read()
    if len(data) == 0:
        raise HTTPException(400, "empty upload")
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(
            413, f"file too large (>{MAX_UPLOAD_MB} MB)"
        )
    return data


@app.post("/separate")
def separate(
    file: UploadFile = File(...),
    model: str = Query(DEFAULT_MODEL, description="Demucs model name"),
):
    """
    Synchronous separation. Returns a ZIP file containing one WAV per stem.

    Use this for short clips (<2 min). For full songs prefer /separate-async.
    """
    data = _validate_upload(file)
    log.info(
        "/separate file=%s size=%d model=%s",
        file.filename,
        len(data),
        model,
    )

    try:
        stems = separate_audio(data, model)
    except Exception as exc:
        log.exception("separation failed")
        raise HTTPException(500, f"separation failed: {exc}")

    # Bundle stems into a ZIP.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, wav_bytes in stems.items():
            zf.writestr(f"{name}.wav", wav_bytes)
    buf.seek(0)

    base = Path(file.filename or "song").stem
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{base}_stems.zip"'
        },
    )


@app.post("/separate-stream")
def separate_stream(
    file: UploadFile = File(...),
    stem: str = Query("vocals", description="Stem name to return"),
    model: str = Query(DEFAULT_MODEL),
):
    """
    Run separation but return only ONE stem as a streaming WAV.

    Useful when the PWA only wants the vocal stem (for melody extraction)
    and you don't want to download a 100 MB ZIP over Wi-Fi.
    """
    data = _validate_upload(file)
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
        headers={
            "Content-Disposition": f'attachment; filename="{stem}.wav"'
        },
    )


@app.post("/separate-async")
def separate_async(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    model: str = Query(DEFAULT_MODEL),
):
    """
    Kick off a background separation job and return a job_id.
    Poll /jobs/{job_id} for progress, then GET /jobs/{job_id}/result to download.
    """
    data = _validate_upload(file)
    job = Job(id=str(uuid.uuid4()), status="pending")
    with _jobs_lock:
        _jobs[job.id] = job

    background_tasks.add_task(_run_async_job, job.id, data, model)
    return {"job_id": job.id, "status": "pending"}


def _run_async_job(job_id: str, data: bytes, model: str):
    update_job(job_id, status="running", progress=0.0)

    def progress(stage: str, fraction: float):
        update_job(job_id, message=stage, progress=fraction)

    try:
        stems = separate_audio(data, model, on_progress=progress)
    except Exception as exc:
        log.exception("async separation failed")
        update_job(job_id, status="error", error=str(exc))
        return

    # Stash result on disk so the polling client can download it later.
    out_dir = Path(tempfile.gettempdir()) / "omnitab-jobs" / job_id
    out_dir.mkdir(parents=True, exist_ok=True)
    zip_path = out_dir / "stems.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, wav_bytes in stems.items():
            zf.writestr(f"{name}.wav", wav_bytes)

    update_job(
        job_id,
        status="done",
        progress=1.0,
        result_path=zip_path,
        message="ready",
    )


@app.get("/jobs/{job_id}")
def job_status(job_id: str):
    job = get_job(job_id)
    return {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "message": job.message,
        "error": job.error,
        "elapsed": time.time() - job.started_at,
    }


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str):
    job = get_job(job_id)
    if job.status != "done" or not job.result_path:
        raise HTTPException(409, f"job not ready (status={job.status})")
    return StreamingResponse(
        job.result_path.open("rb"),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{job_id}_stems.zip"'
        },
    )


@app.exception_handler(Exception)
async def fallback_exc(request, exc):
    log.exception("unhandled exception")
    return JSONResponse(
        status_code=500,
        content={"error": str(exc), "type": exc.__class__.__name__},
    )


# ─────────────────────────────────────────────────────────────────────────
# Local dev entry point
# ─────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    # Pre-warm the default model so the first request doesn't pay the load cost.
    try:
        load_model(DEFAULT_MODEL)
    except Exception:
        log.warning(
            "could not pre-load %s — will load on first request", DEFAULT_MODEL
        )

    uvicorn.run(
        app,
        host="0.0.0.0",  # bind on LAN so the phone PWA can reach it
        port=int(os.environ.get("OMNITAB_PORT", "8000")),
        log_level="info",
    )
