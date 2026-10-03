// The T-stage the way the stage spec draws it (stage-spec.html: Stage, introFrame, thFrame), driven by
// show events. Pole fill comes from the events (binding); the perimeter, washes and the smoke puff
// follow the spec's drawings (illustration, spec intro.binding).

import { poleState } from './events';
import type { Rgb, ShowEvent, ShowSpec } from './events';

export type Side = 'L' | 'R';
export type Wash = 'L' | 'R' | 'C';

export const TPATH = 'M40 25H680V195H416V367H303V195H40Z';
const POLY: [number, number][] = [[40, 25], [680, 25], [680, 195], [416, 195], [416, 367], [303, 367], [303, 195], [40, 195]];
export const POLE_X: Record<Side, number> = { L: 271, R: 442 };
export const SEGMENTS = 24;
export const OFF: Rgb = [30, 22, 28];
const MID = 360;
const TAU = Math.PI * 2;
// thunder: the perimeter colour after each tag ("new look")
export const LOOKS = ['pink', 'lime', 'blue'];

/** LED positions every `step` px around the T. */
function perimeter(step: number): [number, number][] {
  const pts: [number, number][] = [];
  let carry = 0;
  POLY.forEach((a, e) => {
    const b = POLY[(e + 1) % POLY.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = carry;
    for (; d < len; d += step) pts.push([a[0] + ((b[0] - a[0]) * d) / len, a[1] + ((b[1] - a[1]) * d) / len]);
    carry = d - len;
  });
  return pts;
}
export const LEDS = perimeter(15);

export interface Lit { name: string; a: number }
export interface StageFrame {
  leds: ({ c: Rgb; a: number } | null)[];
  wash: Partial<Record<Wash, Lit>>;
  poles: Record<Side, (Lit & { pct: number }) | null>;
  buttons: Record<Side, boolean>;
  puff: { r: number; a: number } | null;
  strips?: Partial<Record<Side, Rgb[]>>; // a pole showing the pillar's own slot sequence, bottom first
}

export interface StageInput {
  event: ShowEvent | null;
  sinceEventS: number; // since the event arrived
  nowS: number; // free-running clock for the colour drift
  beatS: number; // one beat of the song playing
  look: number; // thunder: tags so far (picks the perimeter colour)
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

function tunable(spec: ShowSpec, id: string, fallback: number): number {
  const v = spec.tunables?.find(t => t.id === id)?.value;
  return typeof v === 'number' ? v : fallback;
}

/** The palette's drifting gradient (spec palette ramps, driftPeriodMs / pinkDriftPeriodMs). */
export function drift(spec: ShowSpec, name: string, i: number, t: number): Rgb {
  const ramp = spec.palette[name]?.ramp as Rgb[] | undefined;
  if (!ramp) return [255, 255, 255];
  const period = tunable(spec, name === 'pink' ? 'pinkDriftPeriodMs' : 'driftPeriodMs', 2800) / 1000;
  const k = 0.5 + 0.5 * Math.sin(i * 0.33 - (t * TAU) / period);
  const c = k < 0.5 ? mix(ramp[0], ramp[1], k * 2) : mix(ramp[1], ramp[2], (k - 0.5) * 2);
  const gain = tunable(spec, `${name}Gain`, 1);
  return [c[0] * gain, c[1] * gain, c[2] * gain];
}

const half = (side: string | null | undefined) => (p: [number, number]) =>
  side === 'L' ? p[0] < MID : side === 'R' ? p[0] >= MID : side === 'centre' ? Math.abs(p[0] - MID) <= 115 : true;

export function stageFrame(spec: ShowSpec, { event, sinceEventS, nowS: t, beatS, look }: StageInput): StageFrame {
  const f: StageFrame = { leds: LEDS.map(() => null), wash: {}, poles: { L: null, R: null }, buttons: { L: false, R: false }, puff: null };
  const paint = (name: string, a: number, pick: (p: [number, number]) => boolean = () => true) =>
    LEDS.forEach((p, i) => { if (pick(p)) f.leds[i] = { c: drift(spec, name, i, t), a: clamp(a) }; });
  const poles = (bright = 1) => {
    for (const s of ['L', 'R'] as Side[]) {
      const pole = event?.poles[s];
      if (!pole?.color) continue;
      const { pct, level } = poleState(pole, sinceEventS * 1000);
      if (pct > 0) f.poles[s] = { pct, name: pole.color, a: level * bright };
    }
  };

  if (!event || event.state === 'idle') {
    paint('pink', 0.12); // idle: the stage breathes pink, waiting for someone
    return f;
  }
  if (event.state === 'launching') {
    paint('pink', 0.12);
    poles();
    f.buttons = { L: !!f.poles.L, R: !!f.poles.R };
    return f;
  }
  if (event.state === 'failing') {
    poles(); // alternate white blinks, then the fade; no perimeter (spec intro.perGame.fail)
    f.buttons = { L: !!f.poles.L && event.poles.L.mode !== 'drain', R: !!f.poles.R && event.poles.R.mode !== 'drain' };
    return f;
  }
  if (event.state === 'intro') return intro(spec, event, sinceEventS, t, f, paint, poles);
  return playing(spec, event, sinceEventS, t, beatS, look, f, paint, poles);
}

type Paint = (name: string, a: number, pick?: (p: [number, number]) => boolean) => void;

function intro(spec: ShowSpec, e: ShowEvent, since: number, t: number, f: StageFrame, paint: Paint, poles: (b?: number) => void) {
  const step = 3 - (e.step ?? 3); // 0, 1, 2 for counts 3, 2, 1
  const stepS = tunable(spec, 'introStepMs', 1000) / 1000;
  const local = clamp(since / stepS, 0, 0.999);
  const hit = 1 - 0.55 * local; // each count lands bright, then settles
  const side = e.perimeter?.side;
  if (e.game === 'showoff' && step === 2) {
    // both sides sweep inward and merge into pink
    const p1 = clamp(local / 0.6), q = clamp((local - 0.6) / 0.4);
    LEDS.forEach(([x], i) => {
      let name: string | null = null;
      if (x < 40 + p1 * 320) name = 'lime';
      if (x > 680 - p1 * 320) name = 'blue';
      if (Math.abs(x - MID) < q * 320) name = 'pink';
      if (name) f.leds[i] = { c: drift(spec, name, i, t), a: 1 };
    });
    f.wash = { L: { name: 'lime', a: 0.16 * (1 - q) }, R: { name: 'blue', a: 0.16 * (1 - q) }, C: { name: 'pink', a: 0.2 * q } };
  } else if (e.game === 'showoff' || e.game === 'thunder') {
    const name = e.game === 'thunder' ? 'white' : step === 0 ? 'lime' : 'blue';
    paint(name, hit, half(side));
    const where: Wash = side === 'L' ? 'L' : side === 'R' ? 'R' : 'C';
    f.wash[where] = { name, a: (e.game === 'thunder' ? 0.12 : 0.2) * hit };
  } else {
    // duet (both sides) and solo (the presser's side): pink, brighter with each count
    const a = [0.4, 0.65, 0.95][step] * (0.7 + 0.3 * hit);
    paint('pink', a, half(side));
    if (side !== 'R') f.wash.L = { name: 'pink', a: 0.1 * a };
    if (side !== 'L') f.wash.R = { name: 'pink', a: 0.1 * a };
  }
  poles(0.75 + 0.25 * hit);
  f.buttons = { L: !!f.poles.L && hit > 0.5, R: !!f.poles.R && hit > 0.5 };
  return f;
}

function playing(spec: ShowSpec, e: ShowEvent, since: number, t: number, beatS: number, look: number,
  f: StageFrame, paint: Paint, poles: (b?: number) => void) {
  const th = e.thunder;
  if (e.game === 'showoff' && e.turn && e.turn !== 'both') {
    // a verse: the singer's side in their colour
    const name = e.turn === 'L' ? 'lime' : 'blue';
    paint(name, 0.5, half(e.turn));
    f.wash[e.turn] = { name, a: 0.16 };
    return f;
  }
  if (e.game !== 'thunder') {
    // together (every section of solo and duet, showoff choruses): the intro's pink settling to 0.28
    const songT = (e.song?.t ?? 1) + since;
    paint('pink', lerp(1, 0.28, clamp(songT / 0.7)));
    f.wash.C = { name: 'pink', a: 0.06 };
    return f;
  }
  const name = LOOKS[look % LOOKS.length];
  if (!th) { // thunder between windows: the current look, calm
    paint(name, 0.3);
    f.wash.C = { name, a: 0.06 };
    return f;
  }
  const tb = th.beat + Math.min(since / beatS, 0.999); // beats from the verse change, with the fraction
  const fr = (tb * (th.phase === 'rush' ? 2 : 1)) % 1;
  const centre: [number, number] = [POLE_X[th.pole], 395];
  if (th.phase === 'tag') return f; // half a beat of blackout
  LEDS.forEach((p, i) => {
    let c = drift(spec, name, i, t), a = 0.3;
    if (th.phase === 'build' || th.phase === 'rush') {
      // white rings run out of the active pole, once a beat, twice in the rush
      const d = Math.hypot(p[0] - centre[0], p[1] - centre[1]);
      const w = Math.pow(0.5 + 0.5 * Math.cos(TAU * (d / 170 + fr)), 3) * (th.phase === 'rush' ? 1 : 0.7);
      c = mix(c, [255, 255, 255], w);
      a = 0.18 + 0.82 * w;
    } else if (th.phase === 'open' || th.phase === 'window') {
      a = 0.45;
      const fl = th.phase === 'open' ? 1 - (since / beatS) * 2 : 0; // the open beat flashes white
      if (fl > 0) { c = mix(c, [255, 255, 255], fl); a = Math.max(a, fl); }
    } else if (th.phase === 'new_look') {
      a = lerp(1, 0.32, clamp(since));
    } else if (th.phase === 'early') {
      a = 0.75 + 0.25 * Math.cos(TAU * tb); // the halo: the stage glows for the one who stays
    }
    f.leds[i] = { c, a };
  });
  f.wash.C = { name, a: th.phase === 'early' ? 0.22 : 0.06 };
  if (th.phase === 'new_look') {
    const k = clamp(since / 1.5);
    f.puff = { r: lerp(30, 120, k), a: 0.4 * (1 - k) };
  }
  const counting = th.phase === 'build' || th.phase === 'rush';
  poles(counting ? 0.6 + 0.4 * (1 - fr) : 1);
  const on = counting ? fr < 0.4 : th.phase === 'open' || th.phase === 'window';
  f.buttons[th.pole] = on;
  return f;
}
