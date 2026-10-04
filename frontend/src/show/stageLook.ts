// The T-stage the way the stage spec draws it (stage-spec.html: Stage, introFrame, thFrame), driven by
// show events. Pole fill comes from the events (binding); the perimeter, washes and the smoke puff
// follow the spec's drawings (illustration, spec intro.binding).

import { buttonRings, poleState, pulseLevel } from './events';
import type { ButtonLights, Rgb, Ring, ShowEvent, ShowSpec } from './events';

export type Side = 'L' | 'R';
export type Wash = 'L' | 'R' | 'C';

export const TPATH = 'M40 25H680V195H416V367H303V195H40Z';
const POLY: [number, number][] = [[40, 25], [680, 25], [680, 195], [416, 195], [416, 367], [303, 367], [303, 195], [40, 195]];
export const POLE_X: Record<Side, number> = { L: 271, R: 442 };
export const SEGMENTS = 24;
export const OFF: Rgb = [30, 22, 28];
const MID = 360;
const TAU = Math.PI * 2;
const OWN: Record<Side, string> = { L: 'lime', R: 'blue' };

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
  rings?: { L: Ring; R: Ring }; // in song: the button rings in the singer's colour
  puff: { r: number; a: number } | null;
  strips?: Partial<Record<Side, Rgb[]>>; // a pole showing the pillar's own slot sequence, bottom first
}

export interface StageInput {
  event: ShowEvent | null;
  sinceEventS: number; // since the event arrived
  nowS: number; // free-running clock for the colour drift
  handover?: { buttons: ButtonLights; sinceS: number } | null; // the last change of singer
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

export function stageFrame(spec: ShowSpec, { event, sinceEventS, nowS: t, handover }: StageInput): StageFrame {
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
  if (event.thunder) return thunder(event, sinceEventS, f, paint, poles);
  f.rings = buttonRings(event.buttons, handover);
  return playing(event, sinceEventS, f, paint, poles);
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
    // duet and solo (both sides; solo is symmetric): pink, brighter with each count
    const a = [0.4, 0.65, 0.95][step] * (0.7 + 0.3 * hit);
    paint('pink', a, half(side));
    if (side !== 'R') f.wash.L = { name: 'pink', a: 0.1 * a };
    if (side !== 'L') f.wash.R = { name: 'pink', a: 0.1 * a };
  }
  poles(0.75 + 0.25 * hit);
  f.buttons = { L: !!f.poles.L && hit > 0.5, R: !!f.poles.R && hit > 0.5 };
  return f;
}

function playing(e: ShowEvent, since: number, f: StageFrame, paint: Paint, poles: (b?: number) => void) {
  poles(); // the in-song glow: each side in its song-map colour for the game
  f.buttons = { L: !!f.poles.L, R: !!f.poles.R };
  if (e.game === 'showoff' && e.turn && e.turn !== 'both') {
    // a verse: the singer's side in their colour
    const name = e.turn === 'L' ? 'lime' : 'blue';
    paint(name, 0.5, half(e.turn));
    f.wash[e.turn] = { name, a: 0.16 };
    return f;
  }
  // together (every section of solo and duet, showoff choruses): the intro's pink settling to 0.28
  const songT = (e.song?.t ?? 1) + since;
  paint('pink', lerp(1, 0.28, clamp(songT / 0.7)));
  f.wash.C = { name: 'pink', a: 0.06 };
  return f;
}

/** Thunder's steal loop: the performer's half and pole in their colour, the rival's pole rising in
 * theirs (it, its half of the edge and its button ring flicker once full: steal now), a blackout on a
 * steal. The fill % is the event's; the edge drawing is illustration. */
function thunder(e: ShowEvent, since: number, f: StageFrame, paint: Paint, poles: (b?: number) => void) {
  const th = e.thunder!;
  if (th.phase === 'steal') return f; // the blackout
  const me = th.performer, rival: Side = me === 'L' ? 'R' : 'L';
  poles();
  const flick = th.phase === 'ready' ? pulseLevel(since * 1000, e.poles[rival].ms || 500) : 1;
  paint(OWN[me], 0.5, half(me));
  paint(OWN[rival], (0.08 + 0.32 * th.pct / 100) * flick, half(rival));
  f.wash[me] = { name: OWN[me], a: 0.16 };
  f.buttons = { L: true, R: true };
  const b = e.buttons;
  f.rings = {
    [me]: { name: b?.[me] ?? OWN[me], a: 1 },
    [rival]: { name: b?.[rival] ?? OWN[rival], a: flick },
  } as StageFrame['rings'];
  return f;
}
