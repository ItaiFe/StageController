import { describe, expect, it } from 'vitest';
import { gestureAction } from '../buttonGesture';
import { playScript, scripts } from './pressScripts';
import type { Script } from './pressScripts';

const play = (s: Script) => playScript(s).map(g => ({
  side: g.side, taps: g.gesture.kind === 'taps' ? g.gesture.count : null, action: gestureAction(g.gesture), firstPress: g.firstPress, at: g.at,
}));

const byId = (id: string) => scripts(400).find(s => s.id === id)!;

describe('press scripts', () => {
  it.each([1, 2, 3, 4, 5])('L ×%i and R ×%i send exactly that many taps as one gesture', n => {
    for (const side of ['L', 'R'] as const) {
      expect(play(byId(`${side}${n}`)).map(g => [g.side, g.taps])).toEqual([[side, n]]);
    }
  });

  it('hold sends one long press (stop)', () => {
    expect(play(byId('Lhold')).map(g => [g.side, g.action])).toEqual([['L', 'stop']]);
  });

  it.each([1, 2, 3])('Both ×%i sends N+N with first presses inside the sync window', n => {
    const sent = play(byId(`both${n}`));
    expect(sent.map(g => [g.side, g.taps]).sort()).toEqual([['L', n], ['R', n]]);
    expect(Math.abs(sent[0].firstPress - sent[1].firstPress)).toBeLessThanOrEqual(400);
  });

  it('L×2 + R×3 sends 2 and 3 together (fail)', () => {
    const sent = play(byId('L2R3'));
    expect(sent.map(g => [g.side, g.taps]).sort()).toEqual([['L', 2], ['R', 3]]);
    expect(Math.abs(sent[0].firstPress - sent[1].firstPress)).toBeLessThanOrEqual(400);
  });

  it('L×1 then R×1 late: the right first press is outside the sync window, its gesture still arrives before the decision', () => {
    const [l, r] = play(byId('L1Rlate'));
    expect([l.side, l.taps, r.side, r.taps]).toEqual(['L', 1, 'R', 1]);
    expect(r.firstPress - l.firstPress).toBeGreaterThan(400);
    // the backend decides max(soloWaitMs, syncWindowMs) = 500 ms after the left gesture arrives
    expect(r.at).toBeLessThan(l.at + 500);
  });
});
