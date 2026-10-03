import { useCallback, useEffect, useState } from 'react';
import { showApi } from '../api';
import { MAIN_GROUP, formatTunable, groupTunables, isDefault, parseTunable } from '../show/tunables';
import type { Tunable } from '../show/tunables';
import './ShowTunables.css';

/** The lipsync games' tunables (spec values; a change applies at once and is logged). */
export function ShowTunables() {
  const [rows, setRows] = useState<Tunable[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(() => {
    showApi.getTunables().then(setRows).catch(e => console.error('Failed to load the show tunables:', e));
  }, []);
  useEffect(load, [load]);

  const save = async (row: Tunable, value: number | number[] | null) => {
    setDrafts(d => Object.fromEntries(Object.entries(d).filter(([k]) => k !== row.id)));
    if (value === null) { setError(`${row.id}: not a valid value`); return; }
    if (formatTunable(value) === formatTunable(row.value)) return;
    try {
      await showApi.setTunable(row.id, value);
      setError('');
      load();
    } catch (e) {
      setError(`${row.id}: ${e instanceof Error ? e.message : e}`);
    }
  };

  if (rows.length === 0) return null;
  return (
    <section className="stage-section show-tunables">
      <div className="section-header"><h2>Show tunables</h2></div>
      {error && <p className="tunable-error">{error}</p>}
      {groupTunables(rows).map(group => (
        <div key={group.title} className="tunable-group">
          <h3 dir={group.title === MAIN_GROUP ? 'ltr' : 'rtl'}>{group.title}</h3>
          {group.rows.map(row => (
            <div key={row.id} className="tunable-row">
              <label htmlFor={`tunable-${row.id}`}>
                <code>{row.id}</code>
                <span dir="rtl">{row.he}</span>
              </label>
              <input
                id={`tunable-${row.id}`}
                type="text"
                value={drafts[row.id] ?? formatTunable(row.value)}
                onChange={e => setDrafts(d => ({ ...d, [row.id]: e.target.value }))}
                onBlur={e => drafts[row.id] !== undefined && save(row, parseTunable(e.target.value, row.default))}
                onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <span className="tunable-unit">{row.unit}</span>
              <button type="button" disabled={isDefault(row)} onClick={() => save(row, row.default)} title={`Default ${formatTunable(row.default)}`}>
                Reset
              </button>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
