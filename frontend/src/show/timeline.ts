// The emulator's section timeline (GET /api/show/songmap/{id}).

export interface SongMapSection {
  start: number;
  end: number;
  label: string;
  index?: number;
  turn: 'L' | 'R' | 'both'; // showoff's alternation
  color: string; // palette name
  singer?: 'L' | 'R' | 'both'; // duet: a hand-tagged sidecar turn, else the alternation
  singer_color?: string;
}

/** Whose section it is and its colour, for the game running: showoff = the turn, duet = the singer,
 * solo (and no game) = everyone together, pink; thunder = nobody's (its steal loop is time-based, not
 * per section), white. */
export function sectionOwner(s: SongMapSection, game: string | null | undefined): { who: 'L' | 'R' | 'both'; color: string } {
  if (game === 'showoff') return { who: s.turn, color: s.color };
  if (game === 'duet') return { who: s.singer ?? s.turn, color: s.singer_color ?? s.color };
  if (game === 'thunder') return { who: 'both', color: 'white' };
  return { who: 'both', color: 'pink' };
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

