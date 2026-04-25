# Self-hosted YouTube extraction backend

Deploys the same FastAPI + yt-dlp container as the OmniTab HuggingFace Space,
but on **your own VPS**. Use this when YouTube has blocked HF Space's
shared IP range (the SSL: UNEXPECTED_EOF error).

---

## ⚠️ Reality check first

This solves the YouTube extraction issue **only if your VPS's IP isn't
also blocked** by YouTube. YouTube blacklists entire datacenter IP
ranges, not specific IPs.

| Provider | Likely outcome | Cost |
|---|---|---|
| **Hetzner** (CX11, etc.) | ✅ Usually works | ~5 €/mois |
| **Contabo / BuyVM / RackNerd** | ✅ Usually works | ~3-5 $/mois |
| **Oracle Cloud Always Free** | ⚠️ Hit-or-miss (big DC) | 0 € |
| **AWS / GCP / Azure** | ❌ Almost always blocked | Varies |
| **Render / Railway / Fly.io free tier** | ❌ Same issue as HF | 0 € |

**Cheapest reliable option: Hetzner CX11 at ~5 €/month.**
Cheapest "might work" option: Oracle Cloud Always Free (signup is painful).

---

## Quick deploy (Hetzner CX11 example, ~10 min)

### 1. Provision the VPS

- Sign up at https://hetzner.com (Cloud → CX11, Ubuntu 24.04, Frankfurt or Helsinki)
- Add your SSH key during creation
- Note the public IP

### 2. SSH in and install Docker

```bash
ssh root@<your-vps-ip>
apt update && apt install -y docker.io docker-compose-v2 git curl
systemctl enable --now docker
```

### 3. Clone the repo and start the container

```bash
git clone https://github.com/horizonmoine/omnitab.git
cd omnitab/selfhost
docker compose up -d --build
```

The first build downloads PyTorch CPU + Demucs (~2 GB) and takes 5-10 minutes.
Watch progress with `docker compose logs -f`.

### 4. Verify it's running

```bash
curl http://localhost:8000/health
# Expected: {"status":"ok","device":"cpu",...}

curl "http://localhost:8000/youtube-audio?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ" -o test.mp3
# Expected: a real MP3 file (~3 MB). If you get an SSL EOF, your VPS IP
# is also blocked — try a different provider.
```

### 5. Wire up HTTPS (required — Vercel won't call HTTP backends in prod)

The simplest free option is **Cloudflare Tunnel** — gives you a public
HTTPS URL with no domain needed and no certbot.

```bash
# Install cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o cf.deb
dpkg -i cf.deb

# Run a quick (anonymous) tunnel — gets you a *.trycloudflare.com URL
cloudflared tunnel --url http://localhost:8000
```

Cloudflare prints a URL like `https://random-words.trycloudflare.com`. Test it:

```bash
curl https://random-words.trycloudflare.com/health
```

For a stable URL (the trycloudflare.com one is ephemeral), create a
Cloudflare account and a named tunnel — see
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/.

Alternative: install Caddy and point a domain at the VPS — Caddy
auto-provisions Let's Encrypt certs:

```bash
apt install -y caddy
echo "your-domain.com {
  reverse_proxy localhost:8000
}" > /etc/caddy/Caddyfile
systemctl restart caddy
```

### 6. Tell Vercel to use the new backend

In your Vercel project settings → Environment Variables, add:

```
OMNITAB_YT_BACKEND_URL = https://your-tunnel-or-domain.example
```

Apply to **Production** (and Preview if you want it on PR deploys).
Trigger a redeploy from the Vercel dashboard (Deployments → ⋯ → Redeploy)
so the env var picks up.

The Vercel proxy now tries your backend FIRST, falls back to the HF Space
only if your backend errors out. You can verify with:

```bash
curl -I "https://omnitab-henna.vercel.app/api/youtube-audio?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ"
# Look for: X-Omnitab-Source: custom
```

---

## Operations

### Updating yt-dlp

YouTube updates its anti-bot every few weeks. To pull the latest yt-dlp:

```bash
cd ~/omnitab/selfhost
git pull
# Bump YTDLP_CACHE_BUST so Docker invalidates the layer cache
sed -i 's/YTDLP_CACHE_BUST:-[^}]*/YTDLP_CACHE_BUST:-'"$(date +%F-rebuild)"'/' docker-compose.yml
docker compose up -d --build
```

### Watching logs

```bash
docker compose logs -f --tail 200 omnitab-yt
```

### Stopping / restarting

```bash
docker compose down
docker compose up -d
```

### Disk usage

The image is ~3 GB (PyTorch + Demucs models). Old builds pile up — clean
periodically:

```bash
docker system prune -a -f
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `SSL: UNEXPECTED_EOF` on test curl | Your VPS IP is blocked too | Try a different provider |
| `Connection refused` on `localhost:8000` | Container crashed | `docker compose logs omnitab-yt` |
| Vercel proxy still hits HF Space | Env var not applied | Redeploy via Vercel dashboard after setting |
| `cloudflared` URL changes on each restart | Using the anonymous quick tunnel | Create a named tunnel (free Cloudflare account) |
| Docker build fails on `pip install torch` | OOM (need ≥1 GB RAM) | Resize VPS or use swap (`fallocate -l 2G /swap && mkswap /swap && swapon /swap`) |

---

## Falling back

If your VPS gets blocked too (it happens), the Vercel proxy automatically
falls back to the HF Space. So **you can keep the VPS as a primary even
if it's intermittently blocked** — the user still gets a working YT
extraction whenever EITHER backend works.

And if both fail, the PWA shows the cobalt.tools workaround (see the
collapsible help panel on the Transcribe page).
