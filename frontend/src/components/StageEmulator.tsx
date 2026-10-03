import { useCallback, useEffect, useRef, useState } from 'react';
import { buttonsApi, devicesApi, pillarApi, playerApi, showApi } from '../api';
import type { Device, PlayerState } from '../api';
import { GestureDetector, gestureAction, LONG_PRESS_MS } from '../buttonGesture';
import type { Gesture } from '../buttonGesture';
import { useShowEvents } from '../hooks/useShowEvents';
import { renderSequence } from '../pillar/sequence';
import { blankStrip } from '../pillar/types';
import type { Sequence, Slot, Strip } from '../pillar/types';
import { paletteRgb, polePixels, slotWithoutShow } from '../show/events';
import type { ShowSpec } from '../show/events';
import { StripCanvas } from './pillar/StripCanvas';
import './StageEmulator.css';

type Side = 'L' | 'R';
const SIDES: Side[] = ['L', 'R'];
const KEYS: Record<string, Side> = { a: 'L', l: 'R' };
const SLOT_SEED = 1;
const DEVICE_POLL_MS = 1500;
const PLAYER_POLL_MS = 500;

function describeGesture(g: Gesture): string {
  return g.kind === 'long' ? 'long press' : `${g.count} tap${g.count === 1 ? '' : 's'}`;
}

export function StageEmulator() {
  const { connected, show, log, clearLog } = useShowEvents();
  const [spec, setSpec] = useState<ShowSpec | null>(null);
  const [slots, setSlots] = useState<Record<Slot, Sequence> | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [strips, setStrips] = useState<Record<Side, Strip>>({ L: blankStrip(), R: blankStrip() });
  const [feedback, setFeedback] = useState<Record<Side, { pending: number; hold: number; pressed: boolean }>>({
    L: { pending: 0, hold: 0, pressed: false },
    R: { pending: 0, hold: 0, pressed: false },
  });
  const [lastPress, setLastPress] = useState('');

  const detectors = useRef<Record<Side, GestureDetector>>({ L: new GestureDetector(), R: new GestureDetector() });
  const pressedRef = useRef<Record<Side, boolean>>({ L: false, R: false });
  const showRef = useRef(show);
  const specRef = useRef(spec);
  const slotsRef = useRef(slots);
  const songLoadedRef = useRef(false);

  useEffect(() => { showRef.current = show; }, [show]);
  useEffect(() => { specRef.current = spec; }, [spec]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => { songLoadedRef.current = player?.current_song != null; }, [player]);

  useEffect(() => {
    showApi.getSpec().then(setSpec).catch(e => console.error('Failed to load the stage spec:', e));
    Promise.all([pillarApi.getPlans(), pillarApi.getDefaults()])
      .then(([plans, defaults]) => {
        const merged = {} as Record<Slot, Sequence>;
        for (const slot of Object.keys(defaults) as Slot[]) merged[slot] = plans.slots[slot] ?? defaults[slot];
        setSlots(merged);
      })
      .catch(e => console.error('Failed to load the pillar slots:', e));
  }, []);

  useEffect(() => {
    const pollPlayer = () => playerApi.getState().then(setPlayer).catch(() => {});
    const pollDevices = () => devicesApi.getAll().then(setDevices).catch(() => {});
    pollPlayer();
    pollDevices();
    const timers = [window.setInterval(pollPlayer, PLAYER_POLL_MS), window.setInterval(pollDevices, DEVICE_POLL_MS)];
    return () => timers.forEach(window.clearInterval);
  }, []);

  const send = useCallback(async (side: Side, label: string, action: ReturnType<typeof gestureAction>, agoMs: number) => {
    if (!action) return;
    try {
      const res = await buttonsApi.press(action, { side, firstPressAgoMs: Math.max(0, Math.round(agoMs)) });
      setLastPress(`${side} ${label} → ${action}: ${res.status}${res.reason ? ` (${res.reason})` : ''}`);
    } catch (e) {
      setLastPress(`${side} ${label} → ${action}: ${e instanceof Error ? e.message : e}`);
    }
  }, []);

  // One frame loop: gesture timers, and what each pole shows right now
  useEffect(() => {
    let raf = 0;
    let slotStart = { slot: null as Slot | null, at: 0 };
    const frame = () => {
      const now = performance.now();
      for (const side of SIDES) {
        const d = detectors.current[side];
        const gesture = d.tick(now);
        if (gesture) send(side, describeGesture(gesture), gestureAction(gesture), now - d.firstPressAt);
      }
      setFeedback({
        L: { pending: detectors.current.L.pendingTaps, hold: detectors.current.L.holdProgress(now), pressed: pressedRef.current.L },
        R: { pending: detectors.current.R.pendingTaps, hold: detectors.current.R.holdProgress(now), pressed: pressedRef.current.R },
      });

      const current = showRef.current;
      const slot = slotWithoutShow(current?.event ?? null, songLoadedRef.current);
      if (slot) {
        if (slotStart.slot !== slot) slotStart = { slot, at: now };
        const seq = slotsRef.current?.[slot];
        const strip = seq ? renderSequence(seq, now - slotStart.at, SLOT_SEED) : blankStrip();
        setStrips({ L: strip, R: strip });
      } else if (current && specRef.current) {
        slotStart = { slot: null, at: 0 };
        const s = specRef.current;
        const elapsed = now - current.at;
        const { L, R } = current.event.poles;
        setStrips({ L: polePixels(L, paletteRgb(s, L.color), elapsed), R: polePixels(R, paletteRgb(s, R.color), elapsed) });
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [send]);

  const press = useCallback((side: Side) => {
    detectors.current[side].press(performance.now());
    pressedRef.current[side] = true;
  }, []);
  const release = useCallback((side: Side) => {
    detectors.current[side].release(performance.now());
    pressedRef.current[side] = false;
  }, []);

  // A = left pillar, L = right pillar, so both can be held at once
  useEffect(() => {
    const side = (e: KeyboardEvent) => (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey ? undefined : KEYS[e.key.toLowerCase()]);
    const down = (e: KeyboardEvent) => { const s = side(e); if (s && !e.repeat) press(s); };
    const up = (e: KeyboardEvent) => { const s = side(e); if (s) release(s); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [press, release]);

  // Macros post what a pillar would, without waiting for the tap timers
  const clicks = (gameId: string) => spec?.games.find(g => g.id === gameId)?.start.clicks ?? 1;
  const macro = (label: string, counts: Partial<Record<Side, number>>) => ({
    label,
    run: () => (Object.entries(counts) as [Side, number][]).forEach(([side, n]) =>
      send(side, `${n} tap${n === 1 ? '' : 's'}`, gestureAction({ kind: 'taps', count: n }), 0)),
  });
  const macros = [
    macro('Solo (left)', { L: clicks('solo') }),
    macro('Duet', { L: clicks('duet'), R: clicks('duet') }),
    macro('Showoff', { L: clicks('showoff'), R: clicks('showoff') }),
    macro('Thunder', { L: clicks('thunder'), R: clicks('thunder') }),
    macro('Fail (2 vs 3)', { L: 2, R: 3 }),
  ];

  const toggleDevice = async (device: Device) => {
    const updated = await devicesApi.toggle(device.id, !device.is_on);
    setDevices(prev => prev.map(d => (d.id === device.id ? updated : d)));
  };

  const event = show?.event ?? null;
  const perimeter = event?.perimeter;
  const wash = (on: boolean) => {
    const rgb = on && spec ? paletteRgb(spec, perimeter?.color ?? null) : null;
    return rgb ? `rgb(${rgb.join(',')})` : undefined;
  };
  const lit = (...sides: (string | undefined)[]) => !!perimeter?.side && sides.includes(perimeter.side);

  const pillar = (side: Side) => (
    <div className={`emulator-pillar pillar-${side}`}>
      <StripCanvas strip={strips[side]} orientation="vertical" className="emulator-pole" />
      <button
        type="button"
        className={`emulator-button ${feedback[side].pressed ? 'pressed' : ''}`}
        style={{ '--hold': feedback[side].hold } as React.CSSProperties}
        onPointerDown={e => { if (e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); press(side); } }}
        onPointerUp={() => release(side)}
        onPointerCancel={() => release(side)}
        onContextMenu={e => e.preventDefault()}
        aria-label={`${side === 'L' ? 'Left' : 'Right'} pillar button`}
      >
        {side}
        <small>{feedback[side].hold >= 0.15 ? 'hold…' : feedback[side].pending > 0 ? `${feedback[side].pending}…` : side === 'L' ? 'A' : 'L'}</small>
      </button>
    </div>
  );

  return (
    <div className="stage-emulator">
      <div className="emulator-header">
        <h2>Stage emulator</h2>
        <span className={`emulator-conn ${connected ? 'on' : 'off'}`}>{connected ? 'live' : 'offline'}</span>
        <p>Runs the real show: presses start the real song. Keys: <kbd>A</kbd> left pillar, <kbd>L</kbd> right pillar.</p>
      </div>

      <div className="emulator-stage">
        {pillar('L')}
        <svg className="emulator-tstage" viewBox="0 0 300 250" role="img" aria-label="Stage">
          <rect x="10" y="10" width="140" height="70" className="stage-part" style={{ fill: wash(lit('L', 'both')) }} />
          <rect x="150" y="10" width="140" height="70" className="stage-part" style={{ fill: wash(lit('R', 'both')) }} />
          <rect x="125" y="80" width="50" height="150" className="stage-part" style={{ fill: wash(lit('centre', 'both')) }} />
          <text x="150" y="50" textAnchor="middle" className="stage-label">stage</text>
          <text x="150" y="245" textAnchor="middle" className="stage-label">entrance</text>
        </svg>
        {pillar('R')}
      </div>

      <div className="emulator-grid">
        <section className="emulator-card">
          <h3>Launch</h3>
          <div className="emulator-macros">
            {macros.map(m => (
              <button key={m.label} type="button" onClick={m.run} disabled={!spec}>{m.label}</button>
            ))}
            <button type="button" className="stop" onClick={() => send('L', 'long press', 'stop', LONG_PRESS_MS)}>Stop</button>
          </div>
          <p className="emulator-note">{lastPress || 'Hold a pillar button to stop; tap it to launch.'}</p>
        </section>

        <section className="emulator-card">
          <h3>Status</h3>
          <dl className="emulator-status">
            <dt>State</dt><dd>{event?.state ?? 'idle'}{event?.game ? ` · ${event.game}` : ''}{event?.step ? ` · ${event.step}` : ''}</dd>
            <dt>Song</dt><dd>{player?.current_song ? `${player.current_song.title}` : '—'}</dd>
            <dt>Time</dt><dd>{player?.current_song ? `${player.current_time.toFixed(1)} / ${player.duration.toFixed(1)} s` : '—'}</dd>
            <dt>Section</dt><dd>{event?.song?.section ?? '—'}</dd>
            <dt>Thunder</dt><dd>{event?.thunder ? `${event.thunder.phase} · ${event.thunder.pole} · beat ${event.thunder.beat}` : '—'}</dd>
          </dl>
        </section>

        <section className="emulator-card">
          <h3>Appliances</h3>
          {devices.length === 0 ? <p className="emulator-note">No devices. Run scripts/seed_emulator.py.</p> : (
            <div className="emulator-devices">
              {devices.map(d => (
                <button key={d.id} type="button" className={d.is_on ? 'on' : ''} onClick={() => toggleDevice(d)}>{d.name}</button>
              ))}
            </div>
          )}
        </section>

        <section className="emulator-card">
          <div className="emulator-log-header">
            <h3>Events</h3>
            {log.length > 0 && <button type="button" onClick={clearLog}>Clear</button>}
          </div>
          <ul className="emulator-log">
            {log.map(l => (
              <li key={l.id}><span>{l.time.toLocaleTimeString()}</span>{l.text}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
