import { describe, it, expect } from 'vitest';
import { newFrame, newEffect, paint, gradient, setPixelProps, rampDelay, validateSequence, normalizeRange } from './painter';
import type { FrameStep, Sequence } from './types';

const colors = (f: FrameStep, from: number, to: number) => f.pixels.slice(from, to).map(p => p.color);

describe('painter', () => {
  it('newFrame makes 100 black pixels with a cut', () => {
    const f = newFrame();
    expect(f.pixels).toHaveLength(100);
    expect(new Set(f.pixels.map(p => p.color))).toEqual(new Set(['#000000']));
    expect(f.transition.type).toBe('cut');
  });

  it('newEffect copies nothing between calls', () => {
    const a = newEffect();
    a.colors.push('#123456');
    expect(newEffect().colors).not.toContain('#123456');
  });

  it('paint sets colour on the given indices and leaves the original untouched', () => {
    const f = newFrame();
    const g = paint(f, [3, 4], '#FF0000');
    expect(colors(g, 2, 6)).toEqual(['#000000', '#FF0000', '#FF0000', '#000000']);
    expect(f.pixels[3].color).toBe('#000000');
  });

  it('gradient interpolates between two colours across a range, either way round', () => {
    const g = gradient(newFrame(), 10, 14, '#000000', '#FF0000');
    expect(colors(g, 10, 15)).toEqual(['#000000', '#3F0000', '#7F0000', '#BF0000', '#FF0000']);
    const back = gradient(newFrame(), 14, 10, '#000000', '#FF0000');
    expect(back.pixels[14].color).toBe('#000000');
    expect(back.pixels[10].color).toBe('#FF0000');
  });

  it('setPixelProps changes brightness/fade on a range', () => {
    const g = setPixelProps(newFrame(), [0, 1], { brightness: 128, fade_ms: 200 });
    expect(g.pixels[0]).toMatchObject({ brightness: 128, fade_ms: 200 });
    expect(g.pixels[2]).toMatchObject({ brightness: 255, fade_ms: 0 });
  });

  it('rampDelay spreads delays linearly across the selection', () => {
    const g = rampDelay(newFrame(), 0, 4, 0, 400);
    expect(g.pixels.slice(0, 5).map(p => p.delay_ms)).toEqual([0, 100, 200, 300, 400]);
    expect(g.pixels[5].delay_ms).toBe(0);
  });

  it('per-pixel timing switches the transition to custom', () => {
    expect(setPixelProps(newFrame(), [0], { fade_ms: 10 }).transition.type).toBe('custom');
    expect(rampDelay(newFrame(), 0, 3, 0, 30).transition.type).toBe('custom');
    expect(setPixelProps(newFrame(), [0], { brightness: 10 }).transition.type).toBe('cut');
  });

  it('normalizeRange orders and clamps', () => {
    expect(normalizeRange(50, 10)).toEqual([10, 50]);
    expect(normalizeRange(-5, 200)).toEqual([0, 99]);
  });
});

describe('validateSequence (mirrors the server)', () => {
  const seq = (...steps: Sequence['steps']): Sequence => ({ loop: false, steps });

  it('a valid sequence has no errors', () => {
    expect(validateSequence(seq(newEffect(), newFrame()))).toEqual({});
  });

  it('needs at least one step', () => {
    expect(validateSequence(seq())[-1]).toMatch(/at least one step/);
  });

  it('flags durations out of range on the step', () => {
    const e = { ...newEffect(), duration_ms: 20 };
    expect(validateSequence(seq(newFrame(), e))[1]).toMatch(/50/);
  });

  it('flags a transition longer than the step', () => {
    const f = { ...newFrame(), duration_ms: 500, transition: { type: 'wipe' as const, ms: 600, direction: 'up' as const } };
    expect(validateSequence(seq(f))[0]).toMatch(/wipe/);
  });

  it('flags custom pixel timing longer than the step, naming the LED', () => {
    const f = setPixelProps({ ...newFrame(), duration_ms: 500 }, [41], { fade_ms: 300, delay_ms: 300 });
    expect(validateSequence(seq(f))[0]).toMatch(/LED 42.*600.*500/);
  });
});
