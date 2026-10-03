// Whole-sequence rendering for the editor preview, following the ESP rules in
// docs/pillar-led-contract.md: steps play back to back; a frame step snapshots what the strip
// shows when it starts and moves each pixel from that snapshot to its target (hold until
// delay_ms, then fade linearly over fade_ms).

import { effectParams, renderEffect } from './effects';
import { PIXEL_COUNT, blankStrip, hexToRgb } from './types';
import type { FrameStep, Sequence, Step, Strip } from './types';

const WIPE_EDGE_MAX_MS = 150;
const div = (a: number, b: number) => Math.trunc(a / b);

export interface BakedPixel {
  r: number;
  g: number;
  b: number;
  fade_ms: number;
  delay_ms: number;
}

/** Same conversion as backend/app/features/pillar/compiler.py bake_frame. */
export function bakeFrame(step: FrameStep): BakedPixel[] {
  const t = step.transition;
  const count = step.pixels.length;
  return step.pixels.map((px, i) => {
    let delay = 0;
    let fade = 0;
    if (t.type === 'custom') {
      delay = px.delay_ms;
      fade = px.fade_ms;
    } else if (t.type === 'crossfade') {
      fade = t.ms;
    } else if (t.type === 'wipe') {
      const pos = t.direction === 'up' ? i : count - 1 - i;
      delay = div(pos * t.ms, count);
      fade = Math.min(WIPE_EDGE_MAX_MS, div(t.ms, 10));
    }
    if (t.type !== 'custom') fade = Math.min(fade, Math.max(0, step.duration_ms - delay));
    const [r, g, b] = hexToRgb(px.color).map(c => div(c * px.brightness, 255));
    return { r, g, b, fade_ms: fade, delay_ms: delay };
  });
}

export function sequenceDuration(seq: Sequence): number {
  return seq.steps.reduce((sum, s) => sum + s.duration_ms, 0);
}

function renderFrame(baked: BakedPixel[], snapshot: Strip, t: number, out: Strip) {
  for (let i = 0; i < PIXEL_COUNT; i++) {
    const p = baked[i];
    const target = [p.r, p.g, p.b];
    for (let c = 0; c < 3; c++) {
      const from = snapshot[i * 3 + c];
      let v: number;
      if (t < p.delay_ms) v = from;
      else if (p.fade_ms === 0 || t >= p.delay_ms + p.fade_ms) v = target[c];
      else v = from + div((target[c] - from) * (t - p.delay_ms), p.fade_ms);
      out[i * 3 + c] = v;
    }
  }
}

/** What a step shows when it ends (frames end on their targets; snapshots don't matter). */
function finalOutput(step: Step, seed: number): Strip {
  const out = blankStrip();
  if (step.kind === 'frame') {
    bakeFrame(step).forEach((p, i) => out.set([p.r, p.g, p.b], i * 3));
  } else {
    renderEffect(effectParams(step), step.duration_ms - 1, seed, out);
  }
  return out;
}

/**
 * The strip at `ms` since the sequence started. `initial` is what was showing before the
 * sequence (black by default); it seeds the first frame of the first pass.
 */
export function renderSequence(seq: Sequence, ms: number, seed: number, initial: Strip = blankStrip()): Strip {
  const out = blankStrip();
  const total = sequenceDuration(seq);
  if (seq.steps.length === 0 || total === 0) return out;

  const pass = seq.loop ? Math.floor(ms / total) : 0;
  let t = seq.loop ? ms % total : ms;
  if (!seq.loop && t >= total) return finalOutput(seq.steps[seq.steps.length - 1], seed);

  let index = 0;
  while (t >= seq.steps[index].duration_ms) {
    t -= seq.steps[index].duration_ms;
    index++;
  }
  const step = seq.steps[index];

  if (step.kind === 'effect') {
    renderEffect(effectParams(step), t, seed, out);
    return out;
  }
  const snapshot = index > 0
    ? finalOutput(seq.steps[index - 1], seed)
    : pass > 0 ? finalOutput(seq.steps[seq.steps.length - 1], seed) : initial;
  renderFrame(bakeFrame(step), snapshot, t, out);
  return out;
}

/** A still picture of a step for thumbnails: a frame's targets, an effect mid-way through. */
export function stepStill(step: Step, seed = 1): Strip {
  if (step.kind === 'frame') return finalOutput(step, seed);
  const out = blankStrip();
  renderEffect(effectParams(step), Math.floor(step.duration_ms / 2), seed, out);
  return out;
}
