import { describe, expect, it } from 'vitest';
import type { ShowEvent } from './events';
import { answerText, buttonState, nextTextFor, nowText, pressLine, poleRole, showLine, whyText } from './pressMeaning';

const off = { pct: 0, color: null, mode: 'off' as const, ms: null };
const ctx = (event: Partial<ShowEvent> | null, songT: number | null = null) => ({
  event: event as ShowEvent | null, songT, skipCutoffS: 115.72, launchWaitMs: 500, launchPcts: [33, 66, 100],
});
const playing = (over: Partial<ShowEvent> = {}): Partial<ShowEvent> =>
  ({ state: 'playing', game: 'thunder', poles: { L: off, R: off }, song: { id: 1, section: 'verse', section_index: 2, t: 100 }, ...over } as Partial<ShowEvent>);

describe('pressLine', () => {
  it('idle: waits for the other side', () => {
    expect(pressLine('R', 'pressed 3×', 'special', ctx(null)).text)
      .toBe('Right pressed 3× while idle → launch count 3: waiting 500 ms for the left side… (alone = solo)');
  });

  it('skip after the cutoff says so', () => {
    const l = pressLine('L', 'pressed 4×', 'skip', ctx(playing(), 120));
    expect(l.text).toContain('after the mid-verse-2 cutoff (115.7 s), so no skip');
    expect(answerText({ status: 'ignored', reason: 'after_cutoff' })).toBe('ignored: after the mid-verse-2 cutoff');
    expect(l.row).toBe('skip');
  });

  it('thunder: a steal when the rival pole flickers at 100 %, too early before, nothing on the performer', () => {
    const th = (phase: string, pct: number) => ctx(playing({ thunder: { phase, performer: 'L', pct } } as Partial<ShowEvent>), 30);
    expect(pressLine('R', 'pressed 1×', 'start', th('ready', 100)).text)
      .toBe('Right pressed 1× while playing thunder at verse 2 30.0s → blue is at 100 % flickering → steal, blue performs, lime starts rising');
    expect(pressLine('R', 'pressed 1×', 'start', th('cooldown', 40)).text)
      .toContain('too early, blue is 40 % filled (steal at 100 %): ignored');
    expect(answerText({ status: 'ignored', reason: 'too_early', pct: 40 })).toBe('ignored: too early, the pole is not full yet (40 % filled)');
    expect(pressLine('L', 'pressed 1×', 'start', th('ready', 100)).text).toContain("performer's own pole does nothing");
    expect(pressLine('R', 'pressed 2×', 'claps', th('cooldown', 40)).text).toContain('claps → claps sound');
  });
});

describe('showLine', () => {
  it('names the showoff turn', () => {
    expect(showLine(playing({ game: 'showoff', turn: 'L' }) as ShowEvent)).toBe("playing showoff · verse 2: left's turn (lime on that side), poles off");
  });
});

describe('thunder banner and feed', () => {
  const ev = (phase: string, pct: number) => playing({ thunder: { phase, performer: 'R', pct } } as Partial<ShowEvent>);
  it('the Now banner and the next press say the fill % and flickering = steal now', () => {
    expect(nowText(ctx(ev('ready', 100), 42))).toBe('Playing Thunder — right performs (blue full), left lime 100 % flickering = steal now — 42.0 s');
    expect(nextTextFor(ctx(ev('cooldown', 60), 42), 'L').ignored).toContain('×1 steal (60 %, steal at 100 %)');
    expect(nextTextFor(ctx(ev('ready', 100), 42), 'L').live).toBe('×1 = STEAL now');
    expect(nextTextFor(ctx(ev('ready', 100), 42), 'R').text).toMatch(/^×1 nothing \(performing\)/);
    expect(whyText(ctx(ev('cooldown', 60), 42), [])).toContain('left pole lime 60 % rising over the cooldown');
  });
  it('the feed gets a line per quarter of the rise, then ready and the steal', () => {
    expect(showLine(ev('cooldown', 37) as ShowEvent)).toBe(showLine(ev('cooldown', 26) as ShowEvent));
    expect(showLine(ev('steal', 0) as ShowEvent)).toBe('thunder: steal: blackout and smoke, right (blue) takes the stage');
  });
});

describe('emphasis and pole roles', () => {
  const lit = (pct: number) => ({ pct, color: 'pink', mode: 'solid' as const, ms: null });
  it('idle: launches hot, in-song dim; launching: the other side\'s equal count is hot', () => {
    expect(buttonState('both2', ctx(null))?.state).toBe('hot');
    expect(buttonState('L4', ctx(null))?.state).toBe('dim');
    const launching = ctx({ state: 'launching', poles: { L: lit(66), R: off } } as Partial<ShowEvent>);
    expect(buttonState('R2', launching)).toEqual({ state: 'hot', why: 'joins with 2 → showoff' });
    expect(buttonState('R3', launching)?.state).toBe('dim');
    expect(poleRole('L', launching).text).toBe('counting 2');
  });
  it('playing: skip struck past the cutoff; thunder ×1: steal hot when ready, struck before and on the performer', () => {
    expect(buttonState('L4', ctx(playing({ thunder: null }), 120))).toEqual({ state: 'no', why: 'after the mid-verse-2 cutoff' });
    expect(buttonState('L2', ctx(playing({ thunder: null }), 30))?.state).toBe('hot');
    const th = (phase: string, pct: number) => ctx(playing({ thunder: { phase, performer: 'L', pct } } as Partial<ShowEvent>), 30);
    expect(buttonState('R1', th('ready', 100))?.state).toBe('hot');
    expect(buttonState('R1', th('cooldown', 40))).toEqual({ state: 'no', why: 'too early, the pole is not full yet (40 % filled)' });
    expect(buttonState('L1', th('ready', 100))?.state).toBe('no');
    expect(buttonState('L1', th('ready', 100), true)?.state).toBe('dim'); // the Launch Solo button
    expect(buttonState('R2', th('cooldown', 40))?.state).toBe('hot');
    expect(poleRole('R', th('ready', 100)).text).toBe('FLICKERING = STEAL NOW');
    expect(poleRole('R', th('cooldown', 40)).text).toBe('rising 40 %');
  });
  it('playing: the singer and the resting side', () => {
    const e = ctx(playing({ game: 'duet', turn: 'L', thunder: null, poles: { L: { ...lit(100), color: 'lime' }, R: off } }), 30);
    expect(poleRole('L', e)).toMatchObject({ text: 'SINGING', colour: 'lime' });
    expect(poleRole('R', e).text).toBe('resting');
    expect(whyText(e, [{ name: 'spotlights', is_on: true }])).toBe('Lights: left pole lime glow, right pole dim (Left’s turn) · perimeter pink · ON: spotlights (verse → spotlights).');
  });
});
