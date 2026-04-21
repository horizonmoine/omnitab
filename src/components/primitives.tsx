/**
 * Primitives — the small set of building blocks every OmniTab page uses.
 *
 * These match the design-system spec in `omnitab-design-system/` 1:1 and
 * exist to eliminate the ~50 copies of `bg-amp-panel border border-amp-border`
 * and friends scattered across the 16 pages.
 *
 * Why these nine:
 *   - `Button`    — every CTA, destructive action, chip, start/stop pill
 *   - `Input`     — every text field
 *   - `Select`    — native select with amp-panel chrome (Library, Settings…)
 *   - `Card`      — every panel/row container
 *   - `SectionLabel` — the UPPERCASE-tracked muted caption pattern
 *   - `PageHeader` — title + subtitle pair at the top of each page
 *   - `Readout`   — mono + tabular-nums number display (BPM, Hz, cents…)
 *   - `ErrorStrip` — the `/20` tinted error panel
 *   - `Knob`      — SVG rotary knob with arc + needle (AmpSim drive/EQ/master)
 *
 * Anything more exotic (chord diagrams, fretboards) stays inside its own page.
 */

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type InputHTMLAttributes, type PropsWithChildren, type ReactNode, type SelectHTMLAttributes } from 'react';

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

// ─── Select ─────────────────────────────────────────────────────────
/**
 * Native `<select>` wearing the amp-panel chrome.
 *
 * We intentionally keep the native element (as opposed to a fancy
 * ARIA listbox) — it inherits keyboard, touch, mobile-picker and
 * screen-reader behaviour for free.
 */
type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className = '', children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={`bg-amp-panel border border-amp-border rounded px-3 py-2 text-amp-text focus:outline-none focus:border-amp-accent ${className}`.trim()}
      {...rest}
    >
      {children}
    </select>
  );
});

// ─── Card ───────────────────────────────────────────────────────────
/**
 * A Card is "just a div" with the amp-panel chrome — so it forwards all the
 * attributes a <div> would normally accept (role, aria-live, onClick, data-*).
 * This is what lets Tuner mark its card as a live region without losing the
 * standardised styling.
 */
interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Tailwind padding utility; overrides the default p-4. */
  padding?: string;
  /**
   * If true, the card's border pulses to amber on hover — the "selectable
   * row" pattern used in TabSearch / Library results.
   */
  interactive?: boolean;
}

export function Card({
  className = '',
  padding = 'p-4',
  interactive = false,
  children,
  ...rest
}: CardProps) {
  const hover = interactive ? 'hover:border-amp-accent transition-colors' : '';
  return (
    <div
      className={`bg-amp-panel border border-amp-border rounded ${padding} ${hover} ${className}`.trim()}
      {...rest}
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
/**
 * The `/20` tinted red panel — errors, warnings, "iRig not detected" etc.
 *
 * Forwards div attributes so callers can add `role="alert"` or
 * `aria-live="assertive"` for transient error announcements.
 */
interface ErrorStripProps extends HTMLAttributes<HTMLDivElement> {}

export function ErrorStrip({ children, className = '', ...rest }: ErrorStripProps) {
  return (
    <div
      className={`p-3 rounded text-sm bg-amp-error/20 border border-amp-error text-amp-error ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
}

// ─── Knob ───────────────────────────────────────────────────────────
/**
 * Continuous-value rotary knob with SVG arc + needle. Used by AmpSim for
 * Drive / EQ / Master.
 *
 * The clever trick: an invisible `<input type="range">` sits on top of the
 * SVG, which gives us drag, keyboard arrow-keys, touch handling and
 * screen-reader support for free — no custom drag handler needed.
 *
 * The knob keeps the caller's REAL units (e.g. -12..+12 dB, 0..1 master)
 * and just normalises internally for the arc/needle math. Pass `format`
 * to override the value display (e.g. show "+5.0 dB" instead of "5.0").
 */
interface KnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Optional formatter for the value display under the knob. */
  format?: (v: number) => string;
  /** Hex colour for the arc + needle. Defaults to the amp accent amber. */
  color?: string;
  onChange: (v: number) => void;
  className?: string;
}

export function Knob({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  color = '#f59e0b',
  onChange,
  className = '',
}: KnobProps) {
  // Normalised [0, 1] position for arc + needle math.
  const t = (value - min) / (max - min);
  // -135° (min) → +135° (max), 270° total sweep. Bottom 90° stays blank.
  const angle = t * 270 - 135;
  // r=42 → circumference ≈ 263.9. 75 % of it (197.93) is the arc length
  // from 7:30 to 4:30 — matches the design mockup's strokeDasharray maths.
  const ARC_LEN = 197.93;
  const dash = t * ARC_LEN;
  const display = format
    ? format(value)
    : step < 1
      ? value.toFixed(1)
      : value.toFixed(0);

  return (
    <div className={`flex flex-col items-center ${className}`.trim()}>
      <div className="relative w-20 h-20">
        <svg viewBox="-50 -50 100 100" className="w-full h-full">
          {/* Background ring */}
          <circle r={42} fill="#0a0a0a" stroke="#2a2a2a" strokeWidth={2} />
          {/* Filled arc — proportional to value, starts at 7:30 */}
          <circle
            r={42}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeDasharray={`${dash} 1000`}
            transform="rotate(-225)"
            strokeLinecap="round"
          />
          {/* Needle */}
          <line
            x1={0}
            y1={0}
            x2={Math.sin((angle * Math.PI) / 180) * 30}
            y2={-Math.cos((angle * Math.PI) / 180) * 30}
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
          />
        </svg>
        {/* Transparent range input absorbs all input events.
            Drag, keyboard ←/→, touch, screen-reader announcements: free. */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={label}
        />
      </div>
      <div className="text-xs text-amp-muted uppercase tracking-wide mt-2">
        {label}
      </div>
      <div className="text-sm text-amp-text font-mono tabular-nums mt-0.5">
        {display}
      </div>
    </div>
  );
}
