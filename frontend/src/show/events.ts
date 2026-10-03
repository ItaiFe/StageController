// Show events from the controller (docs/show-events-contract.md) and how the emulator draws them.

import { PIXEL_COUNT, blankStrip } from '../pillar/types';
import type { Slot, Strip } from '../pillar/types';

export type PoleMode = 'solid' | 'pulse' | 'blink' | 'drain' | 'off';

export interface Pole {
  pct: number;
  color: string | null;
  mode: PoleMode;
  ms: number | null;
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
  thunder: { phase: string; pole: 'L' | 'R'; beat: number } | null;
}

/** The part of the stage spec the emulator needs (GET /api/show/spec). */
export interface ShowSpec {
  palette: Record<string, { ramp: number[][] }>;
  games: { id: string; start: { buttons: number; clicks: number } }[];
}

// How the emulator draws pulse and blink when the event gives no rate (thunder's rush does: `ms`)
const PULSE_MS = 500;
const BLINK_MS = 250;

export type Rgb = [number, number, number];

/** The middle of a palette colour's ramp, like the controller's tunables.palette. */
export function paletteRgb(spec: ShowSpec, name: string | null): Rgb | null {
  const ramp = name ? spec.palette[name]?.ramp : undefined;
  return ramp ? (ramp[1] as Rgb) : null;
}

/** One pole strip for a show event's pole, `elapsedMs` after the event arrived. LED 0 is the bottom. */
export function polePixels(pole: Pole, rgb: Rgb | null, elapsedMs: number): Strip {
  const out = blankStrip();
  if (pole.mode === 'off' || !rgb) return out;

  let pct = pole.pct;
  let level = 1;
  if (pole.mode === 'drain' && pole.ms) pct *= Math.max(0, 1 - elapsedMs / pole.ms);
  if (pole.mode === 'blink') level = Math.floor(elapsedMs / BLINK_MS) % 2 === 0 ? 1 : 0;
  if (pole.mode === 'pulse') level = 0.65 + 0.35 * Math.sin((elapsedMs / (pole.ms || PULSE_MS)) * 2 * Math.PI);

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
  if (data.action !== 'show') return `button ${data.action}`;
  const e = data as unknown as ShowEvent;
  const parts: string[] = [e.state];
  if (e.game) parts.push(e.game);
  if (e.step !== null) parts.push(`step ${e.step}`);
  if (e.song?.section) parts.push(`${e.song.section} ${e.song.section_index ?? ''}`.trim());
  if (e.turn) parts.push(`turn ${e.turn}`);
  if (e.thunder) parts.push(`thunder ${e.thunder.phase} ${e.thunder.pole} beat ${e.thunder.beat}`);
  if (e.state !== 'idle') parts.push(`L ${e.poles.L.pct}% R ${e.poles.R.pct}%`);
  return parts.join(' · ');
}
