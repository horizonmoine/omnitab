/**
 * Duck-typed shape of the AlphaTab API, describing only the surface we use.
 *
 * Why not import from `@coderline/alphatab`?
 *   AlphaTab is a 1.2 MB dependency we load lazily via `import()`. Importing
 *   its types for compile-time safety would drag tsc into resolving the whole
 *   module and couple every consumer to its exact 1.5.x shape. A hand-written
 *   subset is smaller, more stable, and documents exactly what we depend on.
 *
 * The trade-off: we don't catch AlphaTab API breakage at compile time — only
 * at runtime on the first load. We guard the risky fields with optional
 * chaining (`api.destroy?.()`, `api.playerPositionChanged?.on?.(...)`) so a
 * minor version bump doesn't crash the viewer.
 */

/** An AlphaTab event emitter — `.on(handler)` registers a listener. */
export interface AlphaTabEvent<T> {
  on(handler: (arg: T) => void): void;
}

export interface AlphaTabTrack {
  name?: string;
  staves?: Array<{ bars?: unknown[] }>;
}

export interface AlphaTabScore {
  title?: string;
  tracks?: AlphaTabTrack[];
}

export interface AlphaTabSettings {
  display?: { scale: number };
}

export interface AlphaTabBeatEvent {
  voice?: { bar?: { index?: number } };
  notes?: Array<{ realValue?: number }>;
}

/** Pixel rectangle AlphaTab returns for every renderable element. */
export interface AlphaTabBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One beat's on-screen bounding boxes. */
export interface AlphaTabBeatBounds {
  /** Covers only the notation glyph — what the user actually sees. */
  visualBounds: AlphaTabBounds;
}

/**
 * Hierarchical lookup from AlphaTab that maps Beat objects back to their
 * rendered pixel coordinates. Only populated after `renderFinished`. The
 * Healer overlay calls `findBeat(beatRef)` for every flag to get a dot position.
 */
export interface AlphaTabBoundsLookup {
  findBeat(beat: unknown): AlphaTabBeatBounds | null;
}

export interface AlphaTabApi {
  // ─── Data & settings ───────────────────────────────────────────────
  /** `null` before `scoreLoaded` fires, `undefined` after destroy. */
  score?: AlphaTabScore | null;
  settings?: AlphaTabSettings;

  // ─── Transport (setters are imperative mutations on the live API) ──
  /** Ratio, 1.0 = 100 %. */
  playbackSpeed?: number;
  /** 0 = silent count-in, 1 = audible count-in. */
  countInVolume?: number;
  /** Whether the loop-between-markers behavior is active. */
  isLooping?: boolean;
  /** Playback cursor position in MILLISECONDS since song start. */
  timePosition?: number;

  // ─── Methods ───────────────────────────────────────────────────────
  playPause(): void;
  stop?(): void;
  render(): void;
  updateSettings(): void;
  destroy?(): void;
  renderTracks(tracks: unknown[]): void;
  /** Older AlphaTab versions have different signatures — optional. */
  changeTrackMute?(tracks: unknown[], mute: boolean): void;
  /** Load a binary .gp/.gpx. */
  load(data: ArrayBuffer | Uint8Array): void;
  /** Load an alphaTex / MusicXML string. */
  tex(source: string): void;

  /**
   * Lookup of rendered coordinates keyed by Beat. `null` before the first
   * `renderFinished` fires. Used by the Healer overlay to pin flag dots to
   * the exact glyph position.
   */
  boundsLookup?: AlphaTabBoundsLookup | null;

  // ─── Events ────────────────────────────────────────────────────────
  scoreLoaded: AlphaTabEvent<AlphaTabScore>;
  playerStateChanged: AlphaTabEvent<{ state: number }>;
  /** Not in every AlphaTab version — guard with optional chaining. */
  playerPositionChanged?: AlphaTabEvent<{ currentTime: number }>;
  playedBeatChanged: AlphaTabEvent<AlphaTabBeatEvent>;
  error: AlphaTabEvent<unknown>;
  /**
   * Fires every time the score finishes rendering (initial load, resize,
   * track change, zoom). The overlay must recompute positions on each fire.
   */
  renderFinished: AlphaTabEvent<unknown>;
}
