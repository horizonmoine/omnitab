/**
 * HealerOverlay — paints one coloured dot per Healer flag directly on top
 * of the AlphaTab render, positioned via `api.boundsLookup.findBeat`.
 *
 * Positioning contract: this component must live *inside* the same
 * relatively-positioned wrapper as the AlphaTab container `<div>`, because
 * AlphaTab's visualBounds are expressed in the scrolled-content coordinate
 * system, not the viewport. See TabViewer for the wrapper layout.
 *
 * Lifecycle:
 *   - On mount + whenever `flags` changes, recompute pixel positions.
 *   - Subscribe to `api.renderFinished` so resize/zoom/track-switch
 *     repositions dots in lock-step with the score.
 *   - The effect cleanup is a soft no-op: AlphaTab events don't expose
 *     `.off()` on our duck-typed surface, so we rely on the component
 *     unmount + a `cancelled` flag to prevent stale setState calls.
 */

import { useEffect, useState } from 'react';
import type { AlphaTabApi, AlphaTabBounds } from '../lib/alphatab-types';
import type { HealerFlag, FlagSeverity } from '../lib/tab-healer';

interface HealerOverlayProps {
  flags: HealerFlag[];
  /** Stable getter — avoids re-subscribing when the API ref identity is the same. */
  getApi: () => Pick<AlphaTabApi, 'boundsLookup' | 'renderFinished'> | null;
  /** Called when a dot is clicked — TabViewer seeks the transport there. */
  onSeek?: (seconds: number) => void;
}

interface PositionedFlag {
  flag: HealerFlag;
  bounds: AlphaTabBounds;
}

/** Map severity → Tailwind colours. */
const SEVERITY_STYLE: Record<FlagSeverity, { ring: string; glow: string }> = {
  // Partial mismatch — amber, less alarming than outright error.
  info: { ring: 'bg-amber-400', glow: 'shadow-amber-400/60' },
  // Tab says something, audio is silent — orange warning.
  warning: { ring: 'bg-orange-500', glow: 'shadow-orange-500/60' },
  // Total disagreement — red, impossible to miss.
  error: { ring: 'bg-red-500', glow: 'shadow-red-500/70' },
};

export function HealerOverlay({ flags, getApi, onSeek }: HealerOverlayProps) {
  const [positioned, setPositioned] = useState<PositionedFlag[]>([]);

  useEffect(() => {
    let cancelled = false;

    const recompute = () => {
      if (cancelled) return;
      const api = getApi();
      const lookup = api?.boundsLookup;
      if (!lookup) {
        setPositioned([]);
        return;
      }
      const next: PositionedFlag[] = [];
      for (const flag of flags) {
        if (!flag.beatRef) continue;
        const bounds = lookup.findBeat(flag.beatRef);
        if (!bounds) continue; // offscreen / not yet rendered
        next.push({ flag, bounds: bounds.visualBounds });
      }
      setPositioned(next);
    };

    // First pass — the score may already be rendered.
    recompute();

    // AlphaTab re-renders on resize, zoom, track switch — hook in so the
    // dots never drift. Our duck-typed event doesn't expose .off(), so the
    // `cancelled` flag + getApi()?. null-check is our defense against
    // fire-after-unmount.
    const api = getApi();
    api?.renderFinished?.on?.(() => recompute());

    return () => {
      cancelled = true;
    };
  }, [flags, getApi]);

  // No flags or score not yet rendered → render nothing (and no DOM cost).
  if (positioned.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[5]"
      aria-hidden="true"
    >
      {positioned.map((p, i) => {
        const s = SEVERITY_STYLE[p.flag.severity];
        // Centre the dot horizontally on the beat, place it just above
        // the glyph (y - 14 keeps it clear of note heads).
        const cx = p.bounds.x + p.bounds.w / 2;
        const cy = p.bounds.y - 14;
        return (
          <button
            key={`${p.flag.timeSeconds}-${i}`}
            type="button"
            onClick={() => onSeek?.(p.flag.timeSeconds)}
            title={p.flag.message}
            className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${s.ring} ${s.glow} h-3 w-3 shadow-[0_0_10px] ring-2 ring-white/70 hover:scale-125 transition-transform animate-pulse`}
            style={{ left: `${cx}px`, top: `${cy}px` }}
          >
            <span className="sr-only">{p.flag.message}</span>
          </button>
        );
      })}
    </div>
  );
}
