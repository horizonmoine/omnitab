import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { appBus } from './event-bus';

describe('event-bus', () => {
  // appBus is a module-level singleton. Each test must clean up its own
  // subscriptions via the returned unsubscribe fns so we don't bleed across
  // tests. Consumers are expected to do this in component unmount cleanups.
  const unsubs: Array<() => void> = [];

  beforeEach(() => {
    unsubs.length = 0;
  });

  afterEach(() => {
    for (const off of unsubs) off();
  });

  it('delivers events to subscribed handlers', () => {
    const handler = vi.fn();
    unsubs.push(appBus.on('play-pause', handler));
    appBus.emit('play-pause');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('fan-outs a single emit to multiple handlers', () => {
    const a = vi.fn();
    const b = vi.fn();
    unsubs.push(appBus.on('stop', a), appBus.on('stop', b));
    appBus.emit('stop');
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('the returned unsubscribe fn stops delivery to that handler only', () => {
    const kept = vi.fn();
    const removed = vi.fn();
    unsubs.push(appBus.on('loop-toggle', kept));
    const off = appBus.on('loop-toggle', removed);
    off();
    appBus.emit('loop-toggle');
    expect(kept).toHaveBeenCalledOnce();
    expect(removed).not.toHaveBeenCalled();
  });

  it('emit with no subscribers is a no-op (no throw)', () => {
    expect(() => appBus.emit('amp-clean')).not.toThrow();
  });

  it('isolates handlers that throw — later handlers still fire', () => {
    // Silence the console.warn that the bus emits on handler throw.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const thrower = vi.fn(() => { throw new Error('boom'); });
    const survivor = vi.fn();
    unsubs.push(appBus.on('speed-up', thrower), appBus.on('speed-up', survivor));
    expect(() => appBus.emit('speed-up')).not.toThrow();
    expect(survivor).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('listSubscriptions reflects live counts', () => {
    const off1 = appBus.on('next-bar', () => {});
    const off2 = appBus.on('next-bar', () => {});
    unsubs.push(off1, off2);
    expect(appBus.listSubscriptions()['next-bar']).toBe(2);
    off1();
    expect(appBus.listSubscriptions()['next-bar']).toBe(1);
  });
});
