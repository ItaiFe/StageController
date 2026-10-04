import { describe, expect, it } from 'vitest';
import type { ShowEvent } from './events';
import { answerText, nextText, nowText, pressLine, showLine } from './pressMeaning';

const off = { pct: 0, color: null, mode: 'off' as const, ms: null };
const ctx = (event: Partial<ShowEvent> | null, songT: number | null = null) => ({
  event: event as ShowEvent | null, songT, skipCutoffS: 115.72, launchWaitMs: 500, launchPcts: [33, 66, 100],
});
const playing = (over: Partial<ShowEvent> = {}): Partial<ShowEvent> =>
  ({ state: 'playing', game: 'thunder', poles: { L: off, R: off }, song: { id: 1, section: 'verse', section_index: 2, t: 100 }, ...over } as Partial<ShowEvent>);

describe('pressLine', () => {
  it('idle: waits for the other side', () => {
    expect(pressLine('R', 'pressed 3×', 'special', ctx(null), 'ok').text)
      .toBe('Right pressed 3× while idle → launch count 3: waiting 500 ms for the left side… (alone = solo) · ok');
  });

  it('skip after the cutoff says so', () => {
    const l = pressLine('L', 'pressed 4×', 'skip', ctx(playing(), 120), answerText({ status: 'ignored', reason: 'after_cutoff' }));
    expect(l.text).toContain('after the mid-verse-2 cutoff (115.7 s), so no skip · ignored: after the mid-verse-2 cutoff');
    expect(l.row).toBe('skip');
  });

  it('thunder: a steal when the rival pole flickers at 100 %, too early before, nothing on the performer', () => {
    const th = (phase: string, pct: number) => ctx(playing({ thunder: { phase, performer: 'L', pct } } as Partial<ShowEvent>), 30);
    expect(pressLine('R', 'pressed 1×', 'start', th('ready', 100), 'ok').text)
      .toBe('Right pressed 1× while playing thunder at verse 2 30.0s → blue is at 100 % flickering → steal, blue performs, lime starts rising · ok');
    expect(pressLine('R', 'pressed 1×', 'start', th('cooldown', 40), answerText({ status: 'ignored', reason: 'too_early', pct: 40 })).text)
      .toContain('too early, blue is 40 % filled (steal at 100 %): ignored · ignored: too early, the pole is not full yet (40 % filled)');
    expect(pressLine('L', 'pressed 1×', 'start', th('ready', 100), 'ok').text).toContain("performer's own pole does nothing");
    expect(pressLine('R', 'pressed 2×', 'claps', th('cooldown', 40), 'ok').text).toContain('claps → claps sound');
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
    expect(nextText(ctx(ev('cooldown', 60), 42))).toMatch(/^left 1 tap = nothing yet \(60 %, steal at 100 %\) · right 1 tap = nothing \(performing\)/);
  });
  it('the feed gets a line per quarter of the rise, then ready and the steal', () => {
    expect(showLine(ev('cooldown', 37) as ShowEvent)).toBe(showLine(ev('cooldown', 26) as ShowEvent));
    expect(showLine(ev('steal', 0) as ShowEvent)).toBe('thunder: steal: blackout and smoke, right (blue) takes the stage');
  });
});
