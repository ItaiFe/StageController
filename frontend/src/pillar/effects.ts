// TypeScript port of the ESP's effect renderer (StagePillar lib/pillar/led_catalogue.cpp),
// so the editor's preview matches the real pillar. All maths mirrors the C++ uint32/uint8
// arithmetic exactly; effects.test.ts checks it against the ESP's own output.

import { PIXEL_COUNT, hexToRgb, speedX16 } from './types';
import type { Direction, EffectName, EffectStep, Strip } from './types';

type Rgb = [number, number, number];

export interface EffectParams {
  effect: EffectName;
  durationMs: number;
  brightness: number;
  direction: Direction;
  speedX16: number;
  /** Always 3 entries; unused ones are black */
  colors: Rgb[];
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

// Reference timings at speed 1.0
const RAINBOW_MS_PER_LED = 80;
const COMET_PASS_MS = 1000;
const COMET_TAIL = 20;
const SPARKLE_WINDOW_MS = 80;
const PULSE_MS = 750;
const BAND_PASS_MS = 500;
const BAND_WIDTH = 15;

const div = (a: number, b: number) => Math.trunc(a / b);

export function effectParams(step: EffectStep): EffectParams {
  const colors = step.colors.slice(0, 3).map(hexToRgb);
  while (colors.length < 3) colors.push(BLACK);
  return {
    effect: step.effect,
    durationMs: step.duration_ms,
    brightness: step.brightness,
    direction: step.direction,
    speedX16: speedX16(step.speed),
    colors,
  };
}

function scale(c: Rgb, level: number): Rgb {
  return [div(c[0] * level, 255), div(c[1] * level, 255), div(c[2] * level, 255)];
}

function lerp8(a: number, b: number, t: number, total: number): number {
  return (a + div((b - a) * t, total)) & 0xff;
}

// Fully saturated colour wheel: 0 red, 85 green, 170 blue
function hueToRgb(hue: number): Rgb {
  const region = div(hue, 43);
  const rise = ((hue - region * 43) * 6) & 0xff;
  const fall = 255 - rise;
  switch (region) {
    case 0: return [255, rise, 0];
    case 1: return [fall, 255, 0];
    case 2: return [0, 255, rise];
    case 3: return [0, fall, 255];
    case 4: return [rise, 0, 255];
    default: return [255, 0, fall];
  }
}

function hash(a: number, b: number, c: number): number {
  let x = (Math.imul(a, 2654435761) ^ Math.imul(b, 40503) ^ Math.imul(c, 2246822519)) >>> 0;
  x = (x ^ (x >>> 15)) >>> 0;
  x = Math.imul(x, 2654435761) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  return x;
}

const isBlack = (c: Rgb) => c[0] === 0 && c[1] === 0 && c[2] === 0;

function colorCount(p: EffectParams): number {
  let n = 0;
  while (n < 3 && !isBlack(p.colors[n])) n++;
  return n || 1;
}

function scaled(referenceMs: number, x16: number): number {
  return div(referenceMs * 16, x16 || 16) || 1;
}

function passUp(d: Direction, pass: number): boolean {
  if (d === 'down') return false;
  if (d === 'bounce') return pass % 2 === 0;
  return true;
}

function set(out: Strip, i: number, c: Rgb) {
  out[i * 3] = c[0];
  out[i * 3 + 1] = c[1];
  out[i * 3 + 2] = c[2];
}

function fillAll(out: Strip, c: Rgb) {
  for (let i = 0; i < PIXEL_COUNT; i++) set(out, i, c);
}

function rainbow(p: EffectParams, t: number, out: Strip) {
  const shift = div(t, scaled(RAINBOW_MS_PER_LED, p.speedX16));
  const up = p.direction !== 'down';
  for (let i = 0; i < PIXEL_COUNT; i++) set(out, i, hueToRgb(((up ? i - shift : i + shift) * 5) & 0xff));
}

function comet(p: EffectParams, t: number, out: Strip) {
  const passMs = scaled(COMET_PASS_MS, p.speedX16);
  const pass = div(t, passMs);
  const head = div((t % passMs) * (PIXEL_COUNT + COMET_TAIL), passMs);
  const up = passUp(p.direction, pass);
  const color = p.colors[pass % colorCount(p)];
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const pos = up ? i : PIXEL_COUNT - 1 - i;
    set(out, i, pos <= head && head - pos < COMET_TAIL
      ? scale(color, div(255 * (COMET_TAIL - (head - pos)), COMET_TAIL))
      : BLACK);
  }
}

function fill(p: EffectParams, t: number, out: Strip) {
  const fillMs = div(p.durationMs * 3, 5);
  const head = t < fillMs ? div(t * PIXEL_COUNT, fillMs) : PIXEL_COUNT;
  const level = t < fillMs ? 255 : div(255 * (p.durationMs - t), p.durationMs - fillMs);
  const up = p.direction !== 'down';
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const pos = up ? i : PIXEL_COUNT - 1 - i;
    set(out, i, pos < head ? scale(p.colors[0], level) : BLACK);
  }
}

function sparkle(p: EffectParams, t: number, seed: number, out: Strip) {
  const color = isBlack(p.colors[0]) ? WHITE : p.colors[0];
  const level = div(255 * (p.durationMs - t), p.durationMs);
  const window = div(t, scaled(SPARKLE_WINDOW_MS, p.speedX16));
  for (let i = 0; i < PIXEL_COUNT; i++) set(out, i, hash(i, seed, window) % 100 < 15 ? scale(color, level) : BLACK);
}

function pulse(p: EffectParams, t: number, out: Strip) {
  const period = scaled(PULSE_MS, p.speedX16);
  const phase = t % period;
  const half = div(period, 2);
  const level = phase < half ? div(phase * 255, half) : div((period - phase) * 255, half);
  fillAll(out, scale(p.colors[div(t, period) % colorCount(p)], level));
}

function band(p: EffectParams, t: number, out: Strip) {
  const passMs = scaled(BAND_PASS_MS, p.speedX16);
  const pass = div(t, passMs);
  const head = div((t % passMs) * (PIXEL_COUNT + BAND_WIDTH), passMs);
  const up = passUp(p.direction, pass);
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const pos = up ? i : PIXEL_COUNT - 1 - i;
    set(out, i, pos <= head && pos + BAND_WIDTH > head ? p.colors[0] : BLACK);
  }
}

function fade(p: EffectParams, t: number, out: Strip) {
  const [a, b] = p.colors;
  fillAll(out, [lerp8(a[0], b[0], t, p.durationMs), lerp8(a[1], b[1], t, p.durationMs), lerp8(a[2], b[2], t, p.durationMs)]);
}

/** Draw the effect at msSinceStart into out (seed varies sparkle, like the ESP's start millis). */
export function renderEffect(p: EffectParams, msSinceStart: number, seed: number, out: Strip) {
  const t = msSinceStart < p.durationMs ? msSinceStart : Math.max(0, p.durationMs - 1);
  switch (p.effect) {
    case 'solid': fillAll(out, p.colors[0]); break;
    case 'rainbow': rainbow(p, t, out); break;
    case 'comet': comet(p, t, out); break;
    case 'fill': fill(p, t, out); break;
    case 'sparkle': sparkle(p, t, seed, out); break;
    case 'pulse': pulse(p, t, out); break;
    case 'band': band(p, t, out); break;
    case 'fade': fade(p, t, out); break;
    default: fillAll(out, BLACK);
  }
  if (p.brightness < 255) {
    for (let i = 0; i < out.length; i++) out[i] = div(out[i] * p.brightness, 255);
  }
}
