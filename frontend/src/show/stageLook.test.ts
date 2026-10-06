import { describe, expect, it } from 'vitest';
import type { Pole, ShowEvent, ShowSpec } from './events';
import { LEDS, stageFrame } from './stageLook';

const ramp = [[1, 1, 1], [200, 20, 100], [250, 250, 250]];
const spec: ShowSpec = { palette: { pink: { ramp }, lime: { ramp }, blue: { ramp }, white: { ramp } }, games: [] };
const off: Pole = { pct: 0, color: null, mode: 'off', ms: null };
const ev = (over: Partial<ShowEvent>): ShowEvent => ({ state: 'idle', poles: { L: off, R: off }, ...over } as ShowEvent);
const frame = (e: ShowEvent | null, since = 0.1) => stageFrame(spec, { event: e, sinceEventS: since, nowS: 1 });
const litLeds = (f: ReturnType<typeof frame>) => LEDS.filter((_, i) => f.leds[i] && f.leds[i]!.a > 0);

describe('stageFrame', () => {
  it('idle: the whole perimeter breathes dim pink, poles off', () => {
    const f = frame(null);
    expect(litLeds(f)).toHaveLength(LEDS.length);
    expect(f.poles).toEqual({ L: null, R: null });
  });

  it('fail blink: poles only, no perimeter', () => {
    const f = frame(ev({ state: 'failing', poles: { L: { pct: 100, color: 'white', mode: 'solid', ms: null }, R: off } }));
    expect(litLeds(f)).toHaveLength(0);
    expect(f.poles.L?.pct).toBe(100);
  });

  it('solo intro is symmetric: both poles and both halves of the edge, pink', () => {
    const p: Pole = { pct: 100, color: 'pink', mode: 'solid', ms: null };
    const f = frame(ev({ state: 'intro', game: 'solo', step: 3, poles: { L: p, R: p }, perimeter: { look: 'intro', color: 'pink', side: 'both' } } as Partial<ShowEvent>));
    const lit = litLeds(f);
    expect(lit.some(([x]) => x < 360) && lit.some(([x]) => x > 360)).toBe(true);
    expect([f.poles.L?.pct, f.poles.R?.pct]).toEqual([100, 100]);
  });

  it('showoff intro step 1 merges into pink in the centre', () => {
    const f = frame(ev({ state: 'intro', game: 'showoff', step: 1 } as Partial<ShowEvent>), 0.99);
    expect(f.wash.C?.name).toBe('pink');
  });

  it('in song the poles glow full height at the event level, the button lit; the side not singing is drawn dim (14 %), its button off', () => {
    const glow: Pole = { pct: 100, color: 'lime', mode: 'glow', ms: null, level: 35 };
    const f = frame(ev({ state: 'playing', game: 'duet', poles: { L: glow, R: off } } as Partial<ShowEvent>));
    expect(f.poles.L).toMatchObject({ pct: 100, name: 'lime', a: 0.35, sing: true });
    expect(f.poles.R).toEqual({ pct: 100, name: 'blue', a: 0.14, dim: true });
    expect(f.buttons).toEqual({ L: true, R: false });
  });

  const th = (phase: 'cooldown' | 'ready' | 'steal', pct: number, R: Pole) => ev({ state: 'playing', game: 'thunder',
    poles: { L: { pct: 100, color: 'lime', mode: 'solid', ms: null }, R }, thunder: { phase, performer: 'L', pct },
    buttons: { L: 'lime', R: 'blue', pulses: 0, pulse_ms: 0, flicker: phase === 'ready' ? 'R' : null } } as Partial<ShowEvent>);

  it('thunder cooldown: the performer full in lime, the rival pole rising blue to the event %, both rings in colour', () => {
    const f = frame(th('cooldown', 40, { pct: 40, color: 'blue', mode: 'solid', ms: null }));
    expect([f.poles.L?.pct, f.poles.L?.name, f.poles.R?.pct, f.poles.R?.name]).toEqual([100, 'lime', 40, 'blue']);
    expect(f.rings).toEqual({ L: { name: 'lime', a: 1 }, R: { name: 'blue', a: 1 } });
  });

  it('thunder ready: the full rival pole and its ring fade up and down together (steal now)', () => {
    const R: Pole = { pct: 100, color: 'blue', mode: 'pulse', ms: 500 };
    const low = frame(th('ready', 100, R), 0), high = frame(th('ready', 100, R), 0.25);
    expect([low.rings!.R!.a, high.rings!.R!.a, low.poles.R!.a, high.poles.R!.a].map(a => +a.toFixed(2))).toEqual([0.1, 1, 0.1, 1]);
    expect(low.rings!.L).toEqual({ name: 'lime', a: 1 });
  });

  it('thunder steal is a full blackout', () => {
    const f = frame(ev({ state: 'playing', game: 'thunder', thunder: { phase: 'steal', performer: 'R', pct: 0 } } as Partial<ShowEvent>));
    expect(litLeds(f)).toHaveLength(0);
    expect(f.poles).toEqual({ L: null, R: null });
  });
});
