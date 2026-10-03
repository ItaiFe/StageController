import { describe, expect, it } from 'vitest';
import { buttonRings, cueView, describeEvent, paletteRgb, polePixels, slotWithoutShow } from './events';
import type { ButtonLights, Pole, ShowEvent, ShowSpec } from './events';

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

  it('pulses at the period the event gives', () => {
    const red = (ms: number | null, at: number) => polePixels(pole({ mode: 'pulse', ms }), pink, at)[0];
    expect(red(290, 290 / 4)).toBe(255); // the top of the pulse a quarter period in
    expect(red(null, 290 / 4)).not.toBe(255);
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
    const playing = { action: 'show', state: 'playing', game: 'showoff', step: null, poles: e.poles, turn: 'R', song: { id: 1, section: 'verse', section_index: 2, t: 105 } };
    expect(describeEvent(playing)).toBe('playing · showoff · verse 2 · turn R · L 100% R 100%');
    const thunder = { ...playing, game: 'thunder', turn: null, thunder: { phase: 'rush', pole: 'L', beat: -3 } };
    expect(describeEvent(thunder)).toBe('playing · thunder · verse 2 · thunder rush L beat -3 · L 100% R 100%');
  });
});

describe('cueView', () => {
  it('maps a claps cue to the badge and a feed line', () => {
    const c = { action: 'cue', timestamp: '', cue: 'claps', side: 'R', reason: 'claps' } as const;
    expect(cueView(c)).toEqual({ badge: '👏 CLAPS', line: 'claps triggered (right pillar): 2 taps in the song → claps sequence running, applause sound' });
    expect(cueView({ ...c, side: 'L', reason: 'applause' }).line).toBe('claps triggered (left pillar): thunder applause from the dark pole → claps sequence running, applause sound');
  });
});

describe('buttonRings', () => {
  const b = (L: string | null, R: string | null, pulses = 0): ButtonLights => ({ L, R, pulses, pulse_ms: pulses ? 1000 : 0 });

  it.each([
    ['left sings', b('lime', null), { L: { name: 'lime', a: 1 }, R: null }],
    ['right sings', b(null, 'blue'), { L: null, R: { name: 'blue', a: 1 } }],
    ['both sing', b('pink', 'pink'), { L: { name: 'pink', a: 1 }, R: { name: 'pink', a: 1 } }],
  ])('%s: the singer side in its colour, the other dim', (_, lights, want) => {
    expect(buttonRings(lights)).toEqual(want);
  });

  it('a handover pulses both rings together, ease in/out, then settles on the new colours', () => {
    const h = b(null, 'blue', 3);
    const at = (s: number) => buttonRings(h, { buttons: h, sinceS: s });
    expect(at(0).L?.a).toBeCloseTo(0);
    const peak = at(1 / 6); // the middle of the first of 3 pulses over 1 s
    expect([peak.L?.a, peak.R?.a]).toEqual([1, 1]);
    expect([peak.L?.name, peak.R?.name]).toEqual(['white', 'blue']); // the dim side pulses white
    expect(at(1 / 3).R?.a).toBeCloseTo(0);
    expect(at(1.01)).toEqual({ L: null, R: { name: 'blue', a: 1 } });
  });

  it('no event buttons: no rings', () => {
    expect(buttonRings(undefined)).toEqual({ L: null, R: null });
  });
});
