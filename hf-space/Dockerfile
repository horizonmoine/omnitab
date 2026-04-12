# OmniTab Demucs — Hugging Face Spaces (Docker, CPU Basic)
#
# This Dockerfile builds a minimal FastAPI server that wraps Facebook's Demucs
# stem-separation model. HF Spaces exposes port 7860 over HTTPS automatically.
#
# Build once (~10 min on HF), then the Space sleeps after 48h of inactivity.
# Cold starts take ~15-20s (model is cached in the image).
#
# The resulting image is ~4 GB (PyTorch CPU + Demucs weights).

FROM python:3.11-slim

# HF Spaces expects port 7860
ENV PORT=7860
# Use htdemucs (4 stems, lighter) on CPU — 6s model is heavier for CPU.
# Users can override via Space settings → env vars.
ENV OMNITAB_MODEL=htdemucs
# Allow any origin so the Vercel frontend can call us. The Space is public
# anyway, and there's no auth to protect. Tighten this if you add auth later.
ENV OMNITAB_CORS_ORIGINS=*
# Limit upload size to 50 MB — songs rarely exceed 30 MB as MP3/WAV.
ENV OMNITAB_MAX_UPLOAD_MB=50

WORKDIR /app

# System deps for torchaudio's soundfile backend
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsndfile1 && \
    rm -rf /var/lib/apt/lists/*

# Install Python deps. CPU-only torch keeps the image ~2 GB smaller than CUDA.
COPY requirements.txt .
RUN pip install --no-cache-dir \
    torch torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# Copy the server
COPY app.py .

# Pre-download the Demucs model weights at BUILD time so cold starts don't
# need to fetch ~300 MB from the internet. Demucs caches to ~/.cache/torch/hub.
RUN python -c "from demucs.pretrained import get_model; get_model('htdemucs')"

# HF Spaces healthcheck hits / or /health
HEALTHCHECK --interval=30s --timeout=5s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/health')" || exit 1

EXPOSE ${PORT}

# Run with uvicorn. --timeout-keep-alive 300 keeps connections alive for large uploads.
CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--timeout-keep-alive", "300"]
