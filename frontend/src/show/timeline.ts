// The emulator's section timeline (GET /api/show/songmap/{id}).

export interface SongMapSection {
  start: number;
  end: number;
  label: string;
  index?: number;
  turn: 'L' | 'R' | 'both'; // showoff's alternation
  color: string; // palette name
  singer?: 'L' | 'R' | 'both'; // duet / thunder before a steal: a hand-tagged sidecar turn, else the alternation
  singer_color?: string;
}

/** Whose section it is and its colour, for the game running: showoff = the turn, duet and thunder =
 * the singer, solo (and no game) = everyone together, pink. */
export function sectionOwner(s: SongMapSection, game: string | null | undefined): { who: 'L' | 'R' | 'both'; color: string } {
  if (game === 'showoff') return { who: s.turn, color: s.color };
  if (game === 'duet' || game === 'thunder') return { who: s.singer ?? s.turn, color: s.singer_color ?? s.color };
  return { who: 'both', color: 'pink' };
}

export interface SongMapInfo {
  bpm: number | null;
  has_markers: boolean;
  sections: SongMapSection[];
  skip_cutoff_s: number;
  /** Where a thunder game opens its windows (backend thunder.py): countdown start, the change, window end. */
  thunder_windows: ThunderWindow[];
}

export interface ThunderWindow { section: number; start_s: number; change_s: number; end_s: number }

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

/** 10 s before the next thunder window's change; the first one again past the last. */
export function thunderSeek(map: SongMapInfo, now: number, leadS = 10) {
  const windows = map.thunder_windows ?? [];
  const next = windows.find(w => w.change_s - leadS > now) ?? windows[0];
  if (!next) return null;
  const s = map.sections[next.section - 1];
  return { label: `Thunder window ${windows.indexOf(next) + 1}/${windows.length} (end of ${s ? `${s.label}${s.index ? ` ${s.index}` : ''}` : `section ${next.section}`})`, to: Math.max(0, next.change_s - leadS) };
}
