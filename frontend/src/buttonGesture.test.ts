import { describe, it, expect } from 'vitest';
import { GestureDetector, GAP_MS, LONG_PRESS_MS, gestureAction } from './buttonGesture';

// Tap = press then release `held` ms later; returns the release time
function tap(d: GestureDetector, at: number, held = 50): number {
  expect(d.press(at)).toBeNull();
  expect(d.release(at + held)).toBeNull();
  return at + held;
}

describe('GestureDetector', () => {
  it('emits a single tap only after the gap passes', () => {
    const d = new GestureDetector();
    const up = tap(d, 0);
    expect(d.tick(up + GAP_MS - 1)).toBeNull();
    expect(d.tick(up + GAP_MS)).toEqual({ kind: 'taps', count: 1 });
    expect(d.tick(up + GAP_MS + 1000)).toBeNull();
  });

  it.each([2, 3, 4])('counts %i taps within the gap', (n) => {
    const d = new GestureDetector();
    let up = 0;
    for (let i = 0; i < n; i++) up = tap(d, i === 0 ? 0 : up + 100);
    expect(d.tick(up + GAP_MS)).toEqual({ kind: 'taps', count: n });
  });

  it('a press at 399 ms after release continues the gesture', () => {
    const d = new GestureDetector();
    const up = tap(d, 0);
    expect(d.tick(up + GAP_MS - 1)).toBeNull();
    const up2 = tap(d, up + GAP_MS - 1);
    expect(d.tick(up2 + GAP_MS)).toEqual({ kind: 'taps', count: 2 });
  });

  it('a gap of exactly 400 ms ends the gesture', () => {
    const d = new GestureDetector();
    const up = tap(d, 0);
    expect(d.tick(up + GAP_MS)).toEqual({ kind: 'taps', count: 1 });
    const up2 = tap(d, up + GAP_MS);
    expect(d.tick(up2 + GAP_MS)).toEqual({ kind: 'taps', count: 1 });
  });

  it('emits long immediately when the hold reaches 1500 ms, and the release emits nothing', () => {
    const d = new GestureDetector();
    expect(d.press(0)).toBeNull();
    expect(d.tick(LONG_PRESS_MS - 1)).toBeNull();
    expect(d.tick(LONG_PRESS_MS)).toEqual({ kind: 'long' });
    expect(d.tick(LONG_PRESS_MS + 10)).toBeNull();
    expect(d.release(LONG_PRESS_MS + 500)).toBeNull();
    expect(d.tick(LONG_PRESS_MS + 500 + GAP_MS)).toBeNull();
  });

  it('a hold just under 1500 ms counts as a tap', () => {
    const d = new GestureDetector();
    const up = tap(d, 0, LONG_PRESS_MS - 1);
    expect(d.tick(up + GAP_MS)).toEqual({ kind: 'taps', count: 1 });
  });

  it('a long press after taps discards the taps', () => {
    const d = new GestureDetector();
    let up = tap(d, 0);
    up = tap(d, up + 100);
    const downAt = up + 100;
    expect(d.press(downAt)).toBeNull();
    expect(d.tick(downAt + LONG_PRESS_MS)).toEqual({ kind: 'long' });
    expect(d.release(downAt + LONG_PRESS_MS + 100)).toBeNull();
    expect(d.tick(downAt + LONG_PRESS_MS + 100 + GAP_MS)).toBeNull();
  });

  it('reports the in-progress tap count and hold progress', () => {
    const d = new GestureDetector();
    let up = tap(d, 0);
    up = tap(d, up + 100);
    expect(d.pendingTaps).toBe(2);
    d.press(up + 100);
    expect(d.holdProgress(up + 100 + LONG_PRESS_MS / 2)).toBeCloseTo(0.5);
    expect(d.holdProgress(up + 100 + LONG_PRESS_MS * 2)).toBe(1);
  });

  it('ignores a release without a press', () => {
    const d = new GestureDetector();
    expect(d.release(100)).toBeNull();
    expect(d.tick(100 + GAP_MS)).toBeNull();
  });
});

describe('gestureAction', () => {
  it('maps gestures to the firmware actions', () => {
    expect(gestureAction({ kind: 'taps', count: 1 })).toBe('start');
    expect(gestureAction({ kind: 'taps', count: 2 })).toBe('claps');
    expect(gestureAction({ kind: 'taps', count: 3 })).toBe('special');
    expect(gestureAction({ kind: 'taps', count: 4 })).toBe('skip');
    expect(gestureAction({ kind: 'long' })).toBe('stop');
  });

  it('five or more taps also map to special', () => {
    expect(gestureAction({ kind: 'taps', count: 5 })).toBe('special');
    expect(gestureAction({ kind: 'taps', count: 9 })).toBe('special');
  });
});
