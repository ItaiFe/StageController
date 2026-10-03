// Pure editing operations for pillar sequences (no React). Every function returns a new
// object so the editor's undo history can keep old versions.

import { MAX_DURATION_MS, MAX_STEPS, MIN_DURATION_MS, PIXEL_COUNT, hexToRgb, rgbToHex } from './types';
import type { EffectStep, FrameStep, Pixel, Sequence } from './types';

export function newFrame(color = '#000000'): FrameStep {
  return {
    kind: 'frame',
    duration_ms: 1000,
    transition: { type: 'cut', ms: 0, direction: 'up' },
    pixels: Array.from({ length: PIXEL_COUNT }, () => ({ color, brightness: 255, fade_ms: 0, delay_ms: 0 })),
  };
}

export function newEffect(): EffectStep {
  return { kind: 'effect', effect: 'rainbow', duration_ms: 2000, brightness: 255, direction: 'up', speed: 1, colors: [] };
}

export function normalizeRange(a: number, b: number): [number, number] {
  const clamp = (v: number) => Math.max(0, Math.min(PIXEL_COUNT - 1, v));
  return [clamp(Math.min(a, b)), clamp(Math.max(a, b))];
}

function withPixels(frame: FrameStep, update: (px: Pixel, i: number) => Pixel, customTiming = false): FrameStep {
  return {
    ...frame,
    transition: customTiming ? { ...frame.transition, type: 'custom' } : frame.transition,
    pixels: frame.pixels.map(update),
  };
}

export function paint(frame: FrameStep, indices: number[], color: string): FrameStep {
  const set = new Set(indices);
  return withPixels(frame, (px, i) => (set.has(i) ? { ...px, color } : px));
}

/** Linear RGB gradient from colorA at index `from` to colorB at index `to` (either order). */
export function gradient(frame: FrameStep, from: number, to: number, colorA: string, colorB: string): FrameStep {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const span = Math.abs(to - from);
  const [lo, hi] = normalizeRange(from, to);
  return withPixels(frame, (px, i) => {
    if (i < lo || i > hi) return px;
    const k = span === 0 ? 0 : Math.abs(i - from) / span;
    const mix = a.map((c, ch) => Math.trunc(c + (b[ch] - c) * k)) as [number, number, number];
    return { ...px, color: rgbToHex(...mix) };
  });
}

/** Per-pixel brightness/fade/delay; touching fade or delay makes the transition custom. */
export function setPixelProps(frame: FrameStep, indices: number[], props: Partial<Omit<Pixel, 'color'>>): FrameStep {
  const set = new Set(indices);
  const timing = props.fade_ms !== undefined || props.delay_ms !== undefined;
  return withPixels(frame, (px, i) => (set.has(i) ? { ...px, ...props } : px), timing);
}

/** Delays ramp linearly from delayFrom (at index `from`) to delayTo (at index `to`). */
export function rampDelay(frame: FrameStep, from: number, to: number, delayFrom: number, delayTo: number): FrameStep {
  const [lo, hi] = normalizeRange(from, to);
  const span = Math.abs(to - from);
  return withPixels(frame, (px, i) => {
    if (i < lo || i > hi) return px;
    const k = span === 0 ? 0 : Math.abs(i - from) / span;
    return { ...px, delay_ms: Math.round(delayFrom + (delayTo - delayFrom) * k) };
  }, true);
}

/**
 * Client-side copy of the server's validation, so problems show on the step before saving.
 * Keys are step indices; -1 is for the sequence as a whole.
 */
export function validateSequence(seq: Sequence): Record<number, string> {
  const errors: Record<number, string> = {};
  if (seq.steps.length === 0) errors[-1] = 'Add at least one step';
  if (seq.steps.length > MAX_STEPS) errors[-1] = `At most ${MAX_STEPS} steps`;
  seq.steps.forEach((step, i) => {
    const d = step.duration_ms;
    if (!(d >= MIN_DURATION_MS && d <= MAX_DURATION_MS)) {
      errors[i] = `Duration must be ${MIN_DURATION_MS}–${MAX_DURATION_MS} ms`;
      return;
    }
    if (step.kind !== 'frame') return;
    const t = step.transition;
    if ((t.type === 'crossfade' || t.type === 'wipe') && t.ms > d) {
      errors[i] = `${t.type} time (${t.ms} ms) is longer than the step (${d} ms)`;
      return;
    }
    if (t.type === 'custom') {
      const bad = step.pixels.findIndex(px => px.delay_ms + px.fade_ms > d);
      if (bad >= 0) {
        const px = step.pixels[bad];
        errors[i] = `LED ${bad + 1} delay + fade (${px.delay_ms + px.fade_ms} ms) is longer than the step (${d} ms)`;
      }
    }
  });
  return errors;
}
