/**
 * Primitives — the small set of building blocks every OmniTab page uses.
 *
 * These match the design-system spec in `omnitab-design-system/` 1:1 and
 * exist to eliminate the ~50 copies of `bg-amp-panel border border-amp-border`
 * and friends scattered across the 16 pages.
 *
 * Why six, no more:
 *   - `Button`    — every CTA, destructive action, chip, start/stop pill
 *   - `Input`     — every text field
 *   - `Card`      — every panel/row container
 *   - `SectionLabel` — the UPPERCASE-tracked muted caption pattern
 *   - `PageHeader` — title + subtitle pair at the top of each page
 *   - `Readout`   — mono + tabular-nums number display (BPM, Hz, cents…)
 *   - `ErrorStrip` — the `/20` tinted error panel
 *
 * Anything more exotic (custom knobs, SVG diagrams) stays inside its own page.
 */

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type PropsWithChildren, type ReactNode } from 'react';

// ─── Button ─────────────────────────────────────────────────────────
export type ButtonVariant =
  | 'primary'      // amber bg, black text — THE only primary style in the app
  | 'destructive'  // red bg, white text — stop/delete
  | 'secondary'    // panel-2 bg — inline actions
  | 'chip'         // small panel-2 bg — filter chips
  | 'chipOn'       // amber chip — when a filter is active
  | 'pill'         // round amber CTA — start/record buttons
  | 'pillStop';    // round red CTA — stop buttons

const BUTTON_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-6 py-2 rounded',
  destructive:
    'bg-amp-error hover:bg-red-600 text-white font-bold px-6 py-2 rounded',
  secondary:
    'bg-amp-panel-2 hover:bg-amp-border text-amp-text px-4 py-1.5 rounded text-sm',
  chip: 'bg-amp-panel-2 hover:bg-amp-border text-amp-text px-3 py-1 rounded text-sm',
  chipOn: 'bg-amp-accent text-amp-bg px-3 py-1 rounded text-sm font-semibold',
  pill: 'bg-amp-accent hover:bg-amp-accent-hover text-amp-bg font-bold px-10 py-3 rounded-full text-lg',
  pillStop:
    'bg-amp-error hover:bg-red-600 text-white font-bold px-10 py-3 rounded-full text-lg',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', className = '', disabled, children, type = 'button', ...rest },
  ref,
) {
  const disabledStyle = disabled
    ? 'opacity-50 cursor-not-allowed'
    : 'cursor-pointer';
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={`transition-colors select-none ${BUTTON_CLASSES[variant]} ${disabledStyle} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
});

// ─── Input ──────────────────────────────────────────────────────────
type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className = '', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={`bg-amp-panel border border-amp-border rounded px-4 py-2 text-amp-text placeholder:text-amp-muted focus:outline-none focus:border-amp-accent ${className}`.trim()}
      {...rest}
    />
  );
});

// ─── Card ───────────────────────────────────────────────────────────
interface CardProps {
  className?: string;
  /** Tailwind padding utility; overrides the default p-4. */
  padding?: string;
  /**
   * If true, the card's border pulses to amber on hover — the "selectable
   * row" pattern used in TabSearch / Library results.
   */
  interactive?: boolean;
  children?: ReactNode;
}

export function Card({
  className = '',
  padding = 'p-4',
  interactive = false,
  children,
}: CardProps) {
  const hover = interactive ? 'hover:border-amp-accent transition-colors' : '';
  return (
    <div
      className={`bg-amp-panel border border-amp-border rounded ${padding} ${hover} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

// ─── SectionLabel ───────────────────────────────────────────────────
/** "PRESETS", "SIGNATURE", "TAP TEMPO" — small UPPERCASE tracked caption. */
export function SectionLabel({
  children,
  className = '',
}: PropsWithChildren<{ className?: string }>) {
  return (
    <h3
      className={`text-sm font-bold text-amp-muted mb-3 uppercase tracking-wide ${className}`.trim()}
    >
      {children}
    </h3>
  );
}

// ─── PageHeader ─────────────────────────────────────────────────────
interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}

/** Standard page top: h2 + optional subtitle + 6-unit bottom gap. */
export function PageHeader({ title, subtitle, className = '' }: PageHeaderProps) {
  return (
    <div className={`mb-6 ${className}`.trim()}>
      <h2 className="text-2xl font-bold text-amp-text">{title}</h2>
      {subtitle && <p className="text-amp-muted text-sm mt-1">{subtitle}</p>}
    </div>
  );
}

// ─── Readout ────────────────────────────────────────────────────────
/**
 * Mono + tabular-nums number display. Use for anything live-updating:
 * tuner pitch, BPM, Hz, cents, timer. `tabular-nums` prevents layout
 * jitter when digits change width.
 *
 * Size defaults to text-5xl (48px) — override via className for the
 * 60px tuner glyph or smaller counters.
 */
interface ReadoutProps extends HTMLAttributes<HTMLSpanElement> {
  /** Preset sizes matching the design-system type scale. */
  size?: 'sm' | 'base' | 'lg' | 'xl' | 'hero';
}

export function Readout({
  children,
  className = '',
  size = 'xl',
  ...rest
}: ReadoutProps) {
  const sizeClass = {
    sm: 'text-sm',
    base: 'text-base',
    lg: 'text-2xl',
    xl: 'text-5xl',
    hero: 'text-6xl',
  }[size];
  return (
    <span
      className={`font-mono tabular-nums font-bold leading-none ${sizeClass} ${className}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}

// ─── ErrorStrip ─────────────────────────────────────────────────────
/** The `/20` tinted red panel — errors, warnings, "iRig not detected" etc. */
export function ErrorStrip({
  children,
  className = '',
}: PropsWithChildren<{ className?: string }>) {
  return (
    <div
      className={`p-3 rounded text-sm bg-amp-error/20 border border-amp-error text-amp-error ${className}`.trim()}
    >
      {children}
    </div>
  );
}
