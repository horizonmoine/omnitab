# OmniTab Demucs Backend

A tiny FastAPI server that wraps Facebook Research's
[Demucs](https://github.com/facebookresearch/demucs) so the OmniTab PWA can
separate songs into stems (vocals / bass / drums / other / guitar / piano)
without uploading anything to a third-party API.

The PWA reaches this server over your local LAN at
`http://<your-pc-ip>:8000`.

---

## Quickstart (Windows / macOS / Linux)

```bash
cd backend

# 1. Create a venv (recommended)
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS / Linux
source .venv/bin/activate

# 2. Install PyTorch FIRST if you have a GPU.
# NVIDIA + CUDA 12.1 example:
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

# 3. Install the rest
pip install -r requirements.txt

# 4. Run
python server.py
# or, with autoreload:
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

The first request triggers a download of the Demucs model weights (~250 MB
for `htdemucs_6s`) into `~/.cache/torch/hub/checkpoints/`.

---

## Configuration (env vars)

| Variable                  | Default                                          | Notes                                  |
|---------------------------|--------------------------------------------------|----------------------------------------|
| `OMNITAB_MODEL`           | `htdemucs_6s`                                    | Demucs model name                      |
| `OMNITAB_PORT`            | `8000`                                           | TCP port                               |
| `OMNITAB_MAX_UPLOAD_MB`   | `60`                                             | Reject uploads bigger than this        |
| `OMNITAB_CORS_ORIGINS`    | `http://localhost:5173,http://localhost:4173`    | Comma-separated list of allowed origins. Add your phone's IP if needed. |

### Allowing your phone

If you open the PWA on `http://192.168.1.42:5173` from your Samsung A52s,
add that origin to `OMNITAB_CORS_ORIGINS`:

```bash
OMNITAB_CORS_ORIGINS="http://localhost:5173,http://192.168.1.42:5173" python server.py
```

---

## Endpoints

| Method | Path                       | Description                                              |
|--------|----------------------------|----------------------------------------------------------|
| GET    | `/health`                  | Liveness + device info                                   |
| GET    | `/models`                  | List available + loaded models                           |
| POST   | `/separate`                | Synchronous: upload audio → ZIP of all stems             |
| POST   | `/separate-stream?stem=vocals` | Synchronous: return only one stem as a WAV          |
| POST   | `/separate-async`          | Background job → returns `job_id`                        |
| GET    | `/jobs/{job_id}`           | Poll job status                                          |
| GET    | `/jobs/{job_id}/result`    | Download finished ZIP                                    |

### Example with curl

```bash
# Sync — short clip
curl -X POST -F "file=@chorus.wav" http://localhost:8000/separate \
     -o stems.zip

# Vocal stem only
curl -X POST -F "file=@song.mp3" \
     "http://localhost:8000/separate-stream?stem=vocals" \
     -o vocals.wav

# Background job
curl -X POST -F "file=@fullsong.flac" http://localhost:8000/separate-async
# → {"job_id": "abc123", "status": "pending"}
curl http://localhost:8000/jobs/abc123
curl http://localhost:8000/jobs/abc123/result -o stems.zip
```

---

## Hardware notes

| Setup            | `htdemucs_6s` per minute of audio |
|------------------|-----------------------------------|
| RTX 3060 (12 GB) | ~10 s                             |
| RTX 2070         | ~15 s                             |
| Apple M2         | ~25 s (MPS)                       |
| CPU-only (i7)    | ~120 s                            |

If you only need 4 stems, switch to `htdemucs_ft` for slightly higher quality
or `htdemucs` for the fastest baseline.

---

## Troubleshooting

* **`OutOfMemoryError`** — drop the model to `htdemucs` (smaller) or set
  `--shifts 0` in `apply_model`.
* **`Could not find soundfile`** — `pip install soundfile` (already in
  requirements but pip cache can lie).
* **Phone can't reach the server** — make sure your PC and phone are on the
  same Wi-Fi, the firewall allows port 8000, and `OMNITAB_CORS_ORIGINS`
  includes the phone's origin.
* **First request takes forever** — the model is downloading. Pre-warm with
  `python -c "from demucs.pretrained import get_model; get_model('htdemucs_6s')"`.
