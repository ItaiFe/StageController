import { describe, expect, it } from 'vitest';
import { describeEvent, paletteRgb, polePixels, slotWithoutShow } from './events';
import type { Pole, ShowEvent, ShowSpec } from './events';

const spec: ShowSpec = { palette: { pink: { ramp: [[1, 2, 3], [255, 20, 147], [9, 9, 9]] } }, games: [] };
const pink: [number, number, number] = [255, 20, 147];
const pole = (over: Partial<Pole> = {}): Pole => ({ pct: 50, color: 'pink', mode: 'solid', ms: null, ...over });
const lit = (strip: Uint8Array) => Array.from({ length: 100 }, (_, i) => strip[i * 3] + strip[i * 3 + 1] + strip[i * 3 + 2] > 0).filter(Boolean).length;

describe('paletteRgb', () => {
  it('takes the middle of the ramp', () => {
    expect(paletteRgb(spec, 'pink')).toEqual(pink);
    expect(paletteRgb(spec, 'nope')).toBeNull();
    expect(paletteRgb(spec, null)).toBeNull();
  });
});

describe('polePixels', () => {
  it('fills from the bottom up to pct', () => {
    const s = polePixels(pole({ pct: 33 }), pink, 0);
    expect(lit(s)).toBe(33);
    expect([s[0], s[1], s[2]]).toEqual(pink);
    expect(s[33 * 3]).toBe(0);
  });

  it('is dark when off or without a colour', () => {
    expect(lit(polePixels(pole({ mode: 'off' }), pink, 0))).toBe(0);
    expect(lit(polePixels(pole(), null, 0))).toBe(0);
  });

  it('drains linearly to nothing over ms', () => {
    const p = pole({ pct: 100, mode: 'drain', ms: 500 });
    expect(lit(polePixels(p, pink, 0))).toBe(100);
    expect(lit(polePixels(p, pink, 250))).toBe(50);
    expect(lit(polePixels(p, pink, 600))).toBe(0);
  });

  it('blinks and pulses without changing how far it is filled', () => {
    expect(lit(polePixels(pole({ mode: 'blink' }), pink, 0))).toBe(50);
    expect(lit(polePixels(pole({ mode: 'blink' }), pink, 300))).toBe(0);
    expect(lit(polePixels(pole({ mode: 'pulse' }), pink, 123))).toBe(50);
  });
});

describe('slotWithoutShow', () => {
  const ev = (state: ShowEvent['state']) => ({ state }) as ShowEvent;
  it('falls back to the pillar slots only when the show is idle', () => {
    expect(slotWithoutShow(null, false)).toBe('idle');
    expect(slotWithoutShow(ev('idle'), true)).toBe('start');
    expect(slotWithoutShow(ev('intro'), false)).toBeNull();
    expect(slotWithoutShow(ev('playing'), true)).toBeNull();
  });
});

describe('describeEvent', () => {
  it('summarises show and button events', () => {
    const e = { action: 'show', state: 'intro', game: 'duet', step: 3, poles: { L: pole({ pct: 100 }), R: pole({ pct: 100 }) } };
    expect(describeEvent(e)).toBe('intro · duet · step 3 · L 100% R 100%');
    expect(describeEvent({ action: 'claps' })).toBe('button claps');
  });
});
