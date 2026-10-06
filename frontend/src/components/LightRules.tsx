import type { ShowSpec } from '../show/events';
import { activeRules, lightRules } from '../show/lightRules';
import './LightRules.css';

/** What every light should do in each mode; the cards for what is running now are lit. */
export default function LightRules({ spec, state, game }: { spec: ShowSpec | null; state?: string; game?: string | null }) {
  if (!spec) return null;
  const active = activeRules(state, game);
  return (
    <section className="light-rules" aria-label="Light rules per mode">
      <h3>Light rules per mode</h3>
      <div className="light-rules-grid">
        {lightRules(spec).map(rule => (
          <div key={rule.id} className={`light-rule ${active.includes(rule.id) ? 'active' : ''}`}>
            <strong>{rule.title}</strong>
            <ul>{rule.lines.map(line => <li key={line}>{line}</li>)}</ul>
          </div>
        ))}
      </div>
    </section>
  );
}
