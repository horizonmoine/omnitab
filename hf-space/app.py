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

import hashlib
import io
import logging
import os
import tempfile
import threading
import time
from pathlib import Path

import torch
import torchaudio
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse

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


# ── Per-file separation cache (on-disk) ──────────────────────────────────
#
# The PWA's "Tout faire" pipeline calls /separate-stream once per stem
# (vocals, drums, bass, other = 4 calls per song). Without caching, we'd
# run the full Demucs separation FOUR times — wasting ~9 minutes of CPU
# AND OOM-killing the worker on HF Space CPU Basic.
#
# The previous attempt at this cached the dict {stem: bytes} IN MEMORY,
# which kept ~160 MB held per file plus the StreamingResponse buffer plus
# the 250 MB Demucs model = OOM during streaming of stem 2. Fix: write
# stems to /tmp on disk and stream them back via FileResponse. FileResponse
# uses zero-copy sendfile() in Starlette — the WAV bytes never enter
# Python's address space, so memory stays at ~250 MB (just the model)
# regardless of how many cached stems exist.
#
# Layout:  /tmp/omnitab_separations/<model>__<sha256-of-file>/<stem>.wav
#
# Eviction: TTL-based. On each new separation we sweep dirs older than
# SEPARATION_TTL_S (default 1 hour). Disk usage caps at ~10 GB worst case
# even under heavy use — HF Space CPU Basic has 50 GB ephemeral so plenty.

SEPARATION_ROOT = Path("/tmp/omnitab_separations")
SEPARATION_TTL_S = int(os.environ.get("OMNITAB_SEPARATION_TTL_S", "3600"))


def _separation_dir(file_bytes: bytes, model_name: str) -> Path:
    digest = hashlib.sha256(file_bytes).hexdigest()[:32]
    return SEPARATION_ROOT / f"{model_name}__{digest}"


def _sweep_old_separations() -> None:
    """Delete separation directories older than SEPARATION_TTL_S seconds.
    Cheap (just stat calls) so safe to run on every separation."""
    if not SEPARATION_ROOT.exists():
        return
    cutoff = time.time() - SEPARATION_TTL_S
    for d in SEPARATION_ROOT.iterdir():
        try:
            if d.is_dir() and d.stat().st_mtime < cutoff:
                for f in d.iterdir():
                    try:
                        f.unlink()
                    except OSError:
                        pass
                d.rmdir()
                log.info("separation cache  TTL evict  dir=%s", d.name)
        except OSError:
            pass


# ── Separation core ─────────────────────────────────────────────────────

def separate_audio_to_dir(
    file_bytes: bytes, model_name: str, out_dir: Path
) -> list[str]:
    """Run Demucs on raw audio bytes and write each stem to <out_dir>/<name>.wav.

    Returns the list of stem names produced (matches model.sources). Does
    NOT keep any of the stem audio in memory — bytes go straight to disk
    via demucs.save_audio() so /separate-stream can later stream them back
    via FileResponse without loading them into Python.
    """
    model = load_model(model_name)
    out_dir.mkdir(parents=True, exist_ok=True)

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

        # Write each stem directly to its final destination on disk.
        # demucs.save_audio() → torchaudio.save() requires a str path
        # (it calls os.fspath() under the hood). We pass the resolved
        # Path, no intermediate tempfile or in-memory buffer needed.
        produced: list[str] = []
        for name, source in zip(model.sources, sources):
            out_path = out_dir / f"{name}.wav"
            save_audio(source, str(out_path), samplerate=model.samplerate)
            produced.append(name)

        return produced
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

    # Cache lookup: directory keyed by SHA256(file_bytes) + model name.
    # The PWA calls this endpoint 4× per song (once per stem) with the
    # same body each time, so all four calls land in the same dir.
    out_dir = _separation_dir(data, model)
    expected_path = out_dir / f"{stem}.wav"

    if expected_path.exists() and expected_path.stat().st_size > 0:
        log.info(
            "/separate-stream  cache_HIT  file=%s  stem=%s  model=%s  size=%d",
            file.filename,
            stem,
            model,
            expected_path.stat().st_size,
        )
    else:
        log.info(
            "/separate-stream  cache_MISS  file=%s  size=%d  stem=%s  model=%s",
            file.filename,
            len(data),
            stem,
            model,
        )
        # Sweep stale entries before adding a new one — keeps disk usage
        # bounded under heavy traffic without needing a background worker.
        _sweep_old_separations()
        try:
            produced = separate_audio_to_dir(data, model, out_dir)
        except Exception as exc:
            log.exception("separation failed")
            raise HTTPException(500, f"separation failed: {exc}")
        if stem not in produced:
            raise HTTPException(
                404,
                f"stem '{stem}' not in model output. Available: {produced}",
            )

    if not expected_path.exists():
        # Should be impossible after a successful separation, but guard
        # against partial writes / race conditions.
        raise HTTPException(
            500, f"stem '{stem}' file missing after separation"
        )

    # FileResponse uses Starlette's zero-copy sendfile() path — the WAV
    # bytes never enter Python's address space, so memory stays at
    # ~250 MB (just the model) regardless of file size or concurrent
    # streams. This is the architectural fix for the OOM-on-stem-2 bug.
    return FileResponse(
        path=expected_path,
        media_type="audio/wav",
        filename=f"{stem}.wav",
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
        # YouTube rotates its anti-bot defenses every few weeks. The config
        # below reflects what's currently known to bypass the rate-limit /
        # SSL-EOF wall on shared-IP cloud infrastructure (HF Spaces, Vercel,
        # etc.) as of April 2026:
        #
        #   player_client=tv,mweb,web_safari,android_vr → these are the
        #     less-tracked client identities. The standard `android`/`web`
        #     /`ios` triad is heavily fingerprinted now and shared cloud
        #     IPs hit the rate limit ~immediately (visible as SSL: EOF on
        #     the API page download — YouTube drops the TLS handshake).
        #     `tv` (the TV interface) is the most reliable bypass because
        #     YouTube's TV API is less aggressively gated; `mweb` and
        #     `android_vr` have similar properties.
        #   retries / fragment_retries → 5 retries on HTTP errors.
        #   extractor_retries → 3 retries when YouTube returns a malformed
        #     response (separate code path from network retries in yt-dlp).
        #   socket_timeout=20 → bail fast on a hung connection so we don't
        #     occupy the HF Space's single FastAPI worker.
        #   user_agent → match a recent Safari to look like a real browser
        #     (the tv/mweb clients still send a UA header).
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
            "user_agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) "
                "Version/17.4 Safari/605.1.15"
            ),
            "extractor_args": {
                "youtube": {
                    # Order matters — we try them left to right.
                    # `tv` first because it's the least-blocked client.
                    "player_client": ["tv", "mweb", "web_safari", "android_vr"],
                    # Skip the redundant webpage download when extracting
                    # via tv/mweb (those clients don't need it). Saves
                    # ~3s and one round-trip that sometimes triggers the
                    # bot detector on its own.
                    "player_skip": ["webpage", "configs"],
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
