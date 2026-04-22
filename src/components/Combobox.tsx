/**
 * Combobox — accessible free-text input with a suggestion dropdown.
 *
 * Used by AmpAutoConfig for the guitar / amp / song fields. The user
 * can type freely (any value is accepted), but suggestions help avoid
 * typos and surface canonical names that LLMs handle better.
 *
 * Behavior:
 *   - Suggestions appear in a dropdown when the input is focused
 *     (or whenever the user types).
 *   - ↑/↓ arrows navigate, Enter picks the highlighted item, Escape closes.
 *   - Clicking outside closes.
 *   - Free-text submit (Enter with no highlight) returns the raw input.
 *
 * Why not a `<datalist>`? The native one looks OS-different (especially
 * on mobile Safari which gives a tiny picker), can't be styled, and
 * doesn't do fuzzy/accent-insensitive filtering. So we hand-roll it.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Input } from './primitives';

export interface ComboboxOption {
  /** The value that gets returned on selection. */
  value: string;
  /** Optional second-line caption shown below the value. */
  caption?: string;
}

export interface ComboboxProps {
  value: string;
  onChange: (v: string) => void;
  /** Called when an option is picked or Enter is pressed. */
  onCommit?: (v: string) => void;
  /** Function that returns up-to-N options for the current query. */
  suggest: (query: string) => ComboboxOption[];
  placeholder?: string;
  /** Aria label — required for screen readers since there's no visible label. */
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

export function Combobox({
  value,
  onChange,
  onCommit,
  suggest,
  placeholder,
  ariaLabel,
  className = '',
  disabled = false,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Recompute suggestions on every render — cheap (8 items max) and
  // ensures the list stays in sync with `value`. The `suggest` fn is
  // expected to be stable across renders (defined module-level by caller).
  const options = suggest(value);

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset highlight when the option list changes (typing a new char).
  useEffect(() => {
    setHighlighted(0);
  }, [value]);

  const pick = useCallback(
    (val: string) => {
      onChange(val);
      onCommit?.(val);
      setOpen(false);
      // Return focus to the input so the user can keep typing.
      inputRef.current?.focus();
    },
    [onChange, onCommit],
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (!open) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlighted((h) => Math.min(h + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlighted((h) => Math.max(h - 1, 0));
        break;
      case 'Enter':
        // If the dropdown is open AND there's a highlighted option, pick it.
        // Otherwise commit the free-text value.
        if (options.length > 0 && options[highlighted]) {
          e.preventDefault();
          pick(options[highlighted].value);
        } else {
          onCommit?.(value);
          setOpen(false);
        }
        break;
      case 'Escape':
        setOpen(false);
        break;
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`.trim()}>
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={
          open && options[highlighted]
            ? `${listboxId}-opt-${highlighted}`
            : undefined
        }
        role="combobox"
        className="w-full"
      />
      {open && options.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          // Float over neighbouring content; clip to dark theme palette.
          className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded border border-amp-border bg-amp-panel shadow-xl"
        >
          {options.map((opt, i) => {
            const isActive = i === highlighted;
            return (
              <li
                key={`${opt.value}-${i}`}
                id={`${listboxId}-opt-${i}`}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  // mousedown (not click) so the input doesn't lose focus
                  // BEFORE we handle the pick — same trick as the React docs.
                  e.preventDefault();
                  pick(opt.value);
                }}
                onMouseEnter={() => setHighlighted(i)}
                className={`px-3 py-2 cursor-pointer text-sm ${
                  isActive
                    ? 'bg-amp-accent/20 text-amp-text'
                    : 'text-amp-text hover:bg-amp-panel-2'
                }`}
              >
                <div className="font-medium">{opt.value}</div>
                {opt.caption && (
                  <div className="text-xs text-amp-muted mt-0.5">
                    {opt.caption}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
