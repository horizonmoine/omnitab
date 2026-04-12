# 🎸 OmniTab — Guitar Companion PWA

> Lecteur de tablatures, accordeur, simulateur d'ampli et **transcription audio → tab par IA**, le tout dans une seule PWA qui marche offline sur ton Samsung A52s + iRig Micro Amp.

```
            ┌────────────────────────────────────────────────────┐
            │                    OmniTab PWA                     │
            │   (Vite + React + TS, 100% client-side, offline)   │
            └────────────────────────────────────────────────────┘
                                  │
       ┌──────────┬─────────┬─────┴─────┬──────────┬──────────┐
       │          │         │           │          │          │
   AlphaTab  basic-pitch  pitchy   Web Audio    Dexie     Songsterr
   (viewer)  (TS, ML)    (tuner)  (amp sim)  (IndexedDB)  (search)
                                                                │
                                                          ┌─────┴─────┐
                                                          │  Demucs   │
                                                          │  backend  │
                                                          │ (FastAPI) │
                                                          └───────────┘
```

---

## ✨ Fonctionnalités

| Module              | Description                                                                   |
|---------------------|-------------------------------------------------------------------------------|
| 🔍 **Rechercher**    | API Songsterr publique, > 1 M de tabs vérifiées                               |
| 📚 **Bibliothèque**  | Stockage IndexedDB, import .gp/.gp5/.gpx/.musicxml/.tex, favoris, filtres    |
| 🎼 **Lecteur**       | AlphaTab — moteur GP3-7, MusicXML, alphaTex avec player MIDI intégré         |
| 🎯 **Accordeur**     | Pitch detection temps réel via pitchy (YIN/McLeod), ±1 cent                   |
| 🎚️ **Ampli**         | Simulateur Web Audio (4 presets, drive/EQ/master, 3 voicings)                 |
| 🎙️ **Enregistrer**   | MediaRecorder, sauvegarde IndexedDB, hand-off direct vers Transcrire          |
| 🤖 **Transcrire**    | **2 modes** : (A) *Guitare réelle* — ce qui est joué sur l'audio, Viterbi placement ; (B) *Chant + accords* — extraction mélodie/basse et arrangement fingerstyle. Optionnel : Demucs pour isoler un stem avant la transcription. |

---

## 🚀 Démarrage rapide

### Prérequis

* **Node 20+** et npm
* (Optionnel) **Python 3.10+** et `pip` pour le backend Demucs
* (Optionnel) **GPU NVIDIA + CUDA** pour accélérer Demucs ×10

### Installation du frontend

```bash
git clone <repo> omnitab
cd omnitab
npm install
npm run dev
```

→ Ouvre `http://localhost:5173`. Le serveur écoute aussi sur ton IP LAN
(grâce à `host: true` dans `vite.config.ts`), donc tu peux ouvrir l'app
**directement depuis ton Samsung A52s** sur le même Wi-Fi avec
`http://<ip-de-ton-pc>:5173`.

### Premier usage

1. **Branche l'iRig Micro Amp** sur le port USB du téléphone (ou ton PC).
2. **Ouvre l'app** dans Chrome mobile, accepte la permission micro.
3. **Installe-la** comme PWA via `⋮ → Installer l'application`.
4. À partir de la 2e visite tout marche **offline**, y compris la
   transcription IA (modèle basic-pitch caché par le service worker).

---

## 🧪 Build de production

```bash
npm run build         # ESM bundle + service worker dans dist/
npm run preview       # Preview locale du build
```

Déploie `dist/` sur n'importe quel host statique :

* **Vercel** : `vercel --prod` (les SPA fallbacks sont auto)
* **GitHub Pages** : push `dist/` sur `gh-pages` branch
* **Cloudflare Pages** : `wrangler pages deploy dist`
* **Self-hosted** : `nginx -s reload` pointant sur `dist/`

---

## ⚙️ Variables d'environnement

Crée un `.env.local` à la racine si tu veux personnaliser :

```env
# Optionnel : proxy CORS pour Songsterr (en cas de blocage géo)
VITE_SONGSTERR_PROXY=https://corsproxy.io/?

# Optionnel : URL du backend Demucs (défaut: http://localhost:8000)
VITE_DEMUCS_API=http://192.168.1.42:8000
```

---

## 🐍 Backend Demucs (optionnel)

Le backend Python sert UNIQUEMENT à la séparation de stems
(vocals/drums/bass/other/guitar/piano). Tout le reste tourne dans le
navigateur.

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # ou .venv\Scripts\activate sur Windows

# Si GPU NVIDIA, installer torch CUDA d'abord
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121

pip install -r requirements.txt
python server.py
```

→ FastAPI sur `http://0.0.0.0:8000`. Voir [`backend/README.md`](backend/README.md).

---

## 🏗️ Architecture

```
src/
├── main.tsx                 — entry, monte <App/> + service worker
├── App.tsx                  — shell, gère la navigation et les hand-offs entre pages
├── index.css                — Tailwind layers + tweaks PWA mobile
├── vite-env.d.ts            — types Vite client + virtual:pwa-register
│
├── components/              — UI React (1 par module)
│   ├── Layout.tsx           — sidebar desktop / bottom nav mobile (7 pages)
│   ├── TabSearch.tsx        — recherche Songsterr
│   ├── Library.tsx          — bibliothèque IndexedDB
│   ├── TabViewer.tsx        — wrapper React autour d'AlphaTab
│   ├── Tuner.tsx            — accordeur SVG
│   ├── AmpSim.tsx           — sim ampli avec knobs/presets
│   ├── Recorder.tsx         — MediaRecorder + liste des prises
│   └── Transcriber.tsx      — pipeline audio→tab IA (2 modes : Guitare réelle / Chant + accords)
│
└── lib/                     — logique pure (testable, sans React)
    ├── types.ts                 — types partagés (DetectedNote, TabNote, …)
    ├── guitarTunings.ts         — 8 accordages, helpers MIDI ↔ note
    ├── songsterr-api.ts         — search/download avec fallback proxy
    ├── audio-engine.ts          — AudioContext, mic, ampSim, decode/resample
    ├── pitch-detection.ts       — wrapper pitchy pour le tuner
    ├── basic-pitch.ts           — wrapper @spotify/basic-pitch (dynamic import)
    ├── midi-to-tab.ts           — Viterbi/greedy/lowest fret placement (+ allowedStrings)
    ├── alpha-tab-converter.ts   — Transcription → alphaTex
    ├── chord-melody.ts          — extractMelodyAndAccompaniment + generateChordMelody
    ├── demucs-client.ts         — client du backend FastAPI (séparation de stems)
    └── db.ts                    — Dexie schema + helpers IndexedDB
```

### Pipeline de transcription (commun aux 2 modes)

```
File/Blob ─→ [Demucs isolate stem (optionnel, via backend)]
          ─→ decodeAndResample(22050 Hz mono)
          ─→ basic-pitch.transcribeAudio() ─→ DetectedNote[]
          ─→ {divergence suivant le mode choisi} ────────┐
                                                         │
                                                         ▼
                                          transcriptionToAlphaTex()
                                          → AlphaTab.tex(string)
```

### Mode A — « Guitare réelle » 🎸

Transcrit ce qui est *vraiment joué à la guitare* sur l'enregistrement. Idéal
pour apprendre un solo ou un riff.

```
DetectedNote[] ─→ filterGuitarNotes()         ─→ DetectedNote[]
               ─→ assignViterbi(tuning)       ─→ TabNote[]
```

### Mode B — « Chant + accords » 🎤

Génère un arrangement *fingerstyle pour guitare seule* à partir de la voix
(ou de la guitare rythmique). La mélodie va sur les cordes aiguës, la basse
sur les cordes graves, et ça donne une tablature que tu peux jouer en
accompagnant quelqu'un qui chante — ou en chantant toi-même.

```
DetectedNote[] ─→ extractMelodyAndAccompaniment()
                      ├─→ melody → assignViterbi(tuning, [3, 5]) ─┐
                      └─→ bass   → assignViterbi(tuning, [0, 2]) ─┤
                                                                   ▼
                                                    merge + sort by time
                                                    → TabNote[]
```

Le paramètre `allowedStrings` de Viterbi contraint le placement : `[0, 2]` =
seulement les 3 cordes graves (E₂/A₂/D₃), `[3, 5]` = seulement les 3 cordes
aiguës (G₃/B₃/E₄). Ça évite les collisions de registre quand on fait jouer
mélodie + basse sur la même guitare.

### À quoi sert l'IA dans l'app ?

| Rôle                                     | Composant                          |
|------------------------------------------|------------------------------------|
| Détection polyphonique de notes (audio → MIDI) | `@spotify/basic-pitch` (TensorFlow.js, modèle ~2 MB caché par le SW) |
| Séparation de stems (voix / basse / guitare / etc.) | **Demucs** de Meta AI (backend Python optionnel) |
| Placement optimal des frettes (MIDI → onglet) | Algorithme de **Viterbi** (programmation dynamique, pas un modèle ML) |
| Accordeur temps réel                      | **pitchy** (YIN/McLeod, DSP classique — pas d'IA) |

Bref : l'IA sert à deux choses précises — *transcrire de l'audio en notes*
(basic-pitch) et *isoler un stem avant la transcription* (Demucs). Tout le
reste (placement des frettes, rendu, accordeur, ampli) est du DSP et de
l'algorithmique déterministe.

---

## 🧰 Stack technique

| Catégorie       | Choix                                                        |
|-----------------|--------------------------------------------------------------|
| Framework       | **Vite 6 + React 19 + TS** (strict)                          |
| Style           | TailwindCSS 3 (palette `amp-*` custom dans `tailwind.config.ts`) |
| Tab rendering   | **AlphaTab 1.5** (CDN jsDelivr, WebGL+SVG)                   |
| ML transcription| **@spotify/basic-pitch** (TF.js, polyphonique)               |
| Pitch (tuner)   | **pitchy** (YIN/McLeod, < 1 KB)                              |
| Music theory    | **tonal** (chord parser, intervals)                          |
| Storage         | **Dexie 4** (IndexedDB wrapper)                              |
| PWA             | **vite-plugin-pwa** + Workbox (autoUpdate)                   |
| Backend (opt)   | **FastAPI + Demucs htdemucs_6s**                             |

---

## 🔐 Confidentialité

* **Aucun upload** : tout se passe dans le navigateur.
* Le backend Demucs (si installé) tourne sur ton PC, pas dans le cloud.
* Songsterr est appelé en CORS direct (ou via proxy si tu en configures un)
  uniquement pour la recherche de tabs.
* Aucun tracker, aucun analytics, aucun cookie tiers.

---

## 🛣️ Roadmap

- [ ] Mode "looper" dans le Recorder (overdub multi-pistes)
- [ ] Export Guitar Pro depuis l'éditeur (alphaTex → .gp5 via alphaTab.export)
- [ ] Détection automatique d'accords depuis l'audio (chord-extractor browser)
- [ ] Mode "play-along" : audio original + tab synchronisée
- [ ] Capacitor build → vrai .apk Android pour distribution sideload
- [ ] Mode entraînement : ralentit les sections difficiles, boucle, métronome

---

## 📜 Licences tierces

| Lib                       | Licence       |
|---------------------------|---------------|
| AlphaTab                  | MPL 2.0       |
| @spotify/basic-pitch      | Apache 2.0    |
| pitchy                    | Apache 2.0    |
| Demucs                    | MIT           |
| tonal                     | MIT           |
| Dexie                     | Apache 2.0    |
| React, Vite, Tailwind     | MIT           |

---

## 🐛 Problèmes connus

* **iRig non détecté sur Android** → vérifier que le câble USB-C est bien
  un câble OTG (data) et pas seulement charge.
* **Larsens dans l'AmpSim** → utiliser un casque, JAMAIS les haut-parleurs
  internes du téléphone.
* **basic-pitch lent au premier chargement** → c'est normal, le modèle (~2 MB)
  est téléchargé puis caché. Visites suivantes : instant.
* **Songsterr CORS bloqué** → mettre `VITE_SONGSTERR_PROXY=https://corsproxy.io/?`
  dans `.env.local`.

---

## 💬 Contribuer

Le code est volontairement compact et modulaire. Le meilleur point d'entrée
si tu veux bidouiller :

* **Améliorer le placement de frettes** → `src/lib/midi-to-tab.ts`
  (les coûts dans `DEFAULT_COST_WEIGHTS` valent un long week-end de tuning)
* **Affiner l'extraction mélodie/basse** → `extractMelodyAndAccompaniment()`
  dans `src/lib/chord-melody.ts` (la taille de fenêtre et les seuils MIDI
  font toute la différence sur l'arrangement final)
* **Nouveaux voicings d'ampli** → `makeDistortionCurve()` dans `audio-engine.ts`
* **Support d'autres stems Demucs** → `demucs-client.ts` et `backend/server.py`

PR welcome 🎸
