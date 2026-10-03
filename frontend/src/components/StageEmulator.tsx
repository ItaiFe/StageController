import { useCallback, useEffect, useRef, useState } from 'react';
import { buttonsApi, devicesApi, pillarApi, playerApi, showApi } from '../api';
import type { Device, PlayerState, ShowLogLine } from '../api';
import { GestureDetector, gestureAction, LONG_PRESS_MS } from '../buttonGesture';
import { useShowEvents } from '../hooks/useShowEvents';
import { renderSequence } from '../pillar/sequence';
import type { Sequence, Slot } from '../pillar/types';
import { paletteRgb, slotWithoutShow } from '../show/events';
import type { Rgb, ShowSpec } from '../show/events';
import { answerText, gestureText, pressLine, showLine } from '../show/pressMeaning';
import type { GuideRow } from '../show/pressMeaning';
import { SEGMENTS, stageFrame } from '../show/stageLook';
import { pct, seekTargets, segments, thunderSeek } from '../show/timeline';
import type { SongMapInfo } from '../show/timeline';
import LightRules from './LightRules';
import { StageView } from './StageView';
import './StageEmulator.css';

type Side = 'L' | 'R';
const SIDES: Side[] = ['L', 'R'];
const KEYS: Record<string, Side> = { a: 'L', l: 'R' };
const FEED_SIZE = 60;
const GUIDE_LIT_MS = 1500;
const GESTURE_TICK_MS = 20;
const SLOT_SEED = 1;
const JUMP_S = 2; // a song time change this far from the clock is a seek, skip or restart

type FeedKind = 'press' | 'show' | 'device' | 'player';
interface FeedLine { id: number; time: Date; kind: FeedKind; text: string; row?: GuideRow }

/** The pillar's 100-pixel strip sampled onto the drawing's 24 pole segments, bottom first. */
function stripSegments(strip: Uint8Array): Rgb[] {
  const n = strip.length / 3;
  return Array.from({ length: SEGMENTS }, (_, k) => {
    const i = Math.floor(((k + 0.5) * n) / SEGMENTS) * 3;
    return [strip[i], strip[i + 1], strip[i + 2]] as Rgb;
  });
}
const DEVICE_POLL_MS = 500;
const PLAYER_POLL_MS = 500;
const LOG_POLL_MS = 2000;
const SEEK_LEAD_S = 5;

function describeLogLine({ type, t: _t, mono: _mono, ...fields }: ShowLogLine): string {
  const rest = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return [type, ...rest].join(' ');
}

/** Sections coloured by whose turn they are (the colours the real show would use), the skip cutoff, the playhead. */
function Timeline({ map, spec, time, duration }: { map: SongMapInfo; spec: ShowSpec | null; time: number; duration: number }) {
  const thunder = thunderSeek(map, time);
  const colour = (name: string) => {
    const rgb = spec ? paletteRgb(spec, name) : null;
    return rgb ? `rgb(${rgb.join(',')})` : undefined;
  };
  const cutoff = pct(map.skip_cutoff_s, duration);
  return (
    <section className="emulator-card emulator-timeline">
      <h3>Song map{map.bpm ? ` · ${map.bpm} bpm` : ''}{map.has_markers ? '' : ' · no markers (spec fallbacks)'}</h3>
      <div
        className="timeline-bar"
        onClick={e => {
          const box = e.currentTarget.getBoundingClientRect();
          playerApi.seek(((e.clientX - box.left) / box.width) * duration);
        }}
      >
        {segments(map, duration).map(s => (
          <div
            key={s.start}
            className="timeline-section"
            style={{ left: `${s.left}%`, width: `${s.width}%`, background: colour(s.color) }}
            title={`${s.label} ${s.index ?? ''} · ${s.start.toFixed(1)}–${s.end.toFixed(1)} s · ${s.turn}`}
          >
            {s.turn === 'both' ? '' : s.turn}
          </div>
        ))}
        <div className="timeline-cutoff" style={{ left: `${cutoff}%` }} title={`Skip cutoff ${map.skip_cutoff_s.toFixed(2)} s`} />
        <div className="timeline-playhead" style={{ left: `${pct(time, duration)}%` }} />
      </div>
      <div className="emulator-macros">
        {seekTargets(map, time, SEEK_LEAD_S).map(t => (
          <button key={t.label} type="button" onClick={() => playerApi.seek(t.to)}>{t.label} −{SEEK_LEAD_S} s</button>
        ))}
        {thunder && <button type="button" onClick={() => playerApi.seek(thunder.to)}>{thunder.label} −10 s</button>}
      </div>
    </section>
  );
}

export function StageEmulator() {
  const { connected, show } = useShowEvents();
  const [spec, setSpec] = useState<ShowSpec | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [feedback, setFeedback] = useState<Record<Side, { pending: number; hold: number; pressed: boolean }>>({
    L: { pending: 0, hold: 0, pressed: false },
    R: { pending: 0, hold: 0, pressed: false },
  });
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [slots, setSlots] = useState<Record<Slot, Sequence> | null>(null);
  const [litRow, setLitRow] = useState<{ row: GuideRow; at: number } | null>(null);
  const [songMap, setSongMap] = useState<{ songId: number; map: SongMapInfo } | null>(null);
  const [nightLog, setNightLog] = useState<ShowLogLine[]>([]);

  const detectors = useRef<Record<Side, GestureDetector>>({ L: new GestureDetector(), R: new GestureDetector() });
  const pressedRef = useRef<Record<Side, boolean>>({ L: false, R: false });
  const showRef = useRef(show);
  const specRef = useRef(spec);
  const lastShowLine = useRef('');
  const playerRef = useRef(player);
  const songMapRef = useRef(songMap);
  const lookRef = useRef(0); // thunder: tags so far this song, picks the perimeter look
  const slotsRef = useRef(slots);
  const slotStart = useRef<{ slot: Slot | null; at: number }>({ slot: null, at: 0 });
  const devicesRef = useRef<Device[] | null>(null);

  const feedId = useRef(0);
  const addFeed = useCallback((kind: FeedKind, text: string, row?: GuideRow) => {
    const id = ++feedId.current;
    setFeed(prev => [{ id, time: new Date(), kind, text, row }, ...prev].slice(0, FEED_SIZE));
    return id;
  }, []);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => { specRef.current = spec; }, [spec]);
  useEffect(() => {
    if (!show) return;
    const text = showLine(show.event);
    if (text !== lastShowLine.current) addFeed('show', text);
    lastShowLine.current = text;
  }, [show, addFeed]);

  useEffect(() => {
    const before = showRef.current?.event.thunder?.phase;
    showRef.current = show;
    if (!show || show.event.state === 'idle') lookRef.current = 0;
    else if (show.event.thunder?.phase === 'new_look' && before !== 'new_look') lookRef.current += 1;
  }, [show]);
  useEffect(() => { playerRef.current = player; }, [player]);
  useEffect(() => { songMapRef.current = songMap; }, [songMap]);

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

  // Player and appliances: polled, and every change goes into the feed (what the controller did)
  useEffect(() => {
    let last: { state: PlayerState; at: number } | null = null;
    const pollPlayer = () => playerApi.getState().then(state => {
      const now = performance.now();
      const was = last?.state;
      const song = state.current_song;
      if (was && song && (was.current_song?.id !== song.id || was.playlist_name !== state.playlist_name || !was.current_song)) {
        addFeed('player', `player: play "${song.title}" (${state.playlist_name ?? 'no'} playlist)`);
      } else if (was?.current_song && !song) {
        addFeed('player', 'player: stopped');
      } else if (was && song && last) {
        const expected = was.current_time + (state.is_playing ? (now - last.at) / 1000 : 0);
        if (Math.abs(state.current_time - expected) > JUMP_S) {
          // a skip in a one-song playlist replays the same song: it shows only as time back to 0
          addFeed('player', state.current_time < JUMP_S
            ? `player: "${song.title}" from the start (was at ${was.current_time.toFixed(1)} s)`
            : `player: jumped ${was.current_time.toFixed(1)} → ${state.current_time.toFixed(1)} s`);
        }
      }
      last = { state, at: now };
      setPlayer(state);
    }).catch(() => {});
    const pollDevices = () => devicesApi.getAll().then(list => {
      const before = devicesRef.current;
      const changed = before ? list.filter(d => before.find(b => b.id === d.id)?.is_on === !d.is_on) : [];
      if (changed.length) {
        // the director switches a section's scene in one go: "chorus → floodLights (x2) on, spotlights off"
        const e = showRef.current?.event;
        const scene = e?.state === 'playing' && e.song?.section && changed.every(d => /^(flood|spot)/i.test(d.name));
        const why = scene ? `${e.song!.section} → ` : 'appliances: ';
        addFeed('device', why + changed.map(d => `${d.name} ${d.is_on ? 'on' : 'off'}`).join(', '));
      }
      devicesRef.current = list;
      setDevices(list);
    }).catch(() => {});
    pollPlayer();
    pollDevices();
    const timers = [window.setInterval(pollPlayer, PLAYER_POLL_MS), window.setInterval(pollDevices, DEVICE_POLL_MS)];
    return () => timers.forEach(window.clearInterval);
  }, [addFeed]);

  const songId = player?.current_song?.id ?? null;
  useEffect(() => {
    if (songId === null) return;
    showApi.getSongMap(songId).then(map => setSongMap({ songId, map })).catch(() => setSongMap(null));
  }, [songId]);

  // the night log also refreshes on every show event: a background tab's timers get throttled, the socket doesn't
  const showAt = show?.at;
  useEffect(() => {
    const poll = () => showApi.getLog().then(setNightLog).catch(() => {});
    poll();
    const timer = window.setInterval(poll, LOG_POLL_MS);
    return () => window.clearInterval(timer);
  }, [showAt]);

  const send = useCallback(async (side: Side, taps: number | null, action: ReturnType<typeof gestureAction>, agoMs: number) => {
    if (!action) return;
    const p = playerRef.current;
    const map = songMapRef.current;
    const tun = (id: string) => specRef.current?.tunables?.find(t => t.id === id)?.value;
    const ctx = {
      event: showRef.current?.event ?? null,
      songT: p?.current_song ? p.current_time : null,
      skipCutoffS: map && map.songId === p?.current_song?.id ? map.map.skip_cutoff_s : null,
      launchWaitMs: Math.max(Number(tun('soloWaitMs') ?? 500), Number(tun('syncWindowMs') ?? 400)),
      launchPcts: (tun('launchPcts') as number[] | undefined) ?? [33, 66, 100],
    };
    // the line goes up at once; the backend's answer can take a while (claps/special wait for their sequence)
    const line = pressLine(side, gestureText(action, taps), action, ctx, '…');
    const id = addFeed('press', line.text, line.row);
    setLitRow({ row: line.row, at: performance.now() });
    let answer: string;
    try {
      answer = answerText(await buttonsApi.press(action, { side, firstPressAgoMs: Math.max(0, Math.round(agoMs)) }));
    } catch (e) {
      answer = `error: ${e instanceof Error ? e.message : e}`;
    }
    const text = line.text.replace(/…$/, answer);
    setFeed(prev => prev.map(l => (l.id === id ? { ...l, text } : l)));
  }, [addFeed]);

  const frame = useCallback(() => {
    const s = showRef.current;
    const bpm = songMapRef.current?.map.bpm;
    const now = performance.now();
    // no show instruction: the poles play the pillar's own slot sequence, like the real pillar
    const slot = slotWithoutShow(s?.event ?? null, playerRef.current?.current_song != null);
    if (slot !== slotStart.current.slot) slotStart.current = { slot, at: now };
    const seq = slot && slotsRef.current?.[slot];
    const strip = seq ? stripSegments(renderSequence(seq, now - slotStart.current.at, SLOT_SEED)) : null;
    const f = stageFrame(spec!, {
      event: s?.event ?? null,
      sinceEventS: s ? (performance.now() - s.at) / 1000 : 0,
      nowS: performance.now() / 1000,
      beatS: bpm ? 60 / bpm : 0.5,
      look: lookRef.current,
    });
    if (strip) f.strips = { L: strip, R: strip };
    return f;
  }, [spec]);

  // Gesture timers on a fixed tick, not animation frames: a hidden tab pauses rAF, and a hold
  // would end up as a tap
  useEffect(() => {
    const frame = () => {
      const now = performance.now();
      for (const side of SIDES) {
        const d = detectors.current[side];
        const gesture = d.tick(now);
        if (gesture) send(side, gesture.kind === 'taps' ? gesture.count : null, gestureAction(gesture), now - d.firstPressAt);
      }
      setFeedback({
        L: { pending: detectors.current.L.pendingTaps, hold: detectors.current.L.holdProgress(now), pressed: pressedRef.current.L },
        R: { pending: detectors.current.R.pendingTaps, hold: detectors.current.R.holdProgress(now), pressed: pressedRef.current.R },
      });
    };
    const timer = window.setInterval(frame, GESTURE_TICK_MS);
    return () => window.clearInterval(timer);
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
      send(side, n, gestureAction({ kind: 'taps', count: n }), 0)),
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
  const lit = (row: string) => (litRow && litRow.row === row && performance.now() - litRow.at < GUIDE_LIT_MS ? 'lit' : undefined);

  const pillar = (side: Side) => (
    <div className={`emulator-pillar pillar-${side}`}>
      {event?.thunder && <span className={`pole-role ${event.thunder.pole === side ? 'active' : ''}`}>{event.thunder.pole === side ? 'active' : 'dark'}</span>}
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
        {spec ? <StageView spec={spec} frame={frame} appliances={devices} /> : <div className="emulator-tstage" />}
        {pillar('R')}
        <aside className="press-guide" aria-label="Press guide">
          <strong>Idle</strong>
          <span className={lit('idle-1')}>1 tap · solo</span>
          <span className={lit(`idle-${clicks('duet')}`)}>both {clicks('duet')}+{clicks('duet')} · duet</span>
          <span className={lit(`idle-${clicks('showoff')}`)}>both {clicks('showoff')}+{clicks('showoff')} · showoff</span>
          <span className={lit(`idle-${clicks('thunder')}`)}>both {clicks('thunder')}+{clicks('thunder')} · thunder</span>
          <span className={lit('idle-4')}>counts differ · fail blink</span>
          <strong>In song</strong>
          <span className={lit('claps')}>2 taps · claps (thunder: dark pole)</span>
          <span className={lit('special')}>3 taps · special</span>
          <span className={lit('skip')}>4 taps · skip (until mid verse 2)</span>
          <span className={lit('tag')}>1 tap · thunder tag (active pole)</span>
          <span className={lit('stop')}>hold · stop</span>
        </aside>
      </div>

      <section className="emulator-card emulator-feed">
        <div className="emulator-log-header">
          <h3>Controller feed</h3>
          {feed.length > 0 && <button type="button" onClick={() => setFeed([])}>Clear</button>}
        </div>
        {feed.length === 0 ? <p className="emulator-note">Every press, and what the controller did in reply, newest first.</p> : (
          <ol className="emulator-log" aria-label="Controller feed, newest first">
            {feed.map(l => <li key={l.id} className={`feed-${l.kind}`}><span>{l.time.toLocaleTimeString()}</span>{l.text}</li>)}
          </ol>
        )}
      </section>

      <LightRules spec={spec} state={event?.state} game={event?.game} />

      {songId !== null && songMap?.songId === songId && player && (
        <Timeline map={songMap.map} spec={spec} time={player.current_time} duration={player.duration} />
      )}

      <div className="emulator-grid">
        <section className="emulator-card">
          <h3>Launch</h3>
          <div className="emulator-macros">
            {macros.map(m => (
              <button key={m.label} type="button" onClick={m.run} disabled={!spec}>{m.label}</button>
            ))}
            <button type="button" className="stop" onClick={() => send('L', null, 'stop', LONG_PRESS_MS)}>Stop</button>
          </div>
          {/* Both pillar buttons at the same instant: tap counts launch duet/showoff/thunder, hold stops */}
          <button
            type="button"
            className={`emulator-both ${feedback.L.pressed && feedback.R.pressed ? 'pressed' : ''}`}
            onPointerDown={e => { if (e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); SIDES.forEach(press); } }}
            onPointerUp={() => SIDES.forEach(release)}
            onPointerCancel={() => SIDES.forEach(release)}
            onContextMenu={e => e.preventDefault()}
          >
            Both pressed
          </button>
          <p className="emulator-note">N quick clicks = N taps, hold = stop.</p>
        </section>

        <section className="emulator-card">
          <h3>Status</h3>
          <dl className="emulator-status">
            <dt>State</dt><dd>{event?.state ?? 'idle'}{event?.game ? ` · ${event.game}` : ''}{event?.step ? ` · ${event.step}` : ''}</dd>
            <dt>Song</dt><dd>{player?.current_song ? `${player.current_song.title}` : '—'}</dd>
            <dt>Time</dt><dd>{player?.current_song ? `${player.current_time.toFixed(1)} / ${player.duration.toFixed(1)} s` : '—'}</dd>
            <dt>Section</dt><dd>{event?.song?.section ?? '—'}</dd>
            <dt>Thunder</dt>
            <dd className="thunder-status">
              {/* a new key per event restarts the flash: one flash per beat during countdown and window */}
              {event?.thunder && <span key={show?.at} className="beat-flash" />}
              {event?.thunder ? `${event.thunder.phase} · ${event.thunder.pole} · beat ${event.thunder.beat}` : '—'}
            </dd>
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
          <h3>Night log</h3>
          <ul className="emulator-log">
            {nightLog.slice().reverse().map(l => (
              <li key={`${l.mono}-${l.type}-${l.t}`}><span>{l.t.slice(11, 19)}</span>{describeLogLine(l)}</li>
            ))}
          </ul>
        </section>

      </div>
    </div>
  );
}
