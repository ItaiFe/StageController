// The emulator's section timeline (GET /api/show/songmap/{id}).

export interface SongMapSection {
  start: number;
  end: number;
  label: string;
  index?: number;
  turn: 'L' | 'R' | 'both';
  color: string; // palette name
}

export interface SongMapInfo {
  bpm: number | null;
  has_markers: boolean;
  sections: SongMapSection[];
  skip_cutoff_s: number;
}

/** Position on the bar, 0-100 (percent of the song). */
export const pct = (t: number, duration: number) => (duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0);

export function segments(map: SongMapInfo, duration: number) {
  return map.sections.map(s => ({ ...s, left: pct(s.start, duration), width: pct(s.end, duration) - pct(s.start, duration) }));
}

/** Where the seek buttons go: shortly before the points that change the game. */
export function seekTargets(map: SongMapInfo, now: number, leadS: number) {
  const verse2 = map.sections.filter(s => s.label === 'verse')[1];
  const next = map.sections.find(s => s.start > now + leadS);
  const targets: { label: string; to: number }[] = [{ label: 'Skip cutoff', to: map.skip_cutoff_s - leadS }];
  if (next) targets.push({ label: `Next section (${next.label})`, to: next.start - leadS });
  if (verse2) targets.push({ label: 'Verse 2 end', to: verse2.end - leadS });
  return targets.map(t => ({ ...t, to: Math.max(0, t.to) }));
}
