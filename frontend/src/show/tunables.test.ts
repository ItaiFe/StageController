import { describe, expect, it } from 'vitest';
import { formatTunable, groupTunables, isDefault, parseTunable } from './tunables';
import type { Tunable } from './tunables';

const t = (id: string, group: string, mandatory = false, value: number | number[] = 1): Tunable =>
  ({ id, group, mandatory, value, default: 1, unit: 'ms', he: '' });

describe('parseTunable', () => {
  it('reads a number or a list of the same length', () => {
    expect(parseTunable(' 250 ', 400)).toBe(250);
    expect(parseTunable('1.5', 1)).toBe(1.5);
    expect(parseTunable('10, 20,30', [1, 2, 3])).toEqual([10, 20, 30]);
  });

  it('rejects anything else', () => {
    expect(parseTunable('', 400)).toBeNull();
    expect(parseTunable('fast', 400)).toBeNull();
    expect(parseTunable('1, 2', 400)).toBeNull();
    expect(parseTunable('1, 2', [1, 2, 3])).toBeNull();
    expect(parseTunable('1,,3', [1, 2, 3])).toBeNull();
  });
});

describe('formatTunable / isDefault', () => {
  it('round-trips numbers and lists', () => {
    expect(formatTunable([33, 66, 100])).toBe('33, 66, 100');
    expect(formatTunable(400)).toBe('400');
    expect(isDefault(t('a', 'g'))).toBe(true);
    expect(isDefault(t('a', 'g', false, 2))).toBe(false);
  });
});

describe('groupTunables', () => {
  it('puts the mandatory ones first, then groups in spec order', () => {
    const rows = [t('a', 'x'), t('m1', 'x', true), t('b', 'y'), t('c', 'x'), t('m2', 'z', true)];
    expect(groupTunables(rows).map(g => [g.title, g.rows.map(r => r.id)])).toEqual([
      ['Main', ['m1', 'm2']], ['x', ['a', 'c']], ['y', ['b']],
    ]);
  });

  it('has no Main group when nothing is mandatory', () => {
    expect(groupTunables([t('a', 'x')]).map(g => g.title)).toEqual(['x']);
  });
});
