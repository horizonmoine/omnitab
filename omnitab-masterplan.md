# OmniTab — Masterplan Technique Définitif

> **App perso guitare pour Samsung A52s 5G + iRig Micro Amp**
> Auteur : Kom | Date : 10/04/2026

---

## 0. Audit Indépendant — Pourquoi Chaque Choix (et Pas un Autre)

### 🔍 Rendu de tablatures : AlphaTab — AUCUN concurrent sérieux

| Librairie | GP files | Synth MIDI intégré | Playback/scroll | Tab-specific | Statut |
|---|---|---|---|---|---|
| **AlphaTab** | GP3-7 ✅ | ✅ alphaSynth | ✅ | ✅ conçu pour tabs | Actif (v1.9.0 en dev, issues Jan 2026) |
| VexFlow/VexTab | ❌ (notation manuelle) | ❌ | ❌ | Partiel | Actif mais général |
| Soundslice | Propriétaire | ✅ | ✅ | ✅ | Commercial, pas embeddable |
| OSMD | MusicXML only | ❌ | ❌ | ❌ | Notation classique |
| jTab | ❌ | ❌ | ❌ | Basique | Abandonné |

**Verdict : AlphaTab est le seul à lire des fichiers Guitar Pro ET avoir un synthétiseur intégré ET être open source. Pas de débat.**

---

### 🔍 Source de tablatures : Songsterr API — Meilleur compromis

| Source | API publique | Qualité | Catalogue | Légalité |
|---|---|---|---|---|
| **Songsterr** | ✅ REST, sans clé | Tabs GP vérifiées | 1M+ | API publique = toléré |
| Ultimate Guitar | ❌ (anti-scraping actif) | Très haute | Le plus grand | Scraping = risqué |
| Chordify | API limitée | Accords seulement | Large | OK |
| Musescore.com | ❌ (paywall 2023+) | Variable | Large | Bloqué |

**Verdict : Songsterr est la seule base de données massive avec une API publique fonctionnelle. UG a un meilleur catalogue mais bloque activement les scrapers.**

---

### 🔍 Transcription audio→notes : LE CHOIX CRITIQUE

C'est ici que la conversation Gemini se trompait le plus. Voici **tous** les modèles qui existent :

| Modèle | Spécialité | Params | Browser? | Guitar-specific | Qualité guitare |
|---|---|---|---|---|---|
| **Basic Pitch** (Spotify) | Général, polyphonique | 17K | ✅ TypeScript | ❌ | Correcte (~75%) |
| **Klangio API** (Guitar2Tabs) | Guitare spécifiquement | Propriétaire | Cloud API | ✅✅ | La meilleure (~85%) |
| **MT3** (Google Magenta) | Multi-instrument | 77M | ❌ Python/GPU | ❌ | Médiocre sur guitare (mal généralise) |
| **YourMT3+** | MT3 amélioré | ~100M+ | ❌ Python/GPU | ❌ | Meilleur que MT3, toujours lourd |
| **Omnizart** | Multi-tâches (notes+accords+drums+beats) | 8M | ❌ Python | ❌ | Correcte |
| **Kong-derived models** | Onset detection | ~20M | ❌ Python | Partiel | Bonne sur clean audio |

**Ce que Basic Pitch fait bien :** polyphonie, pitch bends, ultra-léger, tourne dans le browser.
**Ce que Basic Pitch fait mal :** pas optimisé guitare, placement de frettes impossible (il sort du MIDI brut, pas des positions guitare).

**Ce que Klangio fait en plus :** modèle entraîné spécifiquement sur guitare, séparation de stems intégrée, output directement en GP5 avec positions de frettes estimées, modes strumming/picking.

**Mon verdict révisé :**

| Usage | Meilleur choix | Pourquoi |
|---|---|---|
| Transcrire **ton propre jeu** (guitare seule, clean) | **Basic Pitch TS** (in-browser, gratuit) | Signal propre = Basic Pitch suffit |
| Transcrire un **morceau complet** (mix) | **Klangio API** (~6€/mois) | Stem separation + modèle guitare-spécifique intégrés |
| Transcription **offline/gratuite** de mix | **Demucs → Basic Pitch** (sur ton PC) | Gratuit mais moins précis que Klangio |

**La vraie réponse honnête : pour la meilleure qualité de transcription, Klangio API bat tout ce qui est open source.** C'est ~6€/mois. Pour 0€, Basic Pitch + Demucs est le meilleur combo mais avec ~10-15% de précision en moins.

---

### 🔍 Séparation de stems : Demucs — Toujours le roi open source

| Outil | Open source | Qualité (SDR) | Guitar stem | Prix |
|---|---|---|---|---|
| **Demucs htdemucs_ft** | ✅ MIT | 9.20 dB | Via `htdemucs_6s` (6 stems dont guitare) | Gratuit |
| Spleeter (Deezer) | ✅ | ~6 dB | ❌ | Gratuit, abandonné depuis 2019 |
| LALAL.AI (Orion) | ❌ Propriétaire | Comparable | ✅ | Payant |
| Moises.ai | ❌ Propriétaire | Très bon | ✅ | Payant |

**Verdict : Demucs reste state-of-the-art open source.** Mais attention : le repo Meta est archivé, le créateur a forké sur `github.com/adefossez/demucs`. `htdemucs_6s` isole spécifiquement la guitare (6 stems).

---

### 🔍 Framework app : PWA — Le bon choix pour TOI

| Option | Codebase unique | Audio USB | Offline | Ton expertise |
|---|---|---|---|---|
| **React PWA + Capacitor** | ✅ Web → PC + Android | ✅ Web Audio API | ✅ Service Worker | ✅ Tu connais |
| Kotlin natif (Gemini suggestion) | ❌ Android only | ✅ Oboe (meilleure latence) | ✅ | ❌ Tu ne connais pas |
| Flutter | ✅ Multi-plateforme | Partiel | ✅ | ❌ Tu ne connais pas Dart |
| React Native | ✅ | Partiel (bridges) | ❌ | ✅ Proche de React |
| Tauri (desktop) + PWA (mobile) | ❌ Deux projets | ✅ | ✅ | ✅ |

**Verdict : PWA est le bon choix.** La seule raison de passer natif serait si la latence audio <5ms était critique (monitoring en temps réel). Mais avec l'iRig, tu utilises le monitoring direct du speaker/casque de l'iRig (latence 0), donc le browser n'a besoin que d'enregistrer, pas de monitorer en temps réel.

---

### 🔍 Corrections Gemini

| Ce que Gemini a dit | Réalité |
|---|---|
| "Demucs maintenu par Meta" | **Non.** Forké sur `github.com/adefossez/demucs`, repo Meta archivé. |
| "Il faut scraper Songsterr" | **Non.** API publique REST sans clé : `songsterr.com/a/ra/songs.json?pattern=...` |
| "Basic Pitch = Python only" | **Non.** `basic-pitch-ts` (npm) tourne dans le browser via TensorFlow.js. |
| "Oboe obligatoire pour l'iRig" | **Non.** Web Audio API suffit pour l'enregistrement. Oboe = latence monitoring native, pas nécessaire ici. |
| "Basic Pitch = meilleur pour la guitare" | **Non.** Klangio API est nettement meilleur (modèle guitar-specific). Basic Pitch est le meilleur choix *gratuit*. |

---

## 1. Architecture Technique Définitive

### Décision : PWA (Progressive Web App) + Backend local optionnel

**Pourquoi PWA et pas natif :**
- Tu codes en JS/TS, pas en Kotlin
- Même codebase pour PC et Samsung
- Installable sur Android via Chrome ("Ajouter à l'écran d'accueil")
- Accès au micro/USB audio via Web Audio API
- Pas besoin du Play Store (sideload .apk via Capacitor si tu veux)

### Stack

| Couche | Techno | Pourquoi |
|---|---|---|
| **Frontend** | React + Vite + TailwindCSS | Ta stack habituelle, rapide à dev |
| **Rendu tabs** | AlphaTab (npm `@coderline/alphatab`) | Open source, GP3-7 + MusicXML + alphaTex, synth MIDI intégré, playback, scroll, tempo control, loop |
| **Audio capture** | Web Audio API | Capture micro/USB, FFT pour accordeur, WaveShaper pour ampli sim |
| **Transcription audio→MIDI** | `basic-pitch-ts` (npm) — mode gratuit/offline | Tourne dans le browser, polyphonique, pitch bend, ~2MB modèle |
| **Transcription audio→GP5** | **Klangio API** (klang.io/api) — mode qualité max | Guitar-specific, ~85% précision, output GP5 direct, ~6€/mois |
| **Séparation de stems** | Demucs v4 (`htdemucs_ft` / `htdemucs_6s`) via **FastAPI sur PC local** | Nécessaire uniquement en mode Basic Pitch (Klangio fait sa propre séparation) |
| **Recherche de tabs** | API Songsterr (REST, gratuite, sans clé) | 1M+ tabs GP, accès JSON direct |
| **Packaging mobile** | Capacitor (optionnel) ou PWA pure | PWA = zéro friction. Capacitor si tu veux un .apk |
| **Base de données locale** | IndexedDB (via Dexie.js) | Stockage offline des tabs, favoris, historique |

### Diagramme d'architecture

```
┌──────────────────────────────────────────────────────┐
│  FRONTEND (React PWA)                                │
│                                                      │
│  ┌─────────┐ ┌──────────┐ ┌────────────┐           │
│  │ Tuner   │ │ Amp Sim  │ │ Recorder   │           │
│  │ (FFT)   │ │(WaveShap)│ │(MediaRecor)│           │
│  └────┬────┘ └────┬─────┘ └─────┬──────┘           │
│       └──────────┬┘             │                    │
│            Web Audio API        │                    │
│                                 │                    │
│  ┌──────────────────────────────▼──────────────┐    │
│  │ AlphaTab (rendu + playback + éditeur)       │    │
│  │ Formats: GP3-7, MusicXML, alphaTex, MIDI    │    │
│  └──────────────────────────────▲──────────────┘    │
│                                 │                    │
│  ┌──────────────┐     ┌────────┴─────────┐         │
│  │ Songsterr    │     │ TRANSCRIPTION    │         │
│  │ API Search   │     │                  │         │
│  │ (1M+ tabs)   │     │  Route A: FREE   │         │
│  └──────────────┘     │  Basic Pitch TS  │         │
│                       │  (in-browser)    │         │
│                       │                  │         │
│                       │  Route B: BEST   │         │
│                       │  Klangio API     │         │
│                       │  (cloud, ~6€/mo) │         │
│                       └────────▲─────────┘         │
└────────────────────────────────┼─────────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼────────┐  ┌─────▼──────────────┐   │
    │ BACKEND PC local │  │ Klangio Cloud      │   │
    │ FastAPI + Demucs  │  │ (séparation +      │   │
    │ htdemucs_6s       │  │  transcription     │   │
    │ (stems → MIDI)    │  │  intégrées)        │   │
    └──────────────────┘  └────────────────────┘   │
    Route A only           Route B only             │
```

---

## 2. Modules Fonctionnels

### Module 1 : Recherche & Bibliothèque de Tabs

**Source primaire — API Songsterr (gratuite) :**
```javascript
// Recherche
fetch('https://www.songsterr.com/a/ra/songs.json?pattern=stairway+to+heaven')
  .then(r => r.json())
  .then(songs => {
    // songs = [{id, title, artist, ...}, ...]
    // Chaque song a un champ avec l'URL du fichier GP
  });
```

**Fonctionnalités :**
- Barre de recherche → interroge Songsterr
- Résultats avec artiste, titre, instruments dispo
- Téléchargement du fichier GP → stockage IndexedDB
- Tags manuels : "Original" vs "Cover/Arrangement"
- Favoris, historique, playlists d'entraînement
- Import manuel de fichiers .gp / .gpx / .gp5 / .musicxml

**Sources secondaires (optionnel, phase tardive) :**
- Scraping léger de tabs texte (Ultimate Guitar a des protections, à évaluer)
- Import depuis fichiers locaux téléchargés manuellement

---

### Module 2 : Lecteur de Tablatures (AlphaTab)

AlphaTab est LA librairie pour ça. Fonctionnalités natives :

| Feature | Supporté nativement |
|---|---|
| Rendu notation standard + tab | ✅ |
| Playback MIDI avec synth SoundFont | ✅ |
| Tempo control (slow down) | ✅ |
| Loop sur une section | ✅ |
| Multi-pistes (guitare, basse, drums) | ✅ |
| Solo/mute par piste | ✅ |
| Scroll automatique | ✅ |
| Responsive (s'adapte à l'écran) | ✅ |
| Formats : GP3-7, MusicXML, alphaTex | ✅ |
| Techniques : bends, slides, hammer-on, etc. | ✅ (rendu visuel) |

**Ce qu'il faut coder en plus :**
- Synchronisation avec l'audio original (overlay audio MP3 + position cursor)
- Mode "Original" vs "Cover" avec switch
- Compteur de mesures / marqueurs de sections (Intro, Verse, Chorus, Solo)
- Mode A/B loop avec sélection tactile

---

### Module 3 : Accordeur (Tuner)

**Algorithme : Auto-corrélation YIN (via Web Audio API)**

```
Flux : Micro/USB → AnalyserNode → FFT → YIN → Fréquence → Note la plus proche
```

| Feature | Détail |
|---|---|
| Accordages supportés | Standard (EADGBE), Drop D, Drop C, DADGAD, Open G, Open D, Half-step down, Full-step down, custom |
| Précision cible | ±1 cent |
| Affichage | Aiguille analogique + indicateur numérique (Hz + cents) |
| Détection de corde | Automatique (basée sur la fréquence) |
| Référence A4 | Configurable (440 Hz par défaut, 432 Hz option) |

**Librairies utiles :**
- `pitchy` (npm) — détection de pitch légère et précise via auto-corrélation
- Ou implémentation maison YIN (~100 lignes de JS)

---

### Module 4 : Simulateur d'Ampli

**Chaîne audio Web Audio API :**

```
GuitarInput → GainNode → WaveShaperNode → BiquadFilter(Low) → BiquadFilter(Mid) → BiquadFilter(High) → ConvolverNode(Cab IR) → GainNode(Master) → Output
```

| Paramètre | Contrôle |
|---|---|
| Gain (Drive) | Slider 0-10 |
| Bass | BiquadFilter lowshelf, 200Hz |
| Mid | BiquadFilter peaking, 800Hz |
| Treble | BiquadFilter highshelf, 3000Hz |
| Canal | Clean / Crunch / Lead (presets de courbe WaveShaper) |
| Reverb | ConvolverNode avec impulse response |
| Master Volume | GainNode final |
| Noise Gate | Seuil configurable |

**Presets de tone (exemples) :**
- "Clean Fender" : Gain 2, Bass 5, Mid 4, Treble 7
- "Crunch Marshall" : Gain 6, Bass 6, Mid 7, Treble 5
- "High Gain Mesa" : Gain 9, Bass 7, Mid 5, Treble 6
- "Blues BB King" : Gain 4, Bass 4, Mid 8, Treble 5

**Tone Match (feature avancée) :**
- Analyse spectrale du morceau original (FFT)
- Suggestion de réglages EQ pour s'en approcher sur l'iRig
- Pas de machine learning nécessaire — simple matching de courbe spectrale

---

### Module 5 : Enregistrement & Transcription AI

**Workflow :**

```
1. Enregistre (Web Audio → MediaRecorder → WAV blob)
2. Option A : Transcription directe (Basic Pitch TS, in-browser)
3. Option B : Séparation stems d'abord (envoi au PC → Demucs) puis transcription
4. Résultat : fichier MIDI
5. Conversion MIDI → format AlphaTab (alphaTex ou MusicXML)
6. Affichage dans le lecteur
```

**Basic Pitch dans le browser :**
```javascript
import { BasicPitch } from '@spotify/basic-pitch';
// Charge le modèle TensorFlow.js (~2MB)
// Renvoie : notes MIDI avec onset, offset, pitch, confidence
```

**Paramètres de transcription :**
- Onset threshold (sensibilité de détection)
- Min note length (filtrer les artefacts)
- Min/Max pitch (restreindre à la tessiture guitare : E2-E6)

**Conversion MIDI → Tab :**
C'est le problème le plus dur : une même note MIDI peut se jouer à plusieurs positions sur le manche. Algorithme de placement :

1. Pour chaque note MIDI, calculer toutes les positions possibles (corde, frette)
2. Minimiser la distance de déplacement sur le manche par rapport à la note précédente
3. Respecter la contrainte de 4 frettes max d'écart dans une position
4. Préférer les positions basses (cordes à vide, premières frettes) sauf si le contexte indique un jeu en position haute

**Librairie utile :** `tonal` (npm) pour la théorie musicale (intervalles, accords, gammes)

---

### Module 6 : Générateur de Cover / Chord-Melody

**C'est ta killer feature. Voici l'algorithme détaillé :**

```
ENTRÉE : Fichier audio d'un morceau complet
SORTIE : Tablature fingerstyle jouable par un seul guitariste

1. SÉPARATION (Demucs htdemucs_6s)
   → Stem "vocals" (la mélodie chantée)
   → Stem "guitar" (l'accompagnement original)
   → Stem "bass" (la ligne de basse)

2. TRANSCRIPTION (Basic Pitch)
   → Vocal stem → MIDI mélodie
   → Guitar stem → MIDI accords (optionnel, pour référence)

3. DÉTECTION D'ACCORDS
   → Depuis le MIDI guitare, identifier la progression harmonique
   → Ou utiliser une librairie de détection d'accords (autochords)
   → Résultat : [Am | F | C | G | ...] avec timing

4. PLACEMENT MÉLODIE (cordes aiguës)
   → Notes vocales MIDI → assignées aux cordes 1-2-3 (Mi aigu, Si, Sol)
   → Quantification rythmique (arrondir au 1/8 ou 1/16 note)
   → Transposition si nécessaire (voix trop grave/aiguë pour la guitare)

5. PLACEMENT BASSE (cordes graves)
   → Fondamentale de chaque accord → cordes 4-5-6 (Ré, La, Mi grave)
   → Pattern rythmique : basse sur temps 1 et 3, mélodie continue

6. VÉRIFICATION DE JOUABILITÉ
   → Distance max 5 frettes entre basse et mélodie
   → Pas de stretch impossible (>4 frettes entre doigts adjacents)
   → Ajuster l'octave de la basse ou de la mélodie si nécessaire

7. EXPORT
   → Générer un fichier alphaTex ou MusicXML
   → Afficher dans AlphaTab
```

**Niveaux de difficulté :**
- **Débutant** : Basse sur temps 1 uniquement, mélodie simplifiée (notes principales)
- **Intermédiaire** : Basse alternée (fondamentale + quinte), mélodie complète
- **Avancé** : Walking bass, fills, ornements

---

### Module 7 : Séparation de Stems (Backend PC)

**Setup du serveur local :**

```python
# server.py — FastAPI sur ton PC
from fastapi import FastAPI, UploadFile
import demucs.api

app = FastAPI()
separator = demucs.api.Separator(model="htdemucs_ft")

@app.post("/separate")
async def separate(file: UploadFile):
    # Sauvegarde temporaire
    audio_path = f"/tmp/{file.filename}"
    with open(audio_path, "wb") as f:
        f.write(await file.read())

    # Séparation
    origin, separated = separator.separate_audio_file(audio_path)

    # Retourne les stems en WAV
    # stems: vocals, drums, bass, other
    return {"stems": ["vocals.wav", "drums.wav", "bass.wav", "other.wav"]}

@app.post("/separate-guitar")
async def separate_guitar(file: UploadFile):
    # Utilise htdemucs_6s pour isoler spécifiquement la guitare
    separator_6s = demucs.api.Separator(model="htdemucs_6s")
    # stems: vocals, drums, bass, guitar, piano, other
    ...
```

**Alternatives sans PC :**
- Hugging Face Spaces (gratuit, lent, file d'attente)
- Replicate.com (crédits gratuits au début)
- lalal.ai / moises.ai (API payantes mais très bonnes)

---

## 3. Roadmap de Développement

### Phase 1 — Fondation (Semaine 1-2)
- [ ] Init projet React + Vite + TailwindCSS
- [ ] Intégrer AlphaTab (npm install, composant React)
- [ ] Charger et afficher un fichier .gp5 de test
- [ ] Playback MIDI fonctionnel
- [ ] Contrôles : play/pause, tempo slider, loop
- **Livrable** : Un lecteur de tabs fonctionnel dans le browser

### Phase 2 — Recherche Songsterr (Semaine 3)
- [ ] Barre de recherche
- [ ] Appels API Songsterr → résultats
- [ ] Download du fichier GP → IndexedDB
- [ ] Bibliothèque locale avec favoris
- **Livrable** : Chercher n'importe quel morceau → l'afficher → le jouer

### Phase 3 — Accordeur (Semaine 4)
- [ ] Accès micro via `getUserMedia`
- [ ] Implémentation YIN ou utilisation de `pitchy`
- [ ] UI avec aiguille + note détectée
- [ ] Support multi-accordages
- **Livrable** : Accordeur fonctionnel

### Phase 4 — Amp Sim (Semaine 5)
- [ ] Chaîne audio Web Audio API
- [ ] Contrôles : Gain, Bass, Mid, Treble
- [ ] Presets (Clean, Crunch, Lead)
- [ ] Reverb via ConvolverNode + IR gratuite
- **Livrable** : Simulateur d'ampli basique mais fonctionnel

### Phase 5 — Enregistrement + Transcription (Semaine 6-7)
- [ ] Enregistrement via MediaRecorder
- [ ] Intégration Basic Pitch TS
- [ ] Conversion MIDI → alphaTex
- [ ] Algorithme de placement sur le manche
- [ ] Affichage de la transcription dans AlphaTab
- **Livrable** : Enregistre-toi → obtiens une tab

### Phase 6 — Séparation de Stems (Semaine 8)
- [ ] Setup FastAPI + Demucs sur ton PC
- [ ] Endpoint `/separate` et `/separate-guitar`
- [ ] Frontend : upload audio → envoi au PC → réception des stems
- [ ] Chaîne complète : MP3 → stems → Basic Pitch → tab
- **Livrable** : Transcris n'importe quel morceau depuis un fichier audio

### Phase 7 — Générateur Cover/Chord-Melody (Semaine 9-10)
- [ ] Extraction mélodie vocale (stem vocal → MIDI)
- [ ] Détection d'accords
- [ ] Algorithme de fusion basse + mélodie
- [ ] Vérification de jouabilité
- [ ] Export alphaTex → AlphaTab
- **Livrable** : Upload un morceau → obtiens un arrangement fingerstyle

### Phase 8 — Polish & Mobile (Semaine 11-12)
- [ ] PWA manifest + service worker (offline)
- [ ] Responsive mobile (Samsung A52s)
- [ ] Test avec iRig Micro Amp (USB-OTG → Chrome Android)
- [ ] Capacitor build si tu veux un .apk
- [ ] Tone Match basique
- **Livrable** : App complète installable sur ton Samsung

---

## 4. Coûts Réels

### Option A : 100% Gratuit (Basic Pitch + Demucs)

| Poste | Coût |
|---|---|
| Développement (toi + AI coding) | 0 € |
| AlphaTab | 0 € (open source, MPL-2.0) |
| Basic Pitch TS | 0 € (open source, Apache 2.0) |
| Demucs | 0 € (open source, MIT) |
| API Songsterr | 0 € (publique, sans clé) |
| Hébergement | 0 € (tout tourne en local / PWA) |
| **TOTAL** | **0 €** |

**Limite :** Transcription ~75% précise sur guitare, placement de frettes à deviner.

### Option B : Qualité Maximale (Klangio API)

| Poste | Coût |
|---|---|
| Tout ce qui est dans Option A | 0 € |
| Klangio API (Guitar2Tabs Pro) | ~6 €/mois (~72 €/an) |
| **TOTAL** | **~6 €/mois** |

**Avantage :** Transcription ~85% précise, spécifique guitare, output GP5 direct avec positions de frettes, séparation de stems intégrée. C'est le moteur AI le plus performant qui existe pour la guitare en 2026.

### Recommandation
Commence par l'Option A (gratuit). Si la qualité de Basic Pitch ne te suffit pas, ajoute Klangio API. Tu peux mixer les deux : Basic Pitch pour ton propre jeu (signal propre), Klangio pour les morceaux complets depuis un mix.

---

## 5. Obtenir les Meilleures Tablatures — La Stratégie Définitive

### Tabs "Originales" (ce que le guitariste joue vraiment)

**Priorité 1 — Tabs humaines vérifiées (Songsterr) :**
Pour les morceaux connus, les tabs Songsterr sont le gold standard. 1M+ tabs, souvent multi-pistes, vérifiées par la communauté depuis des années. C'est mieux que ce que l'IA peut produire.

**Priorité 2 — Transcription AI assistée :**
Pour les morceaux absents de Songsterr :
1. Trouve l'audio (YouTube, fichier local)
2. Isole la guitare (Demucs `htdemucs_6s`)
3. Transcris (Basic Pitch)
4. Corrige manuellement les 15-20% d'erreurs dans l'éditeur
5. Sauvegarde dans ta bibliothèque

**Priorité 3 — Ton propre jeu :**
Branche l'iRig → enregistre en clean → transcription directe (pas besoin de séparation de stems)

### Tabs "Cover" (rythme + mélodie chantée sur une seule guitare)

**Option 1 — Recherche manuelle :**
Beaucoup de YouTubers fingerstyle publient leurs tabs (souvent payantes, ~3-5€). Cherche sur :
- Patreon des guitaristes fingerstyle
- musicnotes.com
- sheetmusicdirect.com

**Option 2 — Génération automatique (ton Module 6) :**
L'algo Chord-Melody décrit plus haut. Ce ne sera pas parfait du premier coup, mais c'est un point de départ que tu peux éditer.

**Option 3 — Demander à Claude/Gemini :**
Tu me donnes les accords + la mélodie d'un morceau, je te génère un arrangement fingerstyle en alphaTex que tu charges directement dans ton app.

---

## 6. Spécificités iRig Micro Amp

### Connexion Samsung A52s 5G

| Élément | Détail |
|---|---|
| Câble nécessaire | Micro-USB (iRig) → USB-C OTG (Samsung) |
| Adaptateur | USB-C OTG adapter (~5€) |
| Compatible USB Audio | Oui (USB Audio Class 1.0, class-compliant) |
| Latence typique | ~15-25ms via Chrome Web Audio API (acceptable pour enregistrement, pas pour monitoring temps réel) |
| Monitoring | Utilise le speaker/casque de l'iRig pour le monitoring direct (latence 0), Chrome pour l'enregistrement |

### Workflow optimal

1. Branche guitare → iRig Micro Amp (canal Clean)
2. Branche iRig → Samsung via USB-C OTG
3. Casque/oreillettes dans la sortie 3.5mm de l'iRig (monitoring direct)
4. Ouvre l'app → section Recorder
5. L'app capte le signal USB audio
6. Enregistre → transcris → affiche la tab

---

## 7. Limites Honnêtes (État de l'Art 2026)

### Ce que l'IA fait bien
- Détection de notes polyphoniques (accords simples à moyens)
- Tempo et signature rythmique
- Mélodie monophonique
- Pitch bends basiques

### Ce que l'IA fait mal
- Placement des doigts sur le manche (bonne note, mauvaise position)
- Solos rapides (>8 notes/seconde)
- Techniques : tapping, sweep picking, harmoniques artificielles
- Ghost notes, dynamiques, groove
- Accordages non-standard (détection auto peu fiable)
- Mix denses (metal, wall of sound)

### Approche réaliste
L'IA te donne un premier jet à **80-85%**. Tu corriges les 15-20% dans l'éditeur. C'est déjà un gain de temps colossal par rapport à tout transcrire à l'oreille.

---

## 8. Dépendances NPM Clés

```json
{
  "dependencies": {
    "@coderline/alphatab": "latest",
    "@spotify/basic-pitch": "latest",
    "react": "^19",
    "react-dom": "^19",
    "dexie": "^4",
    "pitchy": "^4",
    "tonal": "^6",
    "@capacitor/core": "^6",
    "@capacitor/android": "^6"
  },
  "devDependencies": {
    "vite": "^6",
    "tailwindcss": "^4",
    "@vitejs/plugin-react": "latest"
  }
}
```

---

## 9. Fichiers & Structure du Projet

```
omnitab/
├── src/
│   ├── components/
│   │   ├── TabViewer.jsx          # AlphaTab wrapper
│   │   ├── TabSearch.jsx          # Recherche Songsterr
│   │   ├── Library.jsx            # Bibliothèque locale
│   │   ├── Tuner.jsx              # Accordeur
│   │   ├── AmpSim.jsx             # Simulateur d'ampli
│   │   ├── Recorder.jsx           # Enregistrement
│   │   ├── Transcriber.jsx        # Basic Pitch integration
│   │   ├── CoverGenerator.jsx     # Chord-Melody generator
│   │   └── ToneMatch.jsx          # Tone matching
│   ├── lib/
│   │   ├── songsterr-api.js       # Client API Songsterr
│   │   ├── audio-engine.js        # Web Audio API setup
│   │   ├── pitch-detection.js     # YIN / pitchy wrapper
│   │   ├── midi-to-tab.js         # MIDI → positions guitare
│   │   ├── chord-melody.js        # Algorithme de fusion
│   │   └── db.js                  # IndexedDB via Dexie
│   ├── assets/
│   │   └── impulse-responses/     # IR files pour cab sim
│   ├── App.jsx
│   └── main.jsx
├── backend/                        # Serveur PC local
│   ├── server.py                   # FastAPI + Demucs
│   └── requirements.txt           # demucs, fastapi, uvicorn
├── public/
│   └── manifest.json              # PWA manifest
├── capacitor.config.ts            # Config Capacitor (optionnel)
├── vite.config.js
├── tailwind.config.js
└── package.json
```

---

*Ce document remplace et consolide tous les plans précédents (Gemini + recherches). Il est conçu pour être directement actionnable avec ton workflow Claude Code / AI-first.*
