import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { buttonsApi, devicesApi, pillarApi, playerApi, showApi } from '../api';
import type { Device, PlayerState, ShowLogLine } from '../api';
import { GestureDetector, gestureAction } from '../buttonGesture';
import { useShowEvents } from '../hooks/useShowEvents';
import { renderSequence } from '../pillar/sequence';
import type { Sequence, Slot } from '../pillar/types';
import { CUE_BADGE_MS, cueView, paletteRgb, slotWithoutShow } from '../show/events';
import type { Rgb, ShowEvent, ShowSpec } from '../show/events';
import { answerText, buttonState, gestureText, nextTextFor, nowText, poleRole, pressLine, pressMeaning, showLine, stateText, whyText } from '../show/pressMeaning';
import type { PressContext } from '../show/pressMeaning';
import { BOTH_OFFSET_MS, playScript, scripts } from '../show/pressScripts';
import type { Script } from '../show/pressScripts';
import { SEGMENTS, stageFrame } from '../show/stageLook';
import { pct, sectionOwner, seekTargets, segments } from '../show/timeline';
import type { SongMapInfo } from '../show/timeline';
import LightRules from './LightRules';
import { StageView } from './StageView';
import './StageEmulator.css';

type Side = 'L' | 'R';
const SIDES: Side[] = ['L', 'R'];
const KEYS: Record<string, Side> = { ArrowLeft: 'L', ArrowRight: 'R' };
const KEY_LABEL: Record<Side, string> = { L: '←', R: '→' };
const FEED_SIZE = 60;
const GESTURE_TICK_MS = 20;
const SLOT_SEED = 1;
const JUMP_S = 2; // a song time change this far from the clock is a seek, skip or restart

type FeedKind = 'press' | 'show' | 'device' | 'player' | 'cue';
const CLAPS_SOUND_S = 3; // the clip is 6 s: fade out after this
// line 1 = what came in, `reply` = line 2, what the controller did (ignored = amber)
interface FeedLine { id: number; time: Date; kind: FeedKind; text: string; reply?: string; ignored?: boolean; side?: Side }
type FeedExtra = Pick<FeedLine, 'reply' | 'ignored' | 'side'>;

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
// the lower panes share one fixed-height box, one at a time, so the whole tab fits one screen
type Pane = 'feed' | 'rules' | 'log' | 'status';
const PANES: [Pane, string][] = [['feed', 'Feed'], ['rules', 'Light rules'], ['log', 'Night log'], ['status', 'Status & devices']];
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

function describeLogLine({ type, t: _t, mono: _mono, ...fields }: ShowLogLine): string {
  const rest = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  return [type, ...rest].join(' ');
}

/** The song strip: sections coloured by whose turn they are (the colours the real show would use; past
 * faded, the current one outlined), the skip cutoff, the playhead and the time (thunder has no marks: its
 * steal loop runs by the clock); click to seek, the buttons jump just before the points that change the game. */
function Timeline({ map, spec, title, time, duration, section, game }: { map: SongMapInfo; spec: ShowSpec | null; title: string; time: number; duration: number; section: string | null; game: string | null | undefined }) {
  const colour = (name: string) => {
    const rgb = spec ? paletteRgb(spec, name) : null;
    return rgb ? `rgb(${rgb.join(',')})` : undefined;
  };
  return (
    <>
      <div className="song-head">
        <span className="title">{title}{map.bpm ? ` · ${map.bpm} bpm` : ''}{game ? ` · ${game}` : ''}{map.has_markers ? '' : ' · no markers (spec fallbacks)'}</span>
        <span>{section ? `now: ${section}` : ''}</span>
        <span className="seek">
          {seekTargets(map, time, SEEK_LEAD_S).map(t => (
            <button key={t.label} type="button" onClick={() => playerApi.seek(t.to)}>{t.label} −{SEEK_LEAD_S} s</button>
          ))}
        </span>
        <span className="time">{fmt(time)} / {fmt(duration)}</span>
      </div>
      <div
        className="bar"
        onClick={e => {
          const box = e.currentTarget.getBoundingClientRect();
          playerApi.seek(((e.clientX - box.left) / box.width) * duration);
        }}
      >
        {segments(map, duration).map(s => {
          const { who, color } = sectionOwner(s, game);
          const when = time >= s.end ? 'past' : time >= s.start ? 'cur' : '';
          return (
            <div
              key={s.start}
              className={`sec ${when}`}
              style={{ left: `${s.left}%`, width: `${s.width}%`, background: colour(color) }}
              title={`${s.label} ${s.index ?? ''} · ${s.start.toFixed(1)}–${s.end.toFixed(1)} s · ${who === 'both' ? 'both' : who === 'L' ? 'left' : 'right'} (${color})`}
            >
              {s.width > 4 ? `${s.label}${who === 'both' ? '' : ` · ${who}`}` : who === 'both' ? '' : who}
            </div>
          );
        })}
        <div className="cut" style={{ left: `${pct(map.skip_cutoff_s, duration)}%` }} title={`Skip cutoff ${map.skip_cutoff_s.toFixed(2)} s`} />
        <div className="ph" style={{ left: `${pct(time, duration)}%` }} />
      </div>
    </>
  );
}

/** The banner pill: the state and a sub-label; its colour is the state's. */
function pill(e: ShowEvent | null): [string, string, string] {
  switch (e?.state ?? 'idle') {
    case 'idle': return ['IDLE', 'var(--text-muted)', 'waiting'];
    case 'launching': return ['LAUNCHING', 'var(--pink, #FF1493)', 'counting'];
    case 'intro': return ['INTRO', 'var(--pink, #FF1493)', `${e!.game} ${e!.step}`];
    case 'failing': return ['FAIL', '#fff', 'counts differ'];
  }
  const th = e!.thunder;
  if (th) return ['THUNDER', '#fff', th.phase === 'ready' ? 'steal now' : th.phase === 'steal' ? 'steal!' : `cooldown ${th.pct} %`];
  return ['PLAYING', 'var(--pink, #FF1493)', e!.game ?? ''];
}

export function StageEmulator() {
  const { connected, show, cue, handover } = useShowEvents();
  const handoverRef = useRef(handover);
  handoverRef.current = handover;
  // cues: a badge on the stage and, in this browser only (the Pi's claps come from the player), a sound
  const [badge, setBadge] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const clapsAudio = useRef<HTMLAudioElement | null>(null);
  const [spec, setSpec] = useState<ShowSpec | null>(null);
  const [player, setPlayer] = useState<PlayerState | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [feedback, setFeedback] = useState<Record<Side, { pending: number; hold: number; pressed: boolean }>>({
    L: { pending: 0, hold: 0, pressed: false },
    R: { pending: 0, hold: 0, pressed: false },
  });
  const [feed, setFeed] = useState<FeedLine[]>([]);
  const [slots, setSlots] = useState<Record<Slot, Sequence> | null>(null);
  const [songMap, setSongMap] = useState<{ songId: number; map: SongMapInfo } | null>(null);
  const [nightLog, setNightLog] = useState<ShowLogLine[]>([]);
  const [pane, setPane] = useState<Pane>('feed');

  const detectors = useRef<Record<Side, GestureDetector>>({ L: new GestureDetector(), R: new GestureDetector() });
  const pressedRef = useRef<Record<Side, boolean>>({ L: false, R: false });
  const showRef = useRef(show);
  const specRef = useRef(spec);
  const lastShowLine = useRef('');
  const playerRef = useRef(player);
  const songMapRef = useRef(songMap);
  const slotsRef = useRef(slots);
  const slotStart = useRef<{ slot: Slot | null; at: number }>({ slot: null, at: 0 });
  const devicesRef = useRef<Device[] | null>(null);

  const feedId = useRef(0);
  const addFeed = useCallback((kind: FeedKind, text: string, extra: FeedExtra = {}) => {
    const id = ++feedId.current;
    setFeed(prev => [{ id, time: new Date(), kind, text, ...extra }, ...prev].slice(0, FEED_SIZE));
    return id;
  }, []);
  useEffect(() => {
    if (!cue) return;
    const view = cueView(cue.cue);
    addFeed('cue', view.line);
    setBadge(view.badge);
    const hide = window.setTimeout(() => setBadge(null), CUE_BADGE_MS);
    let fade: number | undefined;
    if (!muted) {
      const a = (clapsAudio.current ??= new Audio('/sounds/claps.mp3'));
      a.currentTime = 0;
      a.volume = 1;
      a.play().then(() => setSoundBlocked(false), () => setSoundBlocked(true)); // autoplay needs one click first
      fade = window.setInterval(() => {
        if (a.currentTime < CLAPS_SOUND_S) return;
        a.volume = Math.max(0, a.volume - 0.1);
        if (a.volume === 0) { a.pause(); window.clearInterval(fade); }
      }, 50);
    }
    return () => { window.clearTimeout(hide); window.clearInterval(fade); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per cue, not per mute toggle
  }, [cue, addFeed]);
  useEffect(() => {
    if (!soundBlocked) return;
    const unlock = () => setSoundBlocked(false);
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, [soundBlocked]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => { specRef.current = spec; }, [spec]);
  useEffect(() => {
    if (!show) return;
    const text = showLine(show.event);
    if (text !== lastShowLine.current) addFeed('show', `show → ${stateText(show.event, null)}`, { reply: `controller: ${text}` });
    lastShowLine.current = text;
  }, [show, addFeed]);

  useEffect(() => { showRef.current = show; }, [show]);
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

  const pressCtx = useCallback((): PressContext => {
    const tun = (id: string) => specRef.current?.tunables?.find(t => t.id === id)?.value;
    const p = playerRef.current;
    const map = songMapRef.current;
    return {
      event: showRef.current?.event ?? null,
      songT: p?.current_song ? p.current_time : null,
      skipCutoffS: map && map.songId === p?.current_song?.id ? map.map.skip_cutoff_s : null,
      launchWaitMs: Math.max(Number(tun('soloWaitMs') ?? 500), Number(tun('syncWindowMs') ?? 400)),
      launchPcts: (tun('launchPcts') as number[] | undefined) ?? [33, 66, 100],
    };
  }, []);

  const send = useCallback(async (side: Side, taps: number | null, action: ReturnType<typeof gestureAction>, agoMs: number) => {
    if (!action) return;
    const ctx = pressCtx();
    // the line goes up at once; the backend's answer can take a while (claps/special wait for their sequence)
    const line = pressLine(side, gestureText(action, taps), action, ctx, taps);
    const id = addFeed('press', line.text, { reply: 'controller: …', side });
    let answer: string;
    let ignored = false;
    try {
      const res = await buttonsApi.press(action, { side, firstPressAgoMs: Math.max(0, Math.round(agoMs)), taps });
      answer = answerText(res);
      ignored = res.status === 'ignored';
      // the meaning was written for the state the emulator knew; an ignore from another state says so
      const was = ctx.event?.state ?? 'idle';
      if (res.status === 'ignored' && res.show_state && res.show_state !== was) answer += ` (the controller was ${res.show_state}, not ${was})`;
    } catch (e) {
      answer = `error: ${e instanceof Error ? e.message : e}`;
    }
    setFeed(prev => prev.map(l => (l.id === id ? { ...l, reply: `controller: ${answer}`, ignored } : l)));
  }, [addFeed, pressCtx]);

  const frame = useCallback(() => {
    const s = showRef.current;
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
      handover: handoverRef.current && { buttons: handoverRef.current.buttons, sinceS: (now - handoverRef.current.at) / 1000 },
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

  // ← = left pillar, → = right pillar, so both can be held at once (the app's arrow-key seek is off on this tab)
  useEffect(() => {
    const side = (e: KeyboardEvent) => (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.shiftKey ? undefined : KEYS[e.key]);
    const down = (e: KeyboardEvent) => { const s = side(e); if (s) { e.preventDefault(); if (!e.repeat) press(s); } };
    const up = (e: KeyboardEvent) => { const s = side(e); if (s) release(s); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [press, release]);

  // Scripted buttons: raw presses through the pillar's gesture detector, then the same send() as a click
  const clicks = (gameId: string) => spec?.games.find(g => g.id === gameId)?.start.clicks ?? 1;
  const all = scripts(Number(spec?.tunables?.find(t => t.id === 'syncWindowMs')?.value ?? 400));
  const script = (id: string) => all.find(x => x.id === id)!;
  const run = (s: Script) => {
    const t0 = performance.now();
    for (const g of playScript(s)) {
      // sent when the pillar would; if the timer runs late, the first press is still honestly that long ago
      window.setTimeout(() => send(g.side, g.gesture.kind === 'taps' ? g.gesture.count : null, gestureAction(g.gesture), performance.now() - t0 - g.firstPress), g.at);
    }
  };
  // what a script should do right now, from the current state (the backend's answer in the feed is the truth)
  const ctxNow = pressCtx();
  const sideMeaning = (side: Side, n: number | null) => pressMeaning(n === null ? 'stop' : gestureAction({ kind: 'taps', count: n })!, side, ctxNow, n).text;
  const scriptTitle = (s: Script) => {
    const counts = SIDES.map(side => ({ side, downs: s.steps.filter(x => x.side === side && x.down).length, long: s.id.endsWith('hold') && s.id.startsWith(side) }));
    const pressed = counts.filter(c => c.downs);
    const idle = (ctxNow.event?.state ?? 'idle') === 'idle';
    const [l, r] = counts.map(c => c.downs);
    const games = ['duet', 'showoff', 'thunder'];
    const now = idle && pressed.length === 2
      ? (s.id === 'L1Rlate' ? 'Solo (left); the late right press is ignored' : l === r && l <= 3 ? `${games[l - 1]} intro` : 'fail blink, back to idle')
      : pressed.map(c => `${c.side}: ${sideMeaning(c.side, c.long ? null : c.downs)}`).join(' / ');
    return `Sends ${s.sends}. Now: ${now}`;
  };
  // a plain function, not a component: this view re-renders every gesture tick, and a component made
  // here would be a new type each time, remounting the button between mousedown and mouseup (lost click)
  const scriptButton = (id: string, label?: React.ReactNode, launch = false) => {
    const em = buttonState(id, ctxNow, launch);
    return (
      <button key={id} type="button" className={em?.state} onClick={() => run(script(id))} disabled={!spec}
        title={`${scriptTitle(script(id))}${em?.why ? ` (${em.state === 'no' ? 'ignored now: ' : ''}${em.why})` : ''}`}>{label ?? script(id).label}</button>
    );
  };
  const launchButtons: [string, string, string][] = [
    ['Solo', 'L1', 'L×1'], ['Duet', `both${clicks('duet')}`, `Both×${clicks('duet')}`], ['Showoff', `both${clicks('showoff')}`, `Both×${clicks('showoff')}`],
    ['Thunder', `both${clicks('thunder')}`, `Both×${clicks('thunder')}`], ['Fail', 'L2R3', 'L×2 + R×3'], ['Late', 'L1Rlate', 'L×1 then R×1'],
  ];

  const toggleDevice = async (device: Device) => {
    const updated = await devicesApi.toggle(device.id, !device.is_on);
    setDevices(prev => prev.map(d => (d.id === device.id ? updated : d)));
  };

  const event = show?.event ?? null;
  const colourOf = (name: string | null) => {
    const c = name && spec ? paletteRgb(spec, name) : null;
    return c ? `rgb(${c.join(',')})` : undefined;
  };
  // each side's controls, drawn in the SVG by its pole
  const sideSlot = (side: Side) => {
    const role = poleRole(side, ctxNow);
    const f = feedback[side];
    return (
      <div className={`side ${side}`}>
        <h4>{side === 'L' ? 'Left' : 'Right'} pillar <span className={`role ${role.colour ? '' : 'dim'}`} style={{ '--rc': colourOf(role.colour) } as React.CSSProperties}>{role.text}</span></h4>
        <div className="hint">{f.hold >= 0.15 ? 'hold…' : f.pending > 0 ? `${f.pending} tap${f.pending > 1 ? 's' : ''}…` : <>click = 1 tap · quick clicks = N taps · hold 1.5 s = stop · key <kbd>{KEY_LABEL[side]}</kbd></>}</div>
        <div className="chips">
          {[1, 2, 3, 4, 5].map(n => scriptButton(`${side}${n}`, `×${n}`))}
          {scriptButton(`${side}hold`, 'hold')}
        </div>
        <div className="hint">pole: {role.pole}</div>
      </div>
    );
  };
  const [pillLabel, pillColour, pillSub] = pill(event);
  const next = (side: Side) => {
    const n = nextTextFor(ctxNow, side);
    return <>{n.live && <em>{n.live}</em>}{n.live && ' · '}{n.text}{n.ignored?.map(x => <span key={x}> · <s>{x}</s></span>)}</>;
  };
  const sectionName = event?.song?.section ? `${event.song.section}${event.song.section_index ? ` ${event.song.section_index}` : ''}` : null;

  return (
    <div className="stage-emulator">
      <section className="emu-card emu-now" aria-live="polite">
        <div className="pill" style={{ '--c': pillColour } as React.CSSProperties}>
          <i className={`conn ${connected ? 'on' : 'off'}`} title={connected ? 'live' : 'offline'} />{pillLabel}<small>{pillSub}</small>
        </div>
        <div className="now-text">
          <b>{nowText(ctxNow)}</b>
          <div className="why" title={whyText(ctxNow, devices)}>{whyText(ctxNow, devices)}</div>
        </div>
        <div className="next" aria-label="What the next press on each side does">
          <span className="who L">← Left next:</span><span className="what">{next('L')}</span>
          <span className="who R">→ Right next:</span><span className="what">{next('R')}</span>
        </div>
        <div className="sound">
          <button type="button" onClick={() => setMuted(m => !m)} aria-pressed={muted}
            title="The emulator's claps sound (this browser only; the stage plays its own)">{muted ? 'Sound off' : 'Sound on'}</button>
          {soundBlocked && !muted && <small className="blocked">click once to enable sound</small>}
        </div>
      </section>

      <section className="emu-card emu-stage" aria-label="Stage">
        {spec ? <StageView spec={spec} frame={frame} appliances={devices} onPress={press} onRelease={release} feedback={feedback} sideSlot={sideSlot} /> : <div className="emulator-tstage" />}
        {badge && <div className="emulator-badge" role="status">{badge}</div>}
      </section>

      <div className="emu-dock">
        <section className="emu-card emu-press" aria-label="Test presses">
          <h3 title="From idle; presses like a person would. Hover any button for what it sends and does now.">Launch a game <span>from idle</span></h3>
          <div className="grid3">
            {launchButtons.map(([label, id, sub]) => <Fragment key={label}>{scriptButton(id, <>{label}<small>{sub}</small></>, true)}</Fragment>)}
          </div>
          <h3>Both pillars <span>first presses {BOTH_OFFSET_MS} ms apart</span></h3>
          <div className="grid4">
            {[1, 2, 3].map(n => scriptButton(`both${n}`))}
            {/* Both pillar buttons at the same instant: tap counts launch duet/showoff/thunder, hold stops */}
            <button
              type="button"
              title="Press and release both pillars at the same instant, as many times as you click; hold for a long press on both"
              className={`emulator-both ${buttonState('bothlive', ctxNow)?.state ?? ''} ${feedback.L.pressed && feedback.R.pressed ? 'pressed' : ''}`}
              onPointerDown={e => { if (e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); SIDES.forEach(press); } }}
              onPointerUp={() => SIDES.forEach(release)}
              onPointerCancel={() => SIDES.forEach(release)}
              onContextMenu={e => e.preventDefault()}
            >
              Both live
            </button>
          </div>
          <h3 title="While a song plays. In thunder, 1 tap on the flickering side steals (the side chips).">In song <span>left pillar</span></h3>
          <div className="grid4">
            {scriptButton('L2', <>Claps<small>×2</small></>)}
            {scriptButton('L3', <>Special<small>×3</small></>)}
            {scriptButton('L4', <>Skip<small>×4</small></>)}
            {scriptButton('Lhold', <>Stop<small>hold</small></>)}
          </div>
        </section>

        <section className="emu-card emu-panes">
          <div className="tabs" role="tablist">
            {PANES.map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={pane === id} className={pane === id ? 'active' : ''} onClick={() => setPane(id)}>{label}</button>
            ))}
            {pane === 'feed' && feed.length > 0 && <button type="button" className="emulator-clear" title="Clear the feed" aria-label="Clear the feed" onClick={() => setFeed([])}>✕</button>}
          </div>
          <div className="emu-pane" hidden={pane !== 'feed'}>
            {feed.length === 0 ? <p className="emulator-note">Every press, and what the controller did in reply, newest first.</p> : (
              <ol className="feed" aria-label="Controller feed, newest first">
                {feed.map((l, i) => (
                  <li key={l.id} className={`feed-${l.kind} ${i === 0 ? 'new' : ''}`}>
                    <span className="t">{l.time.toLocaleTimeString()}</span>
                    {l.side && <span className={`s ${l.side}`}>{l.side}</span>}
                    {l.text}
                    {l.reply && <span className={`reply ${l.ignored ? 'ign' : ''}`}>↳ {l.reply}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="emu-pane" hidden={pane !== 'rules'}>
            <LightRules spec={spec} state={event?.state} game={event?.game} />
          </div>
          <div className="emu-pane" hidden={pane !== 'log'}>
            <ul className="emulator-log">
              {nightLog.slice().reverse().map(l => (
                <li key={`${l.mono}-${l.type}-${l.t}`}><span>{l.t.slice(11, 19)}</span>{describeLogLine(l)}</li>
              ))}
            </ul>
          </div>
          <div className="emu-pane emulator-status-pane" hidden={pane !== 'status'}>
            <dl className="emulator-status">
              <dt>State</dt><dd>{event?.state ?? 'idle'}{event?.game ? ` · ${event.game}` : ''}{event?.step ? ` · ${event.step}` : ''}</dd>
              <dt>Song</dt><dd>{player?.current_song ? `${player.current_song.title}` : '—'}</dd>
              <dt>Time</dt><dd>{player?.current_song ? `${player.current_time.toFixed(1)} / ${player.duration.toFixed(1)} s` : '—'}</dd>
              <dt>Section</dt><dd>{event?.song?.section ?? '—'}</dd>
              <dt>Thunder</dt>
              <dd>{event?.thunder ? `${event.thunder.phase} · ${event.thunder.performer} performs · ${event.thunder.pct} %` : '—'}</dd>
            </dl>
            {devices.length === 0 ? <p className="emulator-note">No devices. Run scripts/seed_emulator.py.</p> : (
              <div className="emulator-devices">
                {devices.map(d => (
                  <button key={d.id} type="button" className={d.is_on ? 'on' : ''} onClick={() => toggleDevice(d)}>{d.name}</button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="emu-card emu-song" aria-label="Song map">
        {songId !== null && songMap?.songId === songId && player ? (
          <Timeline map={songMap.map} spec={spec} title={player.current_song?.title ?? 'Song map'} game={event?.game} time={player.current_time} duration={player.duration} section={sectionName} />
        ) : (
          <>
            <div className="song-head"><span className="title">Song map</span><span className="time">–</span></div>
            <div className="song-empty">No song playing (or no analysis for it). Launch a game to see the sections, whose turn each one is and the skip cutoff.</div>
          </>
        )}
      </section>
    </div>
  );
}
