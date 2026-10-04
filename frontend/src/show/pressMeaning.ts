// What a pillar press means right now, per the controller's maps (backend buttons/rules.py IDLE_TAPS /
// IN_SONG and the show director), and what the controller pushes back, in words for the emulator's feed.
// The backend's answer is the truth; the meaning only says what the press was aimed at.

import type { Pole, ShowEvent } from './events';

// rules.py IDLE_TAPS: the action a pillar sends maps back to the tap count it counted
export const IDLE_TAPS: Record<string, number> = { start: 1, claps: 2, special: 3, skip: 4 };

/** The press guide row a meaning belongs to (so the guide can light it up). */
export type GuideRow = 'idle-1' | 'idle-2' | 'idle-3' | 'idle-4' | 'claps' | 'special' | 'skip' | 'steal' | 'stop' | null;

export interface PressContext {
  event: ShowEvent | null;
  songT: number | null; // seconds into the song playing
  skipCutoffS: number | null;
  launchWaitMs: number; // max(soloWaitMs, syncWindowMs)
  launchPcts: number[];
}

const SIDE_NAME = { L: 'left', R: 'right' } as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const COLOUR = { L: 'lime', R: 'blue' } as const;
const OTHER = { L: 'R', R: 'L' } as const;
type Thunder = NonNullable<ShowEvent['thunder']>;

/** Thunder's steal loop in words: who performs and how far the rival's pole is. */
export function thunderText(th: Thunder): string {
  const rival = OTHER[th.performer];
  if (th.phase === 'steal') return `steal: blackout and smoke, ${SIDE_NAME[th.performer]} (${COLOUR[th.performer]}) takes the stage`;
  return `${SIDE_NAME[th.performer]} performs (${COLOUR[th.performer]} full), ${SIDE_NAME[rival]} ${COLOUR[rival]} ${th.pct} %${th.phase === 'ready' ? ' flickering = steal now' : ' rising'}`;
}

/** What 1 tap on `side` does in thunder now. */
function thunderTap(th: Thunder, side: 'L' | 'R'): string {
  if (side === th.performer) return `${SIDE_NAME[side]} performs: a tap on the performer's own pole does nothing`;
  if (th.phase === 'ready') return `${COLOUR[side]} is at 100 % flickering → steal, ${COLOUR[side]} performs, ${COLOUR[th.performer]} starts rising`;
  if (th.phase === 'steal') return 'a steal is landing: nothing';
  return `too early, ${COLOUR[side]} is ${th.pct} % filled (steal at 100 %): ignored`;
}

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
  if (action === 'start') return { text: th ? thunderTap(th, side) : 'plain tap: nothing (only thunder steals use it)', row: 'steal' };
  if (action === 'claps') return { text: 'claps → claps sound + claps sequence', row: 'claps' };
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
  ordinary: 'a plain tap does nothing',
  too_early: "too early, the pole is not full yet",
  performer: "the performer's own pole",
  intro: 'the intro is running',
  failing: 'the fail blink is running',
};

export function answerText(res: { status: string; reason?: string; pct?: number }): string {
  const why = res.reason ? `${REASONS[res.reason] ?? res.reason}${res.pct !== undefined ? ` (${res.pct} % filled)` : ''}` : '';
  return why ? `${res.status === 'ignored' ? 'ignored' : res.status}: ${why}` : res.status;
}

export function gestureText(action: string, taps: number | null): string {
  return action === 'stop' ? 'held' : `pressed ${taps}×`;
}

/** Line 1 of a press in the feed: "Right pressed 3× while idle → <meaning>" (the answer goes on line 2). */
export function pressLine(side: 'L' | 'R', gesture: string, action: string, ctx: PressContext, taps?: number | null) {
  const meaning = pressMeaning(action, side, ctx, taps);
  return { text: `${cap(SIDE_NAME[side])} ${gesture} while ${stateText(ctx.event, ctx.songT)} → ${meaning.text}`, row: meaning.row };
}

const pole = (side: 'L' | 'R', p: Pole) =>
  p.mode === 'off' || p.pct === 0 ? null : `${side} ${p.color ?? ''} ${p.pct}%${p.mode === 'solid' ? '' : ` ${p.mode}`}`;
const where = (side: string | null | undefined) => (side === 'L' ? 'left' : side === 'R' ? 'right' : side === 'centre' ? 'centre' : 'all round');

/** What a show event tells the stage, in words. */
export function showLine(e: ShowEvent): string {
  const poles = [pole('L', e.poles.L), pole('R', e.poles.R)].filter(Boolean).join(', ') || 'off';
  const per = e.perimeter?.look === 'blackout' ? 'blackout' : e.perimeter ? `${e.perimeter.color ?? ''} ${where(e.perimeter.side)}${e.perimeter.look === 'merge' ? ', merging' : ''}` : null;
  const tail = `poles ${poles}${per ? ` · perimeter ${per}` : ''}`;
  switch (e.state) {
    case 'idle': return 'idle: poles back to the pillar idle, stage breathing pink';
    case 'launching': return `launch feedback: ${tail}`;
    case 'failing': return `fail blink: ${tail}`;
    case 'intro': return `${cap(e.game ?? '')} intro ${e.step}: ${tail}`;
  }
  const section = e.song?.section ? `${e.song.section}${e.song.section_index ? ` ${e.song.section_index}` : ''}` : 'song';
  // the rise sends an event per percent: the feed gets a line each quarter (same text = no new line)
  if (e.thunder) return `thunder: ${thunderText({ ...e.thunder, pct: e.thunder.phase === 'cooldown' ? Math.floor(e.thunder.pct / 25) * 25 : e.thunder.pct })}`;
  const glow = [pole('L', e.poles.L), pole('R', e.poles.R)].filter(Boolean).join(', ') || 'off';
  if (e.turn && e.turn !== 'both') return `playing ${e.game} · ${section}: ${SIDE_NAME[e.turn]}'s turn (${e.turn === 'L' ? 'lime' : 'blue'} on that side), poles ${glow}`;
  return `playing ${e.game} · ${section}: pink all round, poles ${glow}`;
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
  if (th) return `Playing Thunder — ${thunderText(th)}${t}`;
  const extra = e!.turn ? `, ${TURN[e!.turn]}` : '';
  return `Playing ${cap(e!.game ?? '')} — ${s}${extra}${t}`;
}

const GAMES = ['duet', 'showoff', 'thunder'];
/** The side whose launch count is showing (its pole filled by its clicks), and that count. */
function launcher(ctx: PressContext): { side: 'L' | 'R'; n: number } | null {
  const e = ctx.event;
  if (e?.state !== 'launching') return null;
  for (const side of ['L', 'R'] as const) {
    const n = ctx.launchPcts.indexOf(e.poles[side].pct) + 1;
    if (n > 0 && e.poles[OTHER[side]].pct === 0) return { side, n };
  }
  return null;
}
const pastCutoff = (ctx: PressContext) => ctx.songT !== null && ctx.skipCutoffS !== null && ctx.songT > ctx.skipCutoffS;

/** What the next press on one side does, for the banner: `live` = the action that matters now (highlighted),
 * `ignored` = what the controller would ignore now (struck through). */
export function nextTextFor(ctx: PressContext, side: 'L' | 'R'): { text: string; live?: string; ignored?: string[] } {
  const state = ctx.event?.state ?? 'idle';
  const other = cap(SIDE_NAME[OTHER[side]]);
  if (state === 'idle') return { live: '×1 alone = Solo', text: `with ${other}: 1+1 Duet · 2+2 Showoff · 3+3 Thunder · counts differ = fail` };
  if (state === 'launching') {
    const l = launcher(ctx);
    if (!l || l.side === side) return { text: 'more presses on this side are ignored (one gesture per side)' };
    return { live: `×${l.n} = ${l.n <= 3 ? cap(GAMES[l.n - 1]) : 'fail blink'}`, text: `other counts = fail blink · decides ${ctx.launchWaitMs} ms after the last press` };
  }
  if (state === 'intro') return { text: 'nothing until the song starts · hold = stop' };
  if (state === 'failing') return { text: 'nothing until idle' };
  const ignored: string[] = [];
  const skip = pastCutoff(ctx) ? (ignored.push('×4 skip (past the cutoff)'), '') : ` · ×4 skip${ctx.skipCutoffS !== null ? ` (until ${ctx.skipCutoffS.toFixed(1)} s)` : ''}`;
  const base = `×2 claps · ×3 special${skip} · hold stop`;
  const th = ctx.event?.thunder;
  if (th && th.phase !== 'steal' && side !== th.performer) {
    if (th.phase === 'ready') return { live: '×1 = STEAL now', text: base, ignored };
    return { text: base, ignored: [`×1 steal (${th.pct} %, steal at 100 %)`, ...ignored] };
  }
  return { text: `${th && side === th.performer ? '×1 nothing (performing)' : '×1 nothing'} · ${base}`, ignored };
}

const SCENE: Record<string, string> = { chorus: 'chorus → floodlights', verse: 'verse → spotlights' };

/** The banner's "Lights:" line: why the poles, the perimeter and the appliances look the way they do. */
export function whyText(ctx: PressContext, devices: { name: string; is_on: boolean }[]): string {
  const e = ctx.event;
  const on = devices.filter(d => d.is_on).map(d => d.name);
  const rule = e?.state === 'playing' && e.song?.section ? SCENE[e.song.section] : undefined;
  const apps = on.length ? ` · ON: ${on.join(', ')}${rule ? ` (${rule})` : ''}` : ' · appliances off';
  const lights = (() => {
    switch (e?.state ?? 'idle') {
      case 'idle': return 'each pole runs the pillar’s own idle sequence · perimeter breathes pink';
      case 'launching': return `the presser’s pole fills ${ctx.launchPcts.join(' / ')} % pink, a step per click · perimeter breathes pink`;
      case 'failing': return 'poles blink white L, R, L, R, then the last one fades · no perimeter';
      case 'intro': return `${e!.game} intro ${e!.step}: ${[pole('L', e!.poles.L), pole('R', e!.poles.R)].filter(Boolean).join(', ') || 'poles off'}`;
    }
    const th = e!.thunder;
    if (th) {
      if (th.phase === 'steal') return 'steal: blackout and a smoke puff, then the roles swap';
      const r = OTHER[th.performer];
      return `${SIDE_NAME[th.performer]} pole ${COLOUR[th.performer]} full (performing) · ${SIDE_NAME[r]} pole ${COLOUR[r]} ${th.pct} % ${th.phase === 'ready' ? 'flickering = steal now' : 'rising over the cooldown'} · perimeter: the performer’s half ${COLOUR[th.performer]}`;
    }
    const t = e!.turn;
    const poles = (['L', 'R'] as const).map(s => e!.poles[s].pct > 0 ? `${SIDE_NAME[s]} pole ${e!.poles[s].color} glow` : `${SIDE_NAME[s]} pole dim`).join(', ');
    const why = t === 'L' || t === 'R' ? ` (${cap(SIDE_NAME[t])}’s turn)` : t === 'both' ? ' (together)' : '';
    const per = e!.game === 'showoff' && (t === 'L' || t === 'R') ? `${SIDE_NAME[t]} half of the perimeter ${COLOUR[t]}` : 'perimeter pink';
    return `${poles}${why} · ${per}`;
  })();
  return `Lights: ${lights}${apps}.`;
}

export type Emphasis = { state: 'hot' | 'dim' | 'no'; why?: string } | null;
const LAUNCH = ['L1', 'both1', 'both2', 'both3', 'L2R3', 'L1Rlate', 'bothlive'];

/** How a test-press button is shown now: hot = it does something that matters, dim = it does little or
 * nothing, no = the controller would ignore it (why = the reason, the backend's words). */
export function buttonState(id: string, ctx: PressContext, launch = false): Emphasis {
  const state = ctx.event?.state ?? 'idle';
  if (launch && state !== 'idle') return { state: 'dim' }; // a Launch button outside idle (its script may still do something)
  const m = /^([LR])(\d|hold)$/.exec(id);
  const side = m?.[1] as 'L' | 'R' | undefined;
  const n = m && m[2] !== 'hold' ? Number(m[2]) : null;
  const dim: Emphasis = { state: 'dim' };
  if (state === 'idle') return LAUNCH.includes(id) || (n !== null && n <= 3) ? { state: 'hot' } : dim;
  if (state === 'launching') {
    const l = launcher(ctx);
    return l && side && side !== l.side && n === l.n ? { state: 'hot', why: `joins with ${l.n} → ${l.n <= 3 ? GAMES[l.n - 1] : 'fail blink'}` } : dim;
  }
  if (state === 'intro') return m?.[2] === 'hold' ? { state: 'hot' } : dim;
  if (state === 'failing' || !m || !side) return dim;
  if (m[2] === 'hold') return { state: 'hot' };
  if (n === 4 && pastCutoff(ctx)) return { state: 'no', why: REASONS.after_cutoff };
  const th = ctx.event?.thunder;
  if (n === 1 && th && th.phase !== 'steal') {
    if (side === th.performer) return { state: 'no', why: REASONS.performer };
    return th.phase === 'ready' ? { state: 'hot', why: 'steal now' } : { state: 'no', why: `${REASONS.too_early} (${th.pct} % filled)` };
  }
  return n !== null && n >= 2 && n <= 4 ? { state: 'hot' } : dim;
}

/** The badge by a side's pole and what the pole shows, in words. `colour` = a palette name (null = muted). */
export function poleRole(side: 'L' | 'R', ctx: PressContext): { text: string; colour: string | null; pole: string } {
  const e = ctx.event;
  const p = e?.poles[side];
  const shows = p && p.pct > 0 ? `${p.color} ${p.pct} %${p.mode === 'solid' ? '' : ` ${p.mode}`}` : 'dark';
  switch (e?.state ?? 'idle') {
    case 'idle': return { text: 'pillar idle', colour: null, pole: 'the pillar’s own idle sequence' };
    case 'launching': {
      const l = launcher(ctx);
      return l?.side === side ? { text: `counting ${l.n}`, colour: 'pink', pole: shows } : { text: 'may join', colour: null, pole: shows };
    }
    case 'intro': return { text: `intro ${e!.step}`, colour: p?.color ?? null, pole: shows };
    case 'failing': return { text: 'blink', colour: 'white', pole: 'white blink' };
  }
  const th = e!.thunder;
  if (th) {
    if (th.phase === 'steal') return { text: 'steal!', colour: 'white', pole: 'blackout' };
    if (side === th.performer) return { text: 'PERFORMING', colour: COLOUR[side], pole: `${COLOUR[side]} full` };
    return th.phase === 'ready'
      ? { text: 'FLICKERING = STEAL NOW', colour: COLOUR[side], pole: `${COLOUR[side]} 100 % flickering` }
      : { text: `rising ${th.pct} %`, colour: null, pole: `${COLOUR[side]} ${th.pct} % rising` };
  }
  const t = e!.turn;
  if (t === side) return { text: e!.game === 'showoff' ? 'SHOWING OFF' : 'SINGING', colour: COLOUR[side], pole: `${COLOUR[side]} glow (this side’s turn)` };
  if (t === 'both' || (p && p.pct > 0)) return { text: 'SINGING', colour: p?.color ?? 'pink', pole: `${p?.color ?? 'pink'} glow (together)` };
  return { text: 'resting', colour: null, pole: 'dim (not this side’s turn)' };
}
