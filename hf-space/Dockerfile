# OmniTab Demucs — Hugging Face Spaces (Docker, CPU Basic)

FROM python:3.10-slim

ENV PORT=7860
ENV OMNITAB_MODEL=htdemucs
ENV OMNITAB_CORS_ORIGINS=*
ENV OMNITAB_MAX_UPLOAD_MB=50

WORKDIR /app

COPY requirements.txt .
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg libsndfile1 && \
    rm -rf /var/lib/apt/lists/* && \
    pip install --no-cache-dir \
      torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt && \
    rm -rf /root/.cache/pip /tmp/*

# Force-refresh yt-dlp on every rebuild. YouTube rotates its player API
# constantly and an outdated yt-dlp surfaces as "SSL: UNEXPECTED_EOF" or
# "Sign in to confirm you're not a bot" with no other signal. Splitting
# this into its own layer means we can poke this RUN line (e.g. via the
# ARG below) to invalidate the cache without touching requirements.txt.
ARG YTDLP_CACHE_BUST=2026-04-25-2
RUN echo "yt-dlp cache-bust: ${YTDLP_CACHE_BUST}" && \
    pip install --no-cache-dir --upgrade yt-dlp && \
    yt-dlp --version

COPY app.py .

EXPOSE ${PORT}

CMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860", "--timeout-keep-alive", "300"]
