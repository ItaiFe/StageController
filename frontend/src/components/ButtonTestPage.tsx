import { useState, useRef, useEffect, useCallback } from 'react';
import { buttonsApi } from '../api';
import { GestureDetector, gestureAction, GAP_MS, LONG_PRESS_MS } from '../buttonGesture';
import type { ButtonAction, Gesture } from '../buttonGesture';
import './ButtonTestPage.css';

interface LogEntry {
  id: number;
  time: Date;
  source: string;
  action: ButtonAction | null;
  status: 'sending' | 'ok' | 'error' | 'ignored';
  detail?: string;
}

const DIRECT_ACTIONS: { action: ButtonAction; label: string; hint: string }[] = [
  { action: 'start', label: 'Start', hint: '1 tap' },
  { action: 'claps', label: 'Claps', hint: '2 taps' },
  { action: 'special', label: 'Special', hint: '3 or 5+ taps' },
  { action: 'skip', label: 'Skip', hint: '4 taps' },
  { action: 'stop', label: 'Stop', hint: 'long press' },
];

const TAP_NAMES: Record<number, string> = { 1: 'Single tap', 2: 'Double tap', 3: 'Triple tap', 4: 'Quad tap' };
const MAX_LOG = 50;

function describeGesture(g: Gesture): string {
  if (g.kind === 'long') return 'Long press';
  return TAP_NAMES[g.count] ?? `${g.count} taps`;
}

export function ButtonTestPage() {
  const detectorRef = useRef(new GestureDetector());
  const nextIdRef = useRef(1);
  const [pendingTaps, setPendingTaps] = useState(0);
  const [holdProgress, setHoldProgress] = useState(0);
  const [pressed, setPressed] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  const updateEntry = (id: number, updates: Partial<LogEntry>) => {
    setLog(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  };

  const send = useCallback(async (source: string, action: ButtonAction | null) => {
    const id = nextIdRef.current++;
    const entry: LogEntry = { id, time: new Date(), source, action, status: action ? 'sending' : 'ignored' };
    setLog(prev => [entry, ...prev].slice(0, MAX_LOG));
    if (!action) return;

    try {
      const res = await buttonsApi.press(action);
      if (res.status === 'ignored') {
        updateEntry(id, { status: 'ignored', detail: res.reason === 'show_stopped' ? 'show stopped' : res.reason });
      } else {
        updateEntry(id, { status: 'ok' });
      }
    } catch (e) {
      updateEntry(id, { status: 'error', detail: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  // Drive the detector's timers and the on-screen feedback
  useEffect(() => {
    let frame = 0;
    const loop = () => {
      const now = performance.now();
      const detector = detectorRef.current;
      const gesture = detector.tick(now);
      if (gesture) send(describeGesture(gesture), gestureAction(gesture));
      setPendingTaps(detector.pendingTaps);
      setHoldProgress(detector.holdProgress(now));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [send]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // Keep receiving the release even if the pointer slides off the button
    e.currentTarget.setPointerCapture(e.pointerId);
    detectorRef.current.press(performance.now());
    setPressed(true);
  };

  const handlePointerUp = () => {
    detectorRef.current.release(performance.now());
    setPressed(false);
  };

  // Short presses are taps; only call it a hold once it's clearly not a tap
  const status =
    holdProgress >= 0.15 ? 'Keep holding to stop…'
    : pendingTaps > 0 ? `${pendingTaps} tap${pendingTaps > 1 ? 's' : ''}…`
    : 'Tap or hold';

  return (
    <div className="button-test-page">
      <div className="button-test-header">
        <h2>Button Test</h2>
        <p className="button-test-warning">
          Presses run the real show: music plays and devices switch, exactly like the stage button.
        </p>
      </div>

      <div className="button-test-grid">
        <section className="button-test-card virtual-button-card">
          <h3>Virtual Stage Button</h3>
          <button
            type="button"
            className={`virtual-button ${pressed ? 'pressed' : ''}`}
            style={{ '--hold': holdProgress } as React.CSSProperties}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={e => e.preventDefault()}
            aria-label="Virtual stage button"
          >
            <span className="virtual-button-status">{status}</span>
          </button>
          <ul className="gesture-legend">
            <li><b>1 tap</b> start</li>
            <li><b>2 taps</b> claps</li>
            <li><b>3 or 5+ taps</b> special</li>
            <li><b>4 taps</b> skip</li>
            <li><b>Hold {LONG_PRESS_MS / 1000}s</b> stop</li>
          </ul>
          <p className="gesture-note">
            Taps are sent {GAP_MS} ms after the last release.
          </p>
          <p className="gesture-note">
            While the show is stopped, only a single tap (start) and a long press (stop) work.
          </p>
        </section>

        <section className="button-test-card">
          <h3>Send Action Directly</h3>
          <div className="direct-actions">
            {DIRECT_ACTIONS.map(({ action, label, hint }) => (
              <button
                key={action}
                type="button"
                className={`direct-action ${action}`}
                onClick={() => send('Direct', action)}
              >
                <span className="direct-action-label">{label}</span>
                <span className="direct-action-hint">{hint}</span>
              </button>
            ))}
          </div>

          <div className="event-log-header">
            <h3>Event Log</h3>
            {log.length > 0 && (
              <button type="button" className="clear-log" onClick={() => setLog([])}>Clear</button>
            )}
          </div>
          {log.length === 0 ? (
            <p className="event-log-empty">No presses yet</p>
          ) : (
            <ul className="event-log">
              {log.map(entry => (
                <li key={entry.id} className={`event-log-entry ${entry.status}`}>
                  <span className="event-time">{entry.time.toLocaleTimeString()}</span>
                  <span className="event-source">{entry.source}</span>
                  <span className="event-action">{entry.action ? `→ ${entry.action}` : '→ ignored'}</span>
                  <span className="event-status">
                    {entry.status === 'sending' && 'sending…'}
                    {entry.status === 'ok' && '✓'}
                    {entry.status === 'error' && `✗ ${entry.detail}`}
                    {entry.status === 'ignored' && entry.action && `ignored (${entry.detail})`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
