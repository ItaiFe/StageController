import { describe, it, expect } from 'vitest';
import { renderEffect, effectParams } from './effects';
import type { EffectParams } from './effects';
import { EFFECTS, blankStrip } from './types';
import type { Direction } from './types';
import reference from './fixtures/esp-reference.json';

// esp-reference.json is the real ESP renderStep output (StagePillar lib/pillar/led_catalogue.cpp
// at 9d388da), compiled natively and dumped per case/time. The preview must match it exactly.

interface RefCase {
  name: string;
  effect: number;
  duration_ms: number;
  brightness: number;
  direction: number;
  speed_x16: number;
  seed: number;
  colors: number[][];
  frames: { t: number; rgb: number[] }[];
}

const DIRECTIONS: Direction[] = ['up', 'down', 'bounce'];

describe('renderEffect matches the ESP pixel for pixel', () => {
  for (const c of reference as RefCase[]) {
    it(c.name, () => {
      const params: EffectParams = {
        effect: EFFECTS[c.effect],
        durationMs: c.duration_ms,
        brightness: c.brightness,
        direction: DIRECTIONS[c.direction],
        speedX16: c.speed_x16,
        colors: c.colors.map(([r, g, b]) => [r, g, b] as [number, number, number]),
      };
      for (const frame of c.frames) {
        const out = blankStrip();
        renderEffect(params, frame.t, c.seed, out);
        expect(Array.from(out), `${c.name} at t=${frame.t}`).toEqual(frame.rgb);
      }
    });
  }
});

describe('effectParams', () => {
  it('converts an editor step to wire-level params', () => {
    const p = effectParams({
      kind: 'effect', effect: 'comet', duration_ms: 2100, brightness: 200,
      direction: 'bounce', speed: 1.5, colors: ['#FF00C0', '#00E5FF'],
    });
    expect(p).toEqual({
      effect: 'comet', durationMs: 2100, brightness: 200, direction: 'bounce', speedX16: 24,
      colors: [[255, 0, 192], [0, 229, 255], [0, 0, 0]],
    });
  });

  it('clamps time past the end to the last millisecond', () => {
    const p = effectParams({ kind: 'effect', effect: 'fade', duration_ms: 1000, brightness: 255,
      direction: 'up', speed: 1, colors: ['#FF0000', '#000000'] });
    const a = blankStrip(), b = blankStrip();
    renderEffect(p, 999, 1, a);
    renderEffect(p, 5000, 1, b);
    expect(Array.from(b)).toEqual(Array.from(a));
  });
});
