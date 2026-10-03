import { describe, expect, it } from 'vitest';
import type { ShowEvent } from './events';
import { answerText, pressLine, showLine } from './pressMeaning';

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

  it('thunder: tag on the active pole in the window, early in the countdown, nothing on the dark pole', () => {
    const th = (phase: string) => ctx(playing({ thunder: { phase, pole: 'L', beat: 1 } } as Partial<ShowEvent>), 127);
    expect(pressLine('L', 'pressed 1×', 'start', th('window'), 'ok').text).toContain('thunder tag');
    expect(pressLine('L', 'pressed 1×', 'start', th('build'), 'ok').text).toContain('thunder early');
    expect(pressLine('R', 'pressed 1×', 'start', th('window'), 'ok').text).toContain('dark pole: nothing');
    expect(pressLine('L', 'pressed 2×', 'claps', th('window'), 'ok').text).toContain('not allowed');
  });
});

describe('showLine', () => {
  it('names the showoff turn', () => {
    expect(showLine(playing({ game: 'showoff', turn: 'L' }) as ShowEvent)).toBe("playing showoff · verse 2: left's turn (lime on that side), poles off");
  });
});
