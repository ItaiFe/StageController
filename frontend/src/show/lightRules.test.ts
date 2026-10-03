import { describe, expect, it } from 'vitest';
import { activeRules, lightRules } from './lightRules';
import type { ShowSpec } from './events';

const spec: ShowSpec = {
  palette: {},
  games: [{ id: 'showoff', start: { buttons: 2, clicks: 2 } }, { id: 'thunder', start: { buttons: 2, clicks: 3 } }],
  tunables: [{ id: 'countdownBeats', value: 8 }, { id: 'launchPcts', value: [33, 66, 100] }],
};

describe('lightRules', () => {
  it('fills numbers and click counts from the spec', () => {
    const rules = lightRules(spec);
    expect(rules.find(r => r.id === 'thunder')!.title).toBe('Thunder · 3+3');
    expect(rules.find(r => r.id === 'thunder')!.lines.join(' ')).toContain('over 8 beats');
    expect(rules.find(r => r.id === 'idle')!.lines.join(' ')).toContain('33 / 66 / 100 %');
  });
});

describe('activeRules', () => {
  it('picks the card for the state', () => {
    expect(activeRules('idle', null)).toEqual(['idle']);
    expect(activeRules('launching', null)).toEqual(['idle']);
    expect(activeRules('failing', null)).toEqual(['fail']);
    expect(activeRules('intro', 'showoff')).toEqual(['showoff', 'song']);
    expect(activeRules('playing', 'thunder')).toEqual(['thunder', 'song']);
  });
});
