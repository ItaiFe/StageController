// Show tunables panel helpers (GET /api/show/tunables).

export interface Tunable {
  id: string;
  value: number | number[];
  default: number | number[];
  unit: string;
  group: string;
  he: string;
  mandatory: boolean;
}

export const MAIN_GROUP = 'Main';

/** "400" -> 400, "33, 66, 100" -> [33, 66, 100]; null when it is not numbers (or the wrong count for a list). */
export function parseTunable(text: string, like: number | number[]): number | number[] | null {
  const parts = text.split(',').map(p => p.trim());
  if (parts.some(p => p === '' || !Number.isFinite(Number(p)))) return null;
  const nums = parts.map(Number);
  if (Array.isArray(like)) return nums.length === like.length ? nums : null;
  return nums.length === 1 ? nums[0] : null;
}

export function formatTunable(value: number | number[]): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export const isDefault = (t: Tunable) => formatTunable(t.value) === formatTunable(t.default);

/** The mandatory tunables first as one group, then the rest grouped in the spec's order. */
export function groupTunables(rows: Tunable[]): { title: string; rows: Tunable[] }[] {
  const groups: { title: string; rows: Tunable[] }[] = [{ title: MAIN_GROUP, rows: rows.filter(r => r.mandatory) }];
  for (const row of rows.filter(r => !r.mandatory)) {
    let group = groups.find(g => g.title === row.group);
    if (!group) groups.push((group = { title: row.group, rows: [] }));
    group.rows.push(row);
  }
  return groups.filter(g => g.rows.length > 0);
}
