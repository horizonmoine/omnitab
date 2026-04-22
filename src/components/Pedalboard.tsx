/**
 * Pedalboard — visual stompbox UI for the AmpSim.
 *
 * Renders the 8 pedals in canonical signal-chain order. Each pedal is a
 * "box" that the user can click anywhere to toggle on/off (the LED tells
 * the truth). When active, the knobs are interactive; when bypassed,
 * they're shown dimmed.
 *
 * Why a single click toggles the whole box (vs. requiring a tiny LED tap)?
 * - On a phone, a precise small target is hostile.
 * - Real stompboxes work the same way (you stomp the whole top).
 * - Knob interactions live INSIDE the box and stop event propagation.
 *
 * Layout: flex-wrap so we get 1-2 rows on mobile, all-on-one on desktop.
 * Each pedal is ~150px wide — narrower than the amp knobs because we have
 * 8 of them and screen real estate is precious.
 */

import { useCallback } from 'react';
import {
  PEDAL_DEFS,
  PEDAL_ORDER,
  makeDefaultPedalboard,
  type PedalSlot,
} from '../lib/pedals';
import { Knob, SectionLabel } from './primitives';

interface PedalboardProps {
  pedals: PedalSlot[];
  /** Toggle the active flag on the given pedal. */
  onToggle: (kind: PedalSlot['kind']) => void;
  /** Update one knob value live. */
  onParamChange: (
    kind: PedalSlot['kind'],
    key: string,
    value: number,
  ) => void;
  /** Reset every pedal to its default params + bypass it. */
  onReset?: () => void;
}

export function Pedalboard({
  pedals,
  onToggle,
  onParamChange,
  onReset,
}: PedalboardProps) {
  const activeCount = pedals.filter((p) => p.active).length;

  // Render in the canonical signal-chain order, regardless of how `pedals`
  // is sorted. This keeps the UI showing "pre-amp" → "post-amp" left to right.
  const ordered = PEDAL_ORDER.map(
    (kind) => pedals.find((p) => p.kind === kind)!,
  );

  return (
    <div>
      <div className="flex items-baseline justify-between mb-3">
        <SectionLabel className="mb-0">
          Pédalier ({activeCount}/8 actives)
        </SectionLabel>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-amp-muted hover:text-amp-accent transition-colors"
          >
            ↺ Reset
          </button>
        )}
      </div>

      {/* Flow: source → comp → wah → ... → reverb → amp.
          We flex-wrap so it adapts from one row (desktop) to multiple
          (phone). The gap mirrors the design system's standard 4-unit. */}
      <div className="flex flex-wrap gap-3">
        {ordered.map((slot) => (
          <PedalBox
            key={slot.kind}
            slot={slot}
            onToggle={onToggle}
            onParamChange={onParamChange}
          />
        ))}
      </div>

      <div className="text-xs text-amp-muted mt-3">
        Ordre fixe : Comp → Wah → Fuzz → OD → Dist → Chorus → Delay → Reverb → Amp.
        Clique sur une pédale pour l'activer/désactiver.
      </div>
    </div>
  );
}

// ─── Single pedal box ───────────────────────────────────────────────────

interface PedalBoxProps {
  slot: PedalSlot;
  onToggle: PedalboardProps['onToggle'];
  onParamChange: PedalboardProps['onParamChange'];
}

function PedalBox({ slot, onToggle, onParamChange }: PedalBoxProps) {
  const def = PEDAL_DEFS[slot.kind];

  // Click handler on the OUTER box toggles. Knob events are attached to
  // the input range overlay, so they bubble up here too — we filter by
  // checking if the event target is the box itself or its name plate.
  const handleBoxClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      // Only toggle when the click hit the "stomp" area (the LED plate or
      // any padding around it) — NOT a knob input or its label.
      if (target.closest('[data-pedal-stomp="true"]')) {
        onToggle(slot.kind);
      }
    },
    [onToggle, slot.kind],
  );

  return (
    <div
      onClick={handleBoxClick}
      // The card-like container. Border lights up when active.
      className={`relative w-[150px] rounded-lg border-2 transition-all select-none ${
        slot.active
          ? 'border-amp-accent shadow-lg shadow-amp-accent/20'
          : 'border-amp-border opacity-75 hover:opacity-100'
      }`}
      style={{
        // Top half tinted with the pedal's signature color (Tube Screamer
        // green, RAT-orange, etc.) — gives each pedal a recognisable
        // visual identity.
        background: `linear-gradient(180deg, ${def.color}22 0%, var(--amp-panel, #1a1a1a) 60%)`,
      }}
    >
      {/* Stomp plate — the clickable header. */}
      <div
        data-pedal-stomp="true"
        role="button"
        tabIndex={0}
        aria-pressed={slot.active}
        aria-label={`${def.name} (${slot.active ? 'active' : 'bypass'})`}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            onToggle(slot.kind);
          }
        }}
        className="px-3 pt-3 pb-2 cursor-pointer focus:outline-none focus:ring-2 focus:ring-amp-accent/60 rounded-t-md"
      >
        <div className="flex items-center justify-between mb-1">
          {/* LED indicator — amber on, dim red dot off. */}
          <div
            aria-hidden="true"
            className={`w-3 h-3 rounded-full transition-all ${
              slot.active
                ? 'bg-amp-accent shadow-[0_0_8px_2px_rgba(245,158,11,0.6)]'
                : 'bg-amp-border'
            }`}
          />
          {/* "ON" / "BYPASS" microcopy — accessible affordance. */}
          <span
            className={`text-[10px] font-bold tracking-wider ${
              slot.active ? 'text-amp-accent' : 'text-amp-muted'
            }`}
          >
            {slot.active ? 'ON' : 'OFF'}
          </span>
        </div>
        <div className="font-bold text-amp-text text-sm leading-tight">
          {def.name}
        </div>
      </div>

      {/* Knobs grid. They're always rendered (even when bypassed) so the
          user can preview tweaks — Web Audio just won't apply them until
          the pedal is engaged. */}
      <div className="px-2 pb-3 pt-1">
        {/* 2-col grid for compactness; pedals with >4 knobs stack into 3 rows. */}
        <div className="grid grid-cols-2 gap-2">
          {def.knobs.map((knob) => (
            <div key={knob.key} className="flex justify-center">
              <Knob
                label={knob.label}
                value={slot.params[knob.key] ?? knob.default}
                min={knob.min}
                max={knob.max}
                step={knob.step ?? 0.1}
                format={knob.format}
                color={slot.active ? def.color : '#6b7280'} // gray when bypassed
                onChange={(v) => onParamChange(slot.kind, knob.key, v)}
                className="scale-75 origin-top"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Convenience reset helper exported for callers ─────────────────────

export function resetPedalboard(): PedalSlot[] {
  return makeDefaultPedalboard();
}
