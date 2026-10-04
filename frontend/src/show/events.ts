// Show events from the controller (docs/show-events-contract.md) and how the emulator draws them.

import { PIXEL_COUNT, blankStrip } from '../pillar/types';
import type { Slot, Strip } from '../pillar/types';

export type PoleMode = 'solid' | 'pulse' | 'blink' | 'drain' | 'glow' | 'off';

export interface Pole {
  pct: number;
  color: string | null;
  mode: PoleMode;
  ms: number | null;
  level?: number | null; // glow: brightness %, the in-song ambient below a full-brightness fill
}

export interface ShowEvent {
  action: 'show';
  timestamp: string;
  state: 'idle' | 'launching' | 'failing' | 'intro' | 'playing';
  game: string | null;
  step: number | null;
  poles: { L: Pole; R: Pole };
  perimeter: { look: string; color: string | null; side: 'L' | 'R' | 'both' | 'centre' | null } | null;
  song: { id: number; section: string | null; section_index: number | null; t: number } | null;
  turn: 'L' | 'R' | 'both' | null;
  // thunder's steal loop: who performs, the rising pole's fill (0-100 over cooldownMs), 'ready' = it
  // flickers at 100 % and a press steals, 'steal' = the short blackout after a steal
  thunder: { phase: 'cooldown' | 'ready' | 'steal'; performer: 'L' | 'R'; pct: number } | null;
  buttons?: ButtonLights | null; // playing only: the button rings
}

/** The pillar button rings in song: the singer's colour per side (null = dim); `pulses` > 0 on the
 * event at a change of singer (both pulse together over `pulse_ms`, then settle); thunder: `flicker` =
 * the side whose ring flickers with its full pole (a steal is open). */
export interface ButtonLights { L: string | null; R: string | null; pulses: number; pulse_ms: number; flicker?: 'L' | 'R' | null }

export type Ring = { name: string; a: number } | null;

/** The rings now. `handover`: the last change of singer and seconds since it; while its pulse runs,
 * both rings fade up and down together (ease in/out), a dim side in white, then they settle. */
export function buttonRings(b: ButtonLights | null | undefined, handover: { buttons: ButtonLights; sinceS: number } | null = null): { L: Ring; R: Ring } {
  if (!b) return { L: null, R: null };
  const h = handover?.buttons;
  const ms = (handover?.sinceS ?? 0) * 1000;
  if (h && h.pulses > 0 && ms < h.pulse_ms) {
    const a = 0.5 - 0.5 * Math.cos(2 * Math.PI * h.pulses * (ms / h.pulse_ms));
    return { L: { name: b.L ?? 'white', a }, R: { name: b.R ?? 'white', a } };
  }
  return { L: b.L ? { name: b.L, a: 1 } : null, R: b.R ? { name: b.R, a: 1 } : null };
}

/** The part of the stage spec the emulator needs (GET /api/show/spec). */
export interface ShowSpec {
  palette: Record<string, { ramp: number[][] }>;
  tunables?: { id: string; value: unknown }[];
  games: { id: string; start: { buttons: number; clicks: number } }[];
}

// How the emulator draws pulse and blink when the event gives no rate (thunder's flicker does: `ms`)
const PULSE_MS = 500;
const BLINK_MS = 250;

export type Rgb = [number, number, number];

/** The middle of a palette colour's ramp, like the controller's tunables.palette. */
export function paletteRgb(spec: ShowSpec, name: string | null): Rgb | null {
  const ramp = name ? spec.palette[name]?.ramp : undefined;
  return ramp ? (ramp[1] as Rgb) : null;
}

/** A full fade up and down (ease in/out), one cycle per `periodMs`: thunder's flicker. */
export const pulseLevel = (elapsedMs: number, periodMs: number) => 0.1 + 0.9 * (0.5 - 0.5 * Math.cos((elapsedMs / periodMs) * 2 * Math.PI));

/** How full and how bright a show event's pole is `elapsedMs` after the event arrived (pct 0 when off). */
export function poleState(pole: Pole, elapsedMs: number): { pct: number; level: number } {
  if (pole.mode === 'off') return { pct: 0, level: 0 };
  let pct = pole.pct;
  let level = 1;
  if (pole.mode === 'drain' && pole.ms) pct *= Math.max(0, 1 - elapsedMs / pole.ms);
  if (pole.mode === 'blink') level = Math.floor(elapsedMs / BLINK_MS) % 2 === 0 ? 1 : 0;
  if (pole.mode === 'glow') level = (pole.level ?? 35) / 100;
  if (pole.mode === 'pulse') level = pulseLevel(elapsedMs, pole.ms || PULSE_MS);
  return { pct, level };
}

/** One pole strip for a show event's pole, `elapsedMs` after the event arrived. LED 0 is the bottom. */
export function polePixels(pole: Pole, rgb: Rgb | null, elapsedMs: number): Strip {
  const out = blankStrip();
  if (pole.mode === 'off' || !rgb) return out;
  const { pct, level } = poleState(pole, elapsedMs);

  const lit = Math.round((pct / 100) * PIXEL_COUNT);
  for (let i = 0; i < lit; i++) {
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(rgb[c] * level);
  }
  return out;
}

/**
 * The real pillar plays its own slot sequences whenever the show gives it no instruction:
 * idle rainbow with nothing playing, the start comet under a plain song. Null = the event decides.
 */
export function slotWithoutShow(event: ShowEvent | null, songLoaded: boolean): Slot | null {
  if (event && event.state !== 'idle') return null;
  return songLoaded ? 'start' : 'idle';
}

/** One line for the event log. */
export function describeEvent(data: { action: string; [key: string]: unknown }): string {
  if (data.action === 'cue') return `cue ${data.cue}`;
  if (data.action !== 'show') return `button ${data.action}`;
  const e = data as unknown as ShowEvent;
  const parts: string[] = [e.state];
  if (e.game) parts.push(e.game);
  if (e.step !== null) parts.push(`step ${e.step}`);
  if (e.song?.section) parts.push(`${e.song.section} ${e.song.section_index ?? ''}`.trim());
  if (e.turn) parts.push(`turn ${e.turn}`);
  if (e.thunder) parts.push(`thunder ${e.thunder.phase} · ${e.thunder.performer} performs · ${e.thunder.pct}%`);
  if (e.state !== 'idle') parts.push(`L ${e.poles.L.pct}% R ${e.poles.R.pct}%`);
  return parts.join(' · ');
}

/** A one-off moment from the controller (backend schemas.ShowCue): the director is running it now. */
export interface ShowCue {
  action: 'cue';
  timestamp: string;
  cue: 'claps';
  side: 'L' | 'R' | null;
}

/** How long the emulator shows a cue's badge. */
export const CUE_BADGE_MS = 2000;

/** The badge and the feed line for a cue. */
export function cueView(c: ShowCue): { badge: string; line: string } {
  const who = c.side ? ` (${c.side === 'L' ? 'left' : 'right'} pillar)` : '';
  return { badge: '👏 CLAPS', line: `claps triggered${who}: 2 taps in the song → claps sequence running, applause sound` };
}
