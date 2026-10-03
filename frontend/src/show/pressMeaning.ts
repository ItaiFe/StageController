// What a pillar press means right now, per the controller's maps (backend buttons/rules.py IDLE_TAPS /
// IN_SONG and the show director), and what the controller pushes back, in words for the emulator's feed.
// The backend's answer is the truth; the meaning only says what the press was aimed at.

import type { Pole, ShowEvent } from './events';

// rules.py IDLE_TAPS: the action a pillar sends maps back to the tap count it counted
export const IDLE_TAPS: Record<string, number> = { start: 1, claps: 2, special: 3, skip: 4 };

/** The press guide row a meaning belongs to (so the guide can light it up). */
export type GuideRow = 'idle-1' | 'idle-2' | 'idle-3' | 'idle-4' | 'claps' | 'special' | 'skip' | 'tag' | 'stop' | null;

export interface PressContext {
  event: ShowEvent | null;
  songT: number | null; // seconds into the song playing
  skipCutoffS: number | null;
  launchWaitMs: number; // max(soloWaitMs, syncWindowMs)
  launchPcts: number[];
}

const SIDE_NAME = { L: 'left', R: 'right' } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** idle / launching / intro <game> / fail blink / playing <game> at <section> <t>s */
export function stateText(event: ShowEvent | null, songT: number | null): string {
  const e = event;
  if (!e || e.state === 'idle') return 'idle';
  if (e.state === 'launching') return 'launching';
  if (e.state === 'failing') return 'fail blink';
  if (e.state === 'intro') return `${e.game} intro`;
  const section = e.song?.section ? ` at ${e.song.section}${e.song.section_index ? ` ${e.song.section_index}` : ''}` : '';
  return `playing ${e.game}${section}${songT !== null ? ` ${songT.toFixed(1)}s` : ''}`;
}

export function pressMeaning(action: string, side: 'L' | 'R', ctx: PressContext, taps?: number | null): { text: string; row: GuideRow } {
  const { event, songT, skipCutoffS } = ctx;
  const state = event?.state ?? 'idle';
  if (action === 'stop') return { text: state === 'idle' ? 'stop: everything off, stays idle' : 'stop → idle, music and appliances off', row: 'stop' };
  if (state === 'idle' || state === 'launching') {
    const n = taps ?? IDLE_TAPS[action];
    const other = side === 'L' ? 'R' : 'L';
    const otherCount = event?.state === 'launching' ? ctx.launchPcts.indexOf(event.poles[other].pct) + 1 : 0;
    const text = otherCount > 0
      ? `launch count ${n} with the ${SIDE_NAME[other]} side's ${otherCount} → ${n === otherCount && n <= 3 ? ['duet', 'showoff', 'thunder'][n - 1] : 'fail blink'} (if within the sync window)`
      : `launch count ${n}: waiting ${ctx.launchWaitMs} ms for the ${SIDE_NAME[other]} side… (alone = solo)`;
    return { text, row: `idle-${Math.min(n, 4)}` as GuideRow };
  }
  if (state !== 'playing') return { text: `nothing during the ${state === 'failing' ? 'fail blink' : 'intro'}`, row: null };

  const th = event?.thunder;
  const live = th && ['build', 'rush', 'open', 'window'].includes(th.phase);
  if (action === 'start') {
    if (live && th.pole === side) {
      return th.phase === 'build' || th.phase === 'rush'
        ? { text: 'thunder early: the pole falls, halo for the performer', row: 'tag' }
        : { text: 'thunder tag: blackout on the beat, new look, smoke', row: 'tag' };
    }
    return { text: live ? 'tap on the dark pole: nothing' : 'plain tap: nothing (only thunder tags use it)', row: 'tag' };
  }
  if (action === 'claps') {
    if (live) return th.pole === side ? { text: 'claps from the active pole: not allowed', row: 'claps' } : { text: 'claps from the dark pole → claps sequence', row: 'claps' };
    return { text: 'claps → claps sound + claps sequence', row: 'claps' };
  }
  if (action === 'special') return { text: 'special → special sequence (smoke / bubbles)', row: 'special' };
  if (action === 'skip') {
    if (songT !== null && skipCutoffS !== null && songT > skipCutoffS) {
      return { text: `skip: after the mid-verse-2 cutoff (${skipCutoffS.toFixed(1)} s), so no skip`, row: 'skip' };
    }
    return { text: 'skip → next song of the same game', row: 'skip' };
  }
  return { text: action, row: null };
}

const REASONS: Record<string, string> = {
  late_press: 'not part of this launch (one gesture per side, first presses within the sync window)',
  after_cutoff: 'after the mid-verse-2 cutoff',
  active_pole: 'the active pole may not clap',
  ordinary: 'a plain tap does nothing',
  intro: 'the intro is running',
  failing: 'the fail blink is running',
};

export function answerText(res: { status: string; reason?: string }): string {
  return res.reason ? `${res.status === 'ignored' ? 'ignored' : res.status}: ${REASONS[res.reason] ?? res.reason}` : res.status;
}

export function gestureText(action: string, taps: number | null): string {
  return action === 'stop' ? 'held' : `pressed ${taps}×`;
}

/** One feed line for a press: "Right pressed 3× while idle → <meaning> · <answer>". */
export function pressLine(side: 'L' | 'R', gesture: string, action: string, ctx: PressContext, answer: string, taps?: number | null) {
  const meaning = pressMeaning(action, side, ctx, taps);
  return { text: `${cap(SIDE_NAME[side])} ${gesture} while ${stateText(ctx.event, ctx.songT)} → ${meaning.text} · ${answer}`, row: meaning.row };
}

const pole = (side: 'L' | 'R', p: Pole) =>
  p.mode === 'off' || p.pct === 0 ? null : `${side} ${p.color ?? ''} ${p.pct}%${p.mode === 'solid' ? '' : ` ${p.mode}`}`;
const where = (side: string | null | undefined) => (side === 'L' ? 'left' : side === 'R' ? 'right' : side === 'centre' ? 'centre' : 'all round');

/** What a show event tells the stage, in words. */
export function showLine(e: ShowEvent): string {
  const poles = [pole('L', e.poles.L), pole('R', e.poles.R)].filter(Boolean).join(', ') || 'off';
  const per = e.perimeter?.look === 'blackout' ? 'blackout' : e.perimeter ? `${e.perimeter.color ?? ''} ${where(e.perimeter.side)}${e.perimeter.look === 'merge' ? ', merging' : ''}${e.perimeter.look === 'halo' ? ', halo' : ''}` : null;
  const tail = `poles ${poles}${per ? ` · perimeter ${per}` : ''}`;
  switch (e.state) {
    case 'idle': return 'idle: poles back to the pillar idle, stage breathing pink';
    case 'launching': return `launch feedback: ${tail}`;
    case 'failing': return `fail blink: ${tail}`;
    case 'intro': return `${cap(e.game ?? '')} intro ${e.step}: ${tail}`;
  }
  const section = e.song?.section ? `${e.song.section}${e.song.section_index ? ` ${e.song.section_index}` : ''}` : 'song';
  if (e.thunder) return `thunder ${section} · ${e.thunder.phase} beat ${e.thunder.beat} on the ${SIDE_NAME[e.thunder.pole]} pole: ${tail}`;
  const glow = [pole('L', e.poles.L), pole('R', e.poles.R)].filter(Boolean).join(', ') || 'off';
  if (e.turn && e.turn !== 'both') return `playing ${e.game} · ${section}: ${SIDE_NAME[e.turn]}'s turn (${e.turn === 'L' ? 'lime' : 'blue'} on that side), poles ${glow}`;
  return `playing ${e.game} · ${section}: ${e.game === 'thunder' ? 'the current look' : 'pink'} all round, poles ${glow}`;
}

const TURN = { L: "left player's turn (lime)", R: "right player's turn (blue)", both: 'both together (pink)' } as const;

/** The "Now:" banner: the state in words. */
export function nowText(ctx: PressContext): string {
  const e = ctx.event;
  const t = ctx.songT !== null ? ` — ${ctx.songT.toFixed(1)} s` : '';
  switch (e?.state ?? 'idle') {
    case 'idle': return 'Idle — waiting for a launch';
    case 'launching': return `Launching — counting presses, the game is decided ${ctx.launchWaitMs} ms after the last one`;
    case 'failing': return 'Fail blink — the counts did not match; back to idle, nothing starts';
    case 'intro': return `${cap(e!.game ?? '')} intro — ${e!.step}`;
  }
  const s = e!.song?.section ? `${e!.song.section}${e!.song.section_index ? ` ${e!.song.section_index}` : ''}` : 'no section marks';
  const th = e!.thunder;
  const extra = e!.turn ? `, ${TURN[e!.turn]}` : th ? `, thunder ${th.phase} on the ${SIDE_NAME[th.pole]} pole, beat ${th.beat}` : '';
  return `Playing ${cap(e!.game ?? '')} — ${s}${extra}${t}`;
}

/** The "Next press does:" half of the banner, for the side buttons in this state. */
export function nextText(ctx: PressContext): string {
  const state = ctx.event?.state ?? 'idle';
  if (state === 'idle') return 'one side alone (any taps) = Solo · both 1+1 = Duet · 2+2 = Showoff · 3+3 = Thunder · different counts or 4+ = fail blink';
  if (state === 'launching') return `the other side joins with its own count if its first press was within the sync window; more presses on the same side are ignored`;
  if (state === 'intro') return 'nothing until the song starts; hold = stop';
  if (state === 'failing') return 'nothing until idle';
  const skip = ctx.songT !== null && ctx.skipCutoffS !== null && ctx.songT > ctx.skipCutoffS
    ? `4 = skip (ignored now: past ${ctx.skipCutoffS.toFixed(1)} s)` : `4 = skip${ctx.skipCutoffS !== null ? ` (until ${ctx.skipCutoffS.toFixed(1)} s)` : ''}`;
  const base = `2 taps = claps · 3 = special · ${skip} · hold = stop`;
  const th = ctx.event?.thunder;
  if (th && ['build', 'rush', 'open', 'window'].includes(th.phase)) {
    const dark = th.pole === 'L' ? 'right' : 'left';
    return `${SIDE_NAME[th.pole]} (active pole) 1 tap = ${th.phase === 'build' || th.phase === 'rush' ? 'early (pole falls, halo)' : 'tag (blackout, smoke)'} · ${dark} (dark pole) 2 taps = applause · ${base}`;
  }
  return `1 tap = nothing · ${base}`;
}
