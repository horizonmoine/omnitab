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

import gc
import hashlib
import io
import logging
import os
import tempfile
import threading
from collections import OrderedDict
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


# ── Per-file separation cache ────────────────────────────────────────────
#
# The PWA's "Tout faire" pipeline calls /separate-stream once per stem
# (vocals, drums, bass, other = 4 calls per song). Without this cache, we'd
# run the full Demucs separation FOUR times for the same audio — wasting
# ~9 minutes of CPU time per song AND building up enough memory pressure
# (Demucs forward + 4 stem WAVs + StreamingResponse buffer) that the 4th
# call OOM-kills the worker on HF Space CPU Basic (16 GB RAM but shared
# with other tenants in practice).
#
# The cache stores the *full* dict {stem_name: wav_bytes} for each input
# file, keyed by SHA256(file_bytes) + model_name. The first call computes
# everything and stores it; subsequent calls for other stems of the same
# file hit the cache in <100ms.
#
# Capacity: MAX=2 entries → ~400 MB worst case (each entry ≈ 4 stems ×
# 40 MB WAV ≈ 200 MB for a typical 4-min song). LRU eviction so the most
# recent file's stems stay hot. Lock-protected for thread safety even
# though FastAPI runs single-worker by default — defensive habit.

_separation_cache: "OrderedDict[str, dict[str, bytes]]" = OrderedDict()
_separation_cache_lock = threading.Lock()
_SEPARATION_CACHE_MAX = 2


def _cache_get(key: str) -> dict[str, bytes] | None:
    with _separation_cache_lock:
        result = _separation_cache.get(key)
        if result is not None:
            # LRU touch: move to end so most-recently-used is freshest.
            _separation_cache.move_to_end(key)
        return result


def _cache_put(key: str, value: dict[str, bytes]) -> None:
    with _separation_cache_lock:
        _separation_cache[key] = value
        _separation_cache.move_to_end(key)
        # Evict oldest entries if we're over capacity. Force a GC pass
        # after eviction so the underlying bytes objects (~200 MB each)
        # actually return to the OS instead of sitting in Python's heap.
        evicted = False
        while len(_separation_cache) > _SEPARATION_CACHE_MAX:
            old_key, _old_value = _separation_cache.popitem(last=False)
            log.info("separation cache  evict  key=%s", old_key[:16])
            evicted = True
        if evicted:
            gc.collect()


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

        # Demucs's save_audio() forwards to torchaudio.save() which calls
        # os.fspath() on the destination — that means it requires a real
        # filesystem path (str/Path), NOT an io.BytesIO. A previous version
        # of this file passed a BytesIO and worked because of a particular
        # torchaudio version that auto-bridged to libsndfile via the file
        # descriptor; the current torch/torchaudio combo (2.5.1 CPU) has
        # tightened that and raises TypeError. The fix is to write each
        # stem to a per-stem temp file, slurp it back, then delete it.
        stems: dict[str, bytes] = {}
        out_paths: list[Path] = []
        try:
            for name, source in zip(model.sources, sources):
                # delete=False so we can re-open by path on Windows-style
                # filesystems (HF Space is Linux but keeping the pattern
                # consistent with the input tempfile above).
                with tempfile.NamedTemporaryFile(
                    suffix=".wav", delete=False
                ) as tmp_out:
                    out_path = Path(tmp_out.name)
                out_paths.append(out_path)
                save_audio(source, str(out_path), samplerate=model.samplerate)
                stems[name] = out_path.read_bytes()
        finally:
            for p in out_paths:
                try:
                    p.unlink()
                except OSError:
                    pass

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

    # Cache key: SHA256 of file bytes + model name. The PWA calls this
    # endpoint 4× per song (one per stem), and we want all four calls to
    # hit the same cache entry — so we hash the bytes, not the filename
    # (different uploads of the same audio collide cleanly, and the same
    # audio uploaded with a different filename also collides cleanly).
    cache_key = f"{model}:{hashlib.sha256(data).hexdigest()}"

    cached = _cache_get(cache_key)
    if cached is not None:
        log.info(
            "/separate-stream  cache_HIT  file=%s  stem=%s  model=%s",
            file.filename,
            stem,
            model,
        )
        stems = cached
    else:
        log.info(
            "/separate-stream  cache_MISS  file=%s  size=%d  stem=%s  model=%s",
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
        _cache_put(cache_key, stems)

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
