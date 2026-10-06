import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { paletteRgb } from '../show/events';
import type { Rgb, ShowSpec } from '../show/events';
import { drift, LEDS, OFF, POLE_X, SEGMENTS, TPATH } from '../show/stageLook';
import type { Side, StageFrame, Wash } from '../show/stageLook';

const SEG_OFF = '#3a2a35'; // unlit segment: visible against the dark stage
const css = (c: Rgb) => `rgb(${Math.min(255, c[0]) | 0},${Math.min(255, c[1]) | 0},${Math.min(255, c[2]) | 0})`;
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const SIDES: Side[] = ['L', 'R'];
const WASH_BOX: Record<Wash, [number, number]> = { L: [0, 360], R: [360, 360], C: [290, 140] };

// Where each appliance (spec stage.appliances, by device name) sits on the drawing, and its label slot
// in a lane around the T (top lane, side gutters, the audience strip): no label crosses another or the LEDs.
type Kind = 'bar' | 'head' | 'spot' | 'flood' | 'lamp' | 'smoke' | 'bubbles';
type Slot = [number, number, 'start' | 'middle' | 'end'];
const APPLIANCES: Record<string, { label: string; kind: Kind; at: [number, number][]; lab: Slot[] }> = {
  backLights: { label: 'back lights', kind: 'bar', at: [[360, 44]], lab: [[360, -22, 'middle']] },
  movingLights: { label: 'moving lights', kind: 'head', at: [[190, 80], [530, 80]], lab: [[190, -22, 'middle'], [530, -22, 'middle']] },
  spotlights: { label: 'spotlights', kind: 'spot', at: [[360, 104]], lab: [[378, 108, 'start']] },
  'floodLights (x2)': { label: 'floodlight', kind: 'flood', at: [[84, 70], [636, 70]], lab: [[22, 74, 'end'], [698, 74, 'start']] },
  flickers: { label: 'flickers', kind: 'lamp', at: [[84, 150], [636, 150]], lab: [[22, 154, 'end'], [698, 154, 'start']] },
  smoke: { label: 'smoke', kind: 'smoke', at: [[250, 170]], lab: [[250, 226, 'middle']] },
  bubbles: { label: 'bubbles', kind: 'bubbles', at: [[470, 170]], lab: [[470, 226, 'middle']] },
};

function Fixture({ kind, x, y }: { kind: Kind; x: number; y: number }) {
  switch (kind) {
    case 'bar': return <><rect className="beam" x={x - 230} y={y} width={460} height={120} /><rect className="fx" x={x - 230} y={y - 4} width={460} height={8} rx={4} /></>;
    case 'head': return <><path className="beam" d={`M${x - 8} ${y}L${x - 60} ${y + 110}H${x + 40}Z`} /><rect className="fx" x={x - 11} y={y - 9} width={22} height={18} rx={4} /></>;
    case 'spot': return <><path className="beam" d={`M${x - 6} ${y}L${x - 40} ${y + 260}H${x + 40}L${x + 6} ${y}Z`} /><circle className="fx" cx={x} cy={y} r={9} /></>;
    case 'flood': return <><path className="beam" d={`M${x} ${y}L${x + (x < 360 ? 200 : -200)} ${y - 30}V${y + 110}Z`} /><rect className="fx" x={x - 14} y={y - 8} width={28} height={16} rx={3} /></>;
    case 'lamp': return <><circle className="beam" cx={x} cy={y} r={26} /><circle className="fx" cx={x} cy={y} r={8} /></>;
    case 'smoke': return <><circle className="beam cloud" cx={x - 14} cy={y - 18} r={24} /><circle className="beam cloud" cx={x + 12} cy={y - 26} r={28} /><rect className="fx" x={x - 13} y={y - 7} width={26} height={14} rx={3} /></>;
    case 'bubbles': return <>{[[-16, -22, 6], [6, -34, 9], [18, -16, 5]].map(([dx, dy, r]) => <circle key={dx} className="beam bubble" cx={x + dx} cy={y + dy} r={r} />)}<rect className="fx" x={x - 13} y={y - 7} width={26} height={14} rx={3} /></>;
  }
}

function Appliance({ name, on }: { name: string; on: boolean }) {
  const a = APPLIANCES[name];
  if (!a) return null;
  return (
    <g className={`appl ${on ? 'on' : ''}`} aria-label={`${name} ${on ? 'on' : 'off'}`}>
      {a.at.map(([x, y], i) => {
        const lab = a.lab[i];
        const [lx, ly, anchor] = lab ?? a.lab[0];
        return (
          <g key={i}>
            {lab && <line className="lead" x1={anchor === 'end' ? lx + 4 : anchor === 'start' && a.kind !== 'spot' ? lx - 4 : lx} y1={anchor === 'middle' ? (ly < y ? ly + 6 : ly - 16) : ly - 5} x2={x} y2={y} />}
            <Fixture kind={a.kind} x={x} y={y} />
            {lab && <text className="lane" x={lx} y={ly} textAnchor={anchor}>{a.label}<tspan dx={5} className="onoff">{on ? 'ON' : 'off'}</tspan></text>}
          </g>
        );
      })}
    </g>
  );
}

const LEGEND: [string, string][] = [['lime', 'left sings'], ['blue', 'right sings'], ['pink', 'both / together'], ['white', 'thunder intro · fail']];
const BTN_Y = 395, POLE_TOP = 430, SEG_H = 6.5, HOLD_LEN = 214; // 2πr for the hold ring (r 34)

export interface PillarHandlers {
  onPress: (side: Side) => void;
  onRelease: (side: Side) => void;
  feedback: Record<Side, { hold: number; pressed: boolean }>;
  sideSlot: (side: Side) => ReactNode;
}

/**
 * The T-stage of the stage spec drawing: perimeter LEDs with halos, side and centre washes, the two
 * pole gauges with their pillar buttons (press, hold ring) and each side's controls (`sideSlot`), the smoke
 * puff, the legend. `frame` is asked for a frame on every animation frame.
 */
export function StageView({ spec, frame, appliances, onPress, onRelease, feedback, sideSlot }: { spec: ShowSpec; frame: () => StageFrame; appliances: { name: string; is_on: boolean }[] } & PillarHandlers) {
  const svg = useRef<SVGSVGElement>(null);
  const frameRef = useRef(frame);
  useEffect(() => { frameRef.current = frame; }, [frame]);

  useEffect(() => {
    const root = svg.current;
    if (!root) return;
    const all = (sel: string) => Array.from(root.querySelectorAll<SVGElement>(sel));
    const leds = all('.led'), halos = all('.halo');
    const segs = Object.fromEntries(SIDES.map(s => [s, all(`.pole-${s} .seg`)]));
    const pctText = Object.fromEntries(SIDES.map(s => [s, root.querySelector<SVGTextElement>(`.pole-${s} .pct`)!]));
    const btns = Object.fromEntries(SIDES.map(s => [s, root.querySelector<SVGGElement>(`.pole-${s} .pillar-btn`)!]));
    const lamps = Object.fromEntries(SIDES.map(s => [s, root.querySelector<SVGCircleElement>(`.pole-${s} .cap`)!]));
    const washes = Object.fromEntries((['L', 'R', 'C'] as Wash[]).map(w => [w, root.querySelector<SVGRectElement>(`.wash-${w}`)!]));
    const puff = root.querySelector<SVGCircleElement>('.puff')!;
    let raf = 0;
    const draw = () => {
      const f = frameRef.current();
      const t = performance.now() / 1000;
      f.leds.forEach((l, i) => {
        leds[i].style.fill = css(l ? mix(OFF, l.c, l.a) : OFF);
        halos[i].style.fill = l ? css(l.c) : 'none';
        halos[i].style.fillOpacity = l ? (l.a * 0.4).toFixed(2) : '0';
      });
      for (const w of ['L', 'R', 'C'] as Wash[]) {
        const lit = f.wash[w];
        washes[w].style.fill = lit ? css(drift(spec, lit.name, w === 'R' ? 9 : 0, t)) : 'none';
        washes[w].style.fillOpacity = lit ? Math.min(0.4, lit.a).toFixed(3) : '0';
      }
      for (const s of SIDES) {
        const p = f.poles[s];
        const strip = f.strips?.[s];
        const n = p ? (Math.min(100, p.pct) / 100) * SEGMENTS : 0;
        segs[s].forEach((e, k) => {
          const fill = Math.min(1, Math.max(0, n - k));
          e.style.fill = strip ? css(strip[k]) : p && fill > 0 ? css(mix(OFF, drift(spec, p.name, k * 0.8, t), fill * p.a)) : SEG_OFF;
        });
        pctText[s].textContent = !p || strip || p.dim ? '' : p.sing ? 'sing' : `${Math.round(p.pct)}%`;
        pctText[s].style.fill = p?.sing ? css(drift(spec, p.name, 0, t)) : '';
        btns[s].classList.toggle('lit', f.buttons[s] && !f.rings);
        // in song: the ring in the singer's colour (dim for the side not singing), pulsing at a handover
        const ring = f.rings?.[s];
        const rc = ring ? drift(spec, ring.name, 0, t) : null;
        lamps[s].style.stroke = !f.rings ? '' : rc ? css(mix(OFF, rc, 0.25 + 0.75 * ring!.a)) : '#2a1f26';
        lamps[s].style.fill = !f.rings ? '' : rc ? css(mix(OFF, rc, 0.55 * ring!.a)) : '#0d090b';
        lamps[s].style.filter = rc && ring!.a > 0.2 ? `drop-shadow(0 0 ${(8 * ring!.a).toFixed(1)}px ${css(rc)})` : '';
      }
      puff.setAttribute('r', String(f.puff?.r ?? 30));
      puff.style.fillOpacity = f.puff ? Math.min(0.5, f.puff.a).toFixed(3) : '0';
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [spec]);

  const down = (s: Side) => (e: React.PointerEvent) => { if (e.button === 0) { e.currentTarget.setPointerCapture(e.pointerId); onPress(s); } };
  return (
    <svg ref={svg} className="emulator-tstage" viewBox="-160 -60 1040 660" role="img" aria-label="Stage">
      <defs><clipPath id="tstage-clip"><path d={TPATH} /></clipPath></defs>
      <path className="tstage-body" d={TPATH} />
      <g clipPath="url(#tstage-clip)">
        {(['L', 'R', 'C'] as Wash[]).map(w => (
          <rect key={w} className={`wash-${w}`} x={WASH_BOX[w][0]} y={0} width={WASH_BOX[w][1]} height={470} fillOpacity={0} />
        ))}
      </g>
      <text className="zone" x="360" y="290" textAnchor="middle" transform="rotate(-90 360 290)">CATWALK</text>
      <text className="zone" x="356" y="400" textAnchor="middle">entrance</text>
      <text className="zone small" x="360" y="186" textAnchor="middle">STAGE</text>
      {appliances.map(d => <Appliance key={d.name} name={d.name} on={d.is_on} />)}
      <g>{LEDS.map(([x, y], i) => <circle key={i} className="halo" cx={x} cy={y} r={9} fillOpacity={0} />)}</g>
      <g>{LEDS.map(([x, y], i) => <circle key={i} className="led" cx={x} cy={y} r={3.8} />)}</g>
      {SIDES.map(s => {
        const x = POLE_X[s];
        return (
          <g key={s} className={`pole-${s}`}>
            <rect className="pole-bg" x={x - 17} y={POLE_TOP - 4} width={34} height={SEGMENTS * SEG_H + 6} rx={5} />
            {Array.from({ length: SEGMENTS }, (_, k) => (
              <rect key={k} className="seg" x={x - 13} y={POLE_TOP + (SEGMENTS - 1 - k) * SEG_H} width={26} height={5} rx={1.5} />
            ))}
            <text className="pct" x={s === 'L' ? x - 26 : x + 26} y={470} textAnchor={s === 'L' ? 'end' : 'start'} />
            <g className={`pillar-btn ${feedback[s].pressed ? 'down' : ''}`} role="button" tabIndex={0} aria-label={`${s === 'L' ? 'Left' : 'Right'} pillar button`}
              onPointerDown={down(s)} onPointerUp={() => onRelease(s)} onPointerCancel={() => onRelease(s)} onContextMenu={e => e.preventDefault()}>
              <circle className="cap" cx={x} cy={BTN_Y} r={27} />
              <circle className="hold" cx={x} cy={BTN_Y} r={34} strokeDasharray={`${feedback[s].hold * HOLD_LEN} 999`} />
              <text x={x} y={BTN_Y + 4} textAnchor="middle">{s}</text>
              <text className="k" x={x} y={BTN_Y + 18} textAnchor="middle">{s === 'L' ? '←' : '→'}</text>
            </g>
            <foreignObject x={s === 'L' ? -150 : 552} y={395} width={318} height={200}>{sideSlot(s)}</foreignObject>
          </g>
        );
      })}
      <foreignObject x={-150} y={-58} width={290} height={60}>
        <div className="legend">
          {LEGEND.map(([name, role]) => {
            const rgb = paletteRgb(spec, name);
            return <span key={name}><i style={{ background: rgb ? `rgb(${rgb.join(',')})` : undefined }} />{role}</span>;
          })}
          <span><i className="dim" />dim = resting</span><span>dots = perimeter LEDs · lit lamp = appliance ON</span>
        </div>
      </foreignObject>
      <circle className="puff" cx={360} cy={140} r={30} fillOpacity={0} />
    </svg>
  );
}
