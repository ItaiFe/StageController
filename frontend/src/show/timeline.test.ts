import { describe, expect, it } from 'vitest';
import { pct, seekTargets, segments, thunderSeek } from './timeline';
import type { SongMapInfo } from './timeline';

const sec = (start: number, end: number, label: string) => ({ start, end, label, turn: 'both' as const, color: 'pink' });
const map: SongMapInfo = {
  bpm: 100, has_markers: true, skip_cutoff_s: 115.72,
  sections: [sec(0, 66, 'intro'), sec(66, 89, 'verse'), sec(89, 104, 'instrumental'), sec(104, 126, 'verse'), sec(126, 200, 'chorus')],
};

describe('segments', () => {
  it('lays sections out as percent of the song', () => {
    const [intro, verse] = segments(map, 200);
    expect(intro).toMatchObject({ left: 0, width: 33 });
    expect(verse.left).toBe(33);
    expect(verse.width).toBeCloseTo(11.5);
  });

  it('is empty-safe without a duration', () => {
    expect(segments(map, 0).every(s => s.width === 0)).toBe(true);
    expect(pct(500, 200)).toBe(100);
  });
});

describe('seekTargets', () => {
  it('goes a few seconds before the skip cutoff, the next section and the end of verse 2', () => {
    expect(seekTargets(map, 70, 5)).toEqual([
      { label: 'Skip cutoff', to: 110.72 },
      { label: 'Next section (instrumental)', to: 84 },
      { label: 'Verse 2 end', to: 121 },
    ]);
  });

  it('has no next section at the end and never seeks before 0', () => {
    const t = seekTargets({ ...map, sections: [sec(0, 3, 'verse')], skip_cutoff_s: 2 }, 100, 5);
    expect(t).toEqual([{ label: 'Skip cutoff', to: 0 }]);
  });
});

describe('thunderSeek', () => {
  const verses = { ...map, sections: [sec(0, 10, 'verse'), sec(10, 20, 'verse'), sec(20, 30, 'chorus'), sec(30, 40, 'verse'), sec(40, 50, 'verse')] };

  it('goes 10 s before the next verse change that has a thunder window (verses 2..N-1)', () => {
    expect(thunderSeek(verses, 0)).toEqual({ label: 'Thunder window (verse 2)', to: 10 });
    expect(thunderSeek(verses, 15)).toEqual({ label: 'Thunder window (verse 3)', to: 30 });
  });

  it('wraps to the first window after the last one and is null without one', () => {
    expect(thunderSeek(verses, 45)).toEqual({ label: 'Thunder window (verse 2)', to: 10 });
    expect(thunderSeek(map, 0)).toBeNull(); // two verses: no window
  });
});
