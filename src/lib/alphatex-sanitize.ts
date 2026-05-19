/**
 * Fix alphaTex strings saved with old buggy formats. Runs on text sources so
 * IndexedDB tabs open cleanly without re-transcribing.
 */
export function sanitizeAlphaTex(src: string): string {
  const lines = src
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('\\track'))
    .map((line) => sanitizeAlphaTexLine(line));

  return lines.join('\n').replace(/\n{3,}/g, '\n\n');
}

function sanitizeAlphaTexLine(line: string): string {
  let out = line;

  // AlphaTab 1.5.0 expects tuning values without parenthesized arguments.
  out = out.replace(/\\tuning\s*\(([^)]+)\)/g, '\\tuning $1');

  // Chords containing bad frets should drop only the bad notes. If every note
  // is bad, the whole chord becomes a rest.
  out = out.replace(/\(([^)]+)\)/g, (match, inner: string, offset: number) => {
    const before = out.slice(Math.max(0, offset - 20), offset).trimEnd();
    if (/\\[a-zA-Z]+$/.test(before)) return match;

    const parts = inner
      .trim()
      .split(/\s+/)
      .filter((part) => !/^(?:NaN|undefined|-?Infinity)\./.test(part));

    if (parts.length === 0) return 'r';
    if (parts.length === 1) return parts[0];
    return `(${parts.join(' ')})`;
  });

  out = out.replace(/\\tempo\s+(\d+)\.\d+/g, '\\tempo $1');
  out = out.replace(/(^|[\s(])(?:NaN|undefined|-?Infinity)\.\d+\b/g, '$1r');

  return out;
}
