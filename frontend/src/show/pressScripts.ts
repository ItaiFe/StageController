// Deterministic press sequences for the emulator's test buttons. Each script is the raw press/release
// timeline a person would make on the pillars. It is run through the same gesture detector as a real
// click, on its own clock (a background tab's timers are throttled to 1 s and would split the taps),
// and the emulator then sends each resulting gesture when a pillar would, through the same send path.

import { GestureDetector, LONG_PRESS_MS } from '../buttonGesture';
import type { Gesture } from '../buttonGesture';

export type Side = 'L' | 'R';
export interface Step { side: Side; at: number; down: boolean }

/** A quick click: held this long, then this long until the next press (well inside GAP_MS). */
export const TAP_HOLD_MS = 60;
export const TAP_SPACE_MS = 140;
/** "Together": the right side's first press lands this long after the left's (well inside syncWindowMs). */
export const BOTH_OFFSET_MS = 30;

/** n quick taps on one side, the first press at `start`. */
export function taps(side: Side, n: number, start = 0): Step[] {
  return Array.from({ length: n }, (_, i) => {
    const down = start + i * (TAP_HOLD_MS + TAP_SPACE_MS);
    return [{ side, at: down, down: true }, { side, at: down + TAP_HOLD_MS, down: false }];
  }).flat();
}

/** A long press: held past LONG_PRESS_MS. */
export function hold(side: Side, start = 0): Step[] {
  return [{ side, at: start, down: true }, { side, at: start + LONG_PRESS_MS + 200, down: false }];
}

const sorted = (steps: Step[]) => steps.sort((a, b) => a.at - b.at);

export interface Script { id: string; label: string; sends: string; steps: Step[] }

/** Every scripted button. `syncWindowMs` places the late press of the solo-late script just outside it. */
export function scripts(syncWindowMs = 400): Script[] {
  const out: Script[] = [];
  for (const side of ['L', 'R'] as Side[]) {
    for (let n = 1; n <= 5; n++) out.push({ id: `${side}${n}`, label: `${side} ×${n}`, sends: `${n} quick tap${n > 1 ? 's' : ''} on the ${side === 'L' ? 'left' : 'right'} pillar`, steps: taps(side, n) });
    out.push({ id: `${side}hold`, label: `${side} hold`, sends: `the ${side === 'L' ? 'left' : 'right'} pillar held ${(LONG_PRESS_MS + 200) / 1000} s (long press)`, steps: hold(side) });
  }
  for (let n = 1; n <= 3; n++) {
    out.push({ id: `both${n}`, label: `Both ×${n}`, sends: `${n}+${n} taps, first presses ${BOTH_OFFSET_MS} ms apart`, steps: sorted([...taps('L', n), ...taps('R', n, BOTH_OFFSET_MS)]) });
  }
  out.push({ id: 'L2R3', label: 'L×2 + R×3', sends: `2 taps left + 3 taps right, first presses ${BOTH_OFFSET_MS} ms apart`, steps: sorted([...taps('L', 2), ...taps('R', 3, BOTH_OFFSET_MS)]) });
  // late, but early enough that the right gesture still arrives before the launch decision
  const late = syncWindowMs + 50;
  out.push({ id: 'L1Rlate', label: 'L×1 then R×1 late', sends: `1 tap left, then 1 tap right ${late} ms later (outside the ${syncWindowMs} ms sync window)`, steps: sorted([...taps('L', 1), ...taps('R', 1, late)]) });
  return out;
}

export interface Sent { side: Side; gesture: Gesture; at: number; firstPress: number }

/** The gestures a script makes, with when each is sent (ms after the script starts) and its first press. */
export function playScript(s: Script, tickMs = 5): Sent[] {
  const d = { L: new GestureDetector(), R: new GestureDetector() };
  const steps = [...s.steps];
  const out: Sent[] = [];
  const end = Math.max(...steps.map(x => x.at)) + LONG_PRESS_MS + 1000;
  for (let now = 0; now <= end; now += tickMs) {
    while (steps.length && steps[0].at <= now) {
      const st = steps.shift()!;
      if (st.down) d[st.side].press(st.at); else d[st.side].release(st.at);
    }
    for (const side of ['L', 'R'] as Side[]) {
      const gesture = d[side].tick(now);
      if (gesture) out.push({ side, gesture, at: now, firstPress: d[side].firstPressAt });
    }
  }
  return out;
}
