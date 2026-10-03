import { describe, expect, it } from 'vitest';
import type { Pole, ShowEvent, ShowSpec } from './events';
import { LEDS, stageFrame } from './stageLook';

const ramp = [[1, 1, 1], [200, 20, 100], [250, 250, 250]];
const spec: ShowSpec = { palette: { pink: { ramp }, lime: { ramp }, blue: { ramp }, white: { ramp } }, games: [] };
const off: Pole = { pct: 0, color: null, mode: 'off', ms: null };
const ev = (over: Partial<ShowEvent>): ShowEvent => ({ state: 'idle', poles: { L: off, R: off }, ...over } as ShowEvent);
const frame = (e: ShowEvent | null, since = 0.1) => stageFrame(spec, { event: e, sinceEventS: since, nowS: 1, beatS: 0.58, look: 0 });
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

  it('solo intro lights only the presser side', () => {
    const f = frame(ev({ state: 'intro', game: 'solo', step: 3, perimeter: { look: 'solid', color: 'pink', side: 'R' } } as Partial<ShowEvent>));
    const lit = litLeds(f);
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every(([x]) => x >= 360)).toBe(true);
  });

  it('showoff intro step 1 merges into pink in the centre', () => {
    const f = frame(ev({ state: 'intro', game: 'showoff', step: 1 } as Partial<ShowEvent>), 0.99);
    expect(f.wash.C?.name).toBe('pink');
  });

  it('thunder tag is a full blackout', () => {
    const f = frame(ev({ state: 'playing', game: 'thunder', thunder: { phase: 'tag', pole: 'L', beat: 0 } } as Partial<ShowEvent>));
    expect(litLeds(f)).toHaveLength(0);
  });
});
