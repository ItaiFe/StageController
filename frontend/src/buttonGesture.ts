// Browser twin of the StagePillar ESP32 gesture detector, so the test page behaves
// exactly like the physical stage button. Timings and rules follow the firmware spec
// (StagePillar docs/superpowers/specs/2026-10-02-stage-pillar-button-design.md).
// No debounce: browser pointer events don't bounce.

export type ButtonAction = 'start' | 'stop' | 'skip' | 'claps' | 'special';

export type Gesture = { kind: 'taps'; count: number } | { kind: 'long' };

/** Quiet time after a release that ends a multi-press gesture */
export const GAP_MS = 400;
/** Hold duration that emits a long press immediately, while still held */
export const LONG_PRESS_MS = 1500;

const TAP_ACTIONS: Record<number, ButtonAction> = {
  1: 'start',
  2: 'claps',
  3: 'special',
  4: 'skip',
};

/** Action sent for a gesture; 5+ taps also count as special */
export function gestureAction(gesture: Gesture): ButtonAction | null {
  if (gesture.kind === 'long') return 'stop';
  if (gesture.count > 4) return 'special';
  return TAP_ACTIONS[gesture.count] ?? null;
}

/**
 * Feed it press/release events and call tick() regularly (all times in ms).
 * A gesture is returned from tick() when it completes: a long press as soon as the
 * hold reaches LONG_PRESS_MS, taps once GAP_MS passes after the last release.
 */
export class GestureDetector {
  private count = 0;
  private pressedAt: number | null = null;
  private lastReleaseAt: number | null = null;
  private longFired = false;
  private firstPress = 0;

  /** When the first press of the latest gesture started; still valid right after tick() returns that gesture */
  get firstPressAt(): number {
    return this.firstPress;
  }

  /** Taps counted so far in the gesture being built */
  get pendingTaps(): number {
    return this.count;
  }

  get isPressed(): boolean {
    return this.pressedAt !== null;
  }

  press(now: number): null {
    if (this.pressedAt !== null) return null;
    if (this.count === 0) this.firstPress = now;
    this.pressedAt = now;
    this.longFired = false;
    return null;
  }

  release(now: number): null {
    if (this.pressedAt === null) return null;
    this.pressedAt = null;
    if (this.longFired) {
      // The long press was already emitted; its release ends the gesture silently
      this.reset();
      return null;
    }
    this.count++;
    this.lastReleaseAt = now;
    return null;
  }

  tick(now: number): Gesture | null {
    if (this.pressedAt !== null) {
      if (!this.longFired && now - this.pressedAt >= LONG_PRESS_MS) {
        // Taps earlier in the same gesture are discarded
        this.longFired = true;
        this.count = 0;
        this.lastReleaseAt = null;
        return { kind: 'long' };
      }
      return null;
    }

    if (this.lastReleaseAt !== null && now - this.lastReleaseAt >= GAP_MS) {
      const count = this.count;
      this.reset();
      return { kind: 'taps', count };
    }
    return null;
  }

  /** 0..1 progress of the current hold toward a long press (0 when not pressed) */
  holdProgress(now: number): number {
    if (this.pressedAt === null || this.longFired) return 0;
    return Math.min(1, (now - this.pressedAt) / LONG_PRESS_MS);
  }

  private reset() {
    this.count = 0;
    this.lastReleaseAt = null;
    this.longFired = false;
  }
}
