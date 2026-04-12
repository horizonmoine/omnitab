# OmniTab Demucs — Hugging Face Spaces (Docker, CPU Basic)
#
# Optimized for HF Spaces' ~50 GB build disk limit.
# All heavy installs + cleanup in a single layer to minimize image size.

FROM python:3.10-slim

ENV PORT=7860
ENV OMNITAB_MODEL=htdemucs
ENV OMNITAB_CORS_ORIGINS=*
ENV OMNITAB_MAX_UPLOAD_MB=50

WORKDIR /app

# Single layer: system deps + Python deps + cleanup
# Combining everything avoids leftover layer bloat that can exceed disk limits.
COPY requirements.txt .
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsndfile1 && \
    rm -rf /var/lib/apt/lists/* && \
    pip install --no-cache-dir \
      torch torchaudio --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt && \
    rm -rf /root/.cache/pip /tmp/*

COPY app.py .

EXPOSE ${PORT}

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--timeout-keep-alive", "300"]
