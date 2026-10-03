import { describe, it, expect } from 'vitest';
import { bakeFrame, renderSequence, sequenceDuration } from './sequence';
import { PIXEL_COUNT, blankStrip } from './types';
import type { FrameStep, Pixel, Sequence, Step, Transition } from './types';

const px = (color: string, extra: Partial<Pixel> = {}): Pixel => ({ color, brightness: 255, fade_ms: 0, delay_ms: 0, ...extra });

function frame(transition: Partial<Transition>, pixel: (i: number) => Pixel, duration_ms = 1000): FrameStep {
  return {
    kind: 'frame', duration_ms,
    transition: { type: 'cut', ms: 0, direction: 'up', ...transition },
    pixels: Array.from({ length: PIXEL_COUNT }, (_, i) => pixel(i)),
  };
}

const solid = (color: string, duration_ms = 1000): Step => ({
  kind: 'effect', effect: 'solid', duration_ms, brightness: 255, direction: 'up', speed: 1, colors: [color],
});

const rgbAt = (s: Uint8Array, i: number) => [s[i * 3], s[i * 3 + 1], s[i * 3 + 2]];

describe('bakeFrame mirrors the server compiler', () => {
  // Same spot values as backend/tests/test_pillar_golden.py
  it('crossfade with brightness baked in', () => {
    const b = bakeFrame(frame({ type: 'crossfade', ms: 400 }, () => px('#FF8040', { brightness: 128 }), 800));
    expect(b[10]).toEqual({ r: 128, g: 64, b: 32, fade_ms: 400, delay_ms: 0 });
  });

  it('wipe up as long as the step trims the soft edge', () => {
    const b = bakeFrame(frame({ type: 'wipe', ms: 400 }, () => px('#0000FF'), 400));
    expect(b[0]).toEqual({ r: 0, g: 0, b: 255, fade_ms: 40, delay_ms: 0 });
    expect(b[99]).toEqual({ r: 0, g: 0, b: 255, fade_ms: 4, delay_ms: 396 });
  });

  it('wipe down starts at the top', () => {
    const b = bakeFrame(frame({ type: 'wipe', ms: 500, direction: 'down' }, () => px('#FFFFFF')));
    expect(b[99].delay_ms).toBe(0);
    expect(b[0].delay_ms).toBe(495);
  });

  it('custom keeps per-pixel timing; other types ignore it', () => {
    const custom = bakeFrame(frame({ type: 'custom' }, i => px('#FFFFFF', { brightness: 255 - i, fade_ms: i * 5, delay_ms: i * 4 })));
    expect(custom[50]).toEqual({ r: 205, g: 205, b: 205, fade_ms: 250, delay_ms: 200 });
    const cut = bakeFrame(frame({ type: 'cut' }, () => px('#FFFFFF', { fade_ms: 100, delay_ms: 100 })));
    expect([cut[0].fade_ms, cut[0].delay_ms]).toEqual([0, 0]);
  });
});

describe('renderSequence', () => {
  it('plays steps back to back', () => {
    const seq: Sequence = { loop: false, steps: [solid('#FF0000', 500), solid('#00FF00', 500)] };
    expect(sequenceDuration(seq)).toBe(1000);
    expect(rgbAt(renderSequence(seq, 100, 1), 0)).toEqual([255, 0, 0]);
    expect(rgbAt(renderSequence(seq, 600, 1), 0)).toEqual([0, 255, 0]);
  });

  it('a non-looping sequence holds its last output after the end', () => {
    const seq: Sequence = { loop: false, steps: [solid('#FF0000', 500), solid('#00FF00', 500)] };
    expect(rgbAt(renderSequence(seq, 5000, 1), 0)).toEqual([0, 255, 0]);
  });

  it('a looping sequence wraps around', () => {
    const seq: Sequence = { loop: true, steps: [solid('#FF0000', 500), solid('#00FF00', 500)] };
    expect(rgbAt(renderSequence(seq, 1100, 1), 0)).toEqual([255, 0, 0]);
  });

  it('a crossfade frame fades from the previous step\'s final output', () => {
    const seq: Sequence = { loop: false, steps: [solid('#000000', 500), frame({ type: 'crossfade', ms: 400 }, () => px('#C8C8C8'), 1000)] };
    expect(rgbAt(renderSequence(seq, 500, 1), 0)).toEqual([0, 0, 0]);
    expect(rgbAt(renderSequence(seq, 700, 1), 0)).toEqual([100, 100, 100]);
    expect(rgbAt(renderSequence(seq, 900, 1), 0)).toEqual([200, 200, 200]);
  });

  it('a fade towards a darker colour truncates toward zero like C', () => {
    const seq: Sequence = { loop: false, steps: [solid('#FFFFFF', 500), frame({ type: 'crossfade', ms: 3 }, () => px('#000000'), 1000)] };
    // 255 + (0 - 255) * 1 / 3 = 255 - 85 = 170
    expect(rgbAt(renderSequence(seq, 501, 1), 0)).toEqual([170, 170, 170]);
  });

  it('a wipe holds pixels until their delay', () => {
    const seq: Sequence = { loop: false, steps: [solid('#000000', 100), frame({ type: 'wipe', ms: 1000 }, () => px('#FFFFFF'), 1000)] };
    const s = renderSequence(seq, 100 + 500, 1); // halfway through the wipe
    expect(rgbAt(s, 10)).toEqual([255, 255, 255]);
    expect(rgbAt(s, 90)).toEqual([0, 0, 0]);
  });

  it('the first frame of the first pass transitions from the initial strip', () => {
    const seq: Sequence = { loop: true, steps: [frame({ type: 'crossfade', ms: 1000 }, () => px('#C80000'), 1000)] };
    const initial = blankStrip().fill(100);
    expect(rgbAt(renderSequence(seq, 500, 1, initial), 0)).toEqual([150, 50, 50]);
  });

  it('on a loop restart the first frame transitions from the last step\'s final output', () => {
    const seq: Sequence = { loop: true, steps: [
      frame({ type: 'crossfade', ms: 1000 }, () => px('#C80000'), 1000),
      solid('#0000C8', 1000),
    ] };
    // Second pass, halfway through the first frame: blue (last step) → red
    expect(rgbAt(renderSequence(seq, 2500, 1), 0)).toEqual([100, 0, 100]);
  });
});
