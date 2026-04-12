#!/usr/bin/env node
/**
 * Génère les icônes PWA OmniTab (192×192 et 512×512) en PNG valides, en pur
 * Node — sans dépendance binaire type `sharp`.
 *
 * POURQUOI PUR NODE ?
 *   `sharp` est une dep C++ de ~30 MB pour un boulot qu'on fait UNE fois.
 *   Le format PNG est simple : signature + IHDR + IDAT (données deflatées)
 *   + IEND, chaque chunk préfixé par sa longueur et suivi d'un CRC32. Node
 *   expose déjà `zlib.deflateSync` et `zlib.crc32` (Node ≥ 20) donc on
 *   écrit les octets à la main.
 *
 * DESIGN DE L'ICÔNE
 *   Carré arrondi bleu-nuit → médiator (triangle arrondi) jaune amp-accent.
 *   C'est brutal mais lisible à 48 px. Remplace par ton propre design
 *   quand tu auras le temps — les chemins restent.
 *
 * USAGE
 *   node scripts/generate-icons.mjs
 *   → écrit public/icon-192.png et public/icon-512.png
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });

// ─────────────────────── Design palette ─────────────────────────
// (Doit coller au thème Tailwind — amp-bg et amp-accent.)
const BG = [10, 10, 10, 255]; // #0a0a0a  — fond dark
const PANEL = [22, 22, 28, 255]; // cadre subtil
const ACCENT = [245, 158, 11, 255]; // #f59e0b — amp-accent (médiator)
const ACCENT_DARK = [180, 115, 0, 255]; // ombrage

// ─────────────────────── Pixel painter ──────────────────────────

/**
 * Dessine un PNG carré en appelant `pixel(x, y)` pour chaque pixel et en
 * collectant un tableau d'octets RGBA. On retourne un Buffer PNG valide.
 */
function makePng(size, pixel) {
  // 1 octet de filtre (0 = none) par scanline + size*4 octets RGBA.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0; // filter type None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const idat = deflateSync(raw);

  // PNG structure : signature + IHDR + IDAT + IEND
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = makeChunk('IHDR', buildIhdr(size));
  const idatChunk = makeChunk('IDAT', idat);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdr, idatChunk, iend]);
}

function buildIhdr(size) {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(size, 0); // width
  b.writeUInt32BE(size, 4); // height
  b[8] = 8; // bit depth
  b[9] = 6; // color type: 6 = truecolor + alpha (RGBA)
  b[10] = 0; // compression
  b[11] = 0; // filter
  b[12] = 0; // interlace
  return b;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// ─────────────────────── Drawing helpers ────────────────────────

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * Mélange `over` RGBA sur `under` RGBA. Alpha normalisée à 0..1.
 */
function composite(under, over) {
  const a = over[3] / 255;
  return [
    Math.round(lerp(under[0], over[0], a)),
    Math.round(lerp(under[1], over[1], a)),
    Math.round(lerp(under[2], over[2], a)),
    255,
  ];
}

/**
 * Carré arrondi maskable : respecte la zone sûre PWA (10% de marge).
 * Retourne null si le pixel est hors du carré arrondi.
 */
function roundedSquareAlpha(x, y, size) {
  const radius = size * 0.22;
  const cx = size / 2;
  const cy = size / 2;
  const dx = Math.abs(x - cx) - (cx - radius);
  const dy = Math.abs(y - cy) - (cy - radius);
  if (dx <= 0 && dy <= 0) return 1;
  const outX = Math.max(dx, 0);
  const outY = Math.max(dy, 0);
  const dist = Math.hypot(outX, outY);
  // Antialias de 1.5 px sur le bord.
  return clamp01(1 - (dist - radius) / 1.5);
}

/**
 * Médiator (plectrum) stylisé : triangle aux coins arrondis, pointe en bas.
 * Renvoie un alpha 0..1 pour les pixels à l'intérieur.
 */
function plectrumAlpha(x, y, size) {
  const cx = size / 2;
  const topY = size * 0.25;
  const bottomY = size * 0.78;
  const halfWidthTop = size * 0.3;
  // Point normalisé entre le haut et la pointe.
  const t = (y - topY) / (bottomY - topY);
  if (t < -0.05 || t > 1.05) return 0;
  // Largeur qui décroît et pointe arrondie.
  const halfWidth =
    halfWidthTop * Math.cos((clamp01(t) * Math.PI) / 2.2) * 1.05;
  const dx = Math.abs(x - cx);
  const edgeSoftness = 2;
  if (dx > halfWidth + edgeSoftness) return 0;
  // Coin supérieur arrondi.
  if (t < 0) {
    const rx = dx / halfWidthTop;
    const ry = -t * 3;
    const d = Math.hypot(rx, ry);
    return clamp01(1 - (d - 1) * 4);
  }
  return clamp01((halfWidth + edgeSoftness - dx) / edgeSoftness);
}

// ─────────────────────── Generate ───────────────────────────────

function renderIcon(size) {
  return makePng(size, (x, y) => {
    // 1. Fond : rien (transparent) → rempli par le carré arrondi.
    const squareAlpha = roundedSquareAlpha(x, y, size);
    if (squareAlpha <= 0) return [0, 0, 0, 0];

    // 2. Dégradé vertical subtil dans le carré.
    const t = y / size;
    const bgBlend = [
      Math.round(lerp(BG[0], PANEL[0], t)),
      Math.round(lerp(BG[1], PANEL[1], t)),
      Math.round(lerp(BG[2], PANEL[2], t)),
      Math.round(squareAlpha * 255),
    ];

    // 3. Médiator.
    const plectrum = plectrumAlpha(x, y, size);
    if (plectrum <= 0) return bgBlend;

    // Ombrage léger : côté droit un peu plus sombre.
    const shadeT = clamp01((x - size * 0.35) / (size * 0.3));
    const picCol = [
      Math.round(lerp(ACCENT[0], ACCENT_DARK[0], shadeT * 0.5)),
      Math.round(lerp(ACCENT[1], ACCENT_DARK[1], shadeT * 0.5)),
      Math.round(lerp(ACCENT[2], ACCENT_DARK[2], shadeT * 0.5)),
      Math.round(plectrum * 255),
    ];
    return composite(bgBlend, picCol);
  });
}

for (const size of [192, 512]) {
  const buf = renderIcon(size);
  const out = join(publicDir, `icon-${size}.png`);
  writeFileSync(out, buf);
  console.log(`✓ ${out}  (${buf.length} bytes)`);
}
