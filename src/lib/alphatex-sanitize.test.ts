import { describe, expect, it } from 'vitest';
import { sanitizeAlphaTex } from './alphatex-sanitize';

describe('sanitizeAlphaTex', () => {
  it('removes unsupported track directives', () => {
    expect(sanitizeAlphaTex('\\title "Song"\n\\track "Guitar"\n:4 0.6')).toBe(
      '\\title "Song"\n:4 0.6',
    );
  });

  it('normalizes tuning and tempo for AlphaTab 1.5.0', () => {
    const src = '\\tuning(E4 B3 G3 D3 A2 E2)\n\\tempo 120.5';

    expect(sanitizeAlphaTex(src)).toBe(
      '\\tuning E4 B3 G3 D3 A2 E2\n\\tempo 120',
    );
  });

  it('turns invalid bare notes into rests', () => {
    expect(
      sanitizeAlphaTex(':8 NaN.3 undefined.2 Infinity.1 -Infinity.4 3.2'),
    ).toBe(':8 r r r r 3.2');
  });

  it('drops invalid notes from chords and unwraps single-note chords', () => {
    expect(sanitizeAlphaTex(':8 (NaN.3 3.2 5.1) (undefined.3 7.2)')).toBe(
      ':8 (3.2 5.1) 7.2',
    );
  });

  it('turns all-invalid chords into rests', () => {
    expect(sanitizeAlphaTex(':8 (NaN.3 undefined.2)')).toBe(':8 r');
  });
});
