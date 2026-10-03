import { useEffect, useRef } from 'react';
import type { Rgb, ShowSpec } from '../show/events';
import { drift, LEDS, OFF, POLE_X, SEGMENTS, TPATH } from '../show/stageLook';
import type { Side, StageFrame, Wash } from '../show/stageLook';

const SEG_OFF = '#1a1318';
const css = (c: Rgb) => `rgb(${Math.min(255, c[0]) | 0},${Math.min(255, c[1]) | 0},${Math.min(255, c[2]) | 0})`;
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const SIDES: Side[] = ['L', 'R'];
const WASH_BOX: Record<Wash, [number, number]> = { L: [0, 360], R: [360, 360], C: [290, 140] };

// Where each appliance (spec stage.appliances, by device name) sits on the drawing. The spec gives no
// positions: lights along the back of the stage, effects at the front edge where the catwalk starts.
const APPLIANCES: Record<string, { at: [number, number][]; label: string; kind: 'lamp' | 'bar' | 'smoke' | 'bubbles' }> = {
  'floodLights (x2)': { at: [[80, 60], [640, 60]], label: 'flood', kind: 'lamp' },
  spotlights: { at: [[360, 60]], label: 'spot', kind: 'lamp' },
  movingLights: { at: [[220, 60], [500, 60]], label: 'moving', kind: 'lamp' },
  backLights: { at: [[360, 36]], label: 'back lights', kind: 'bar' },
  flickers: { at: [[80, 165], [640, 165]], label: 'flicker', kind: 'lamp' },
  smoke: { at: [[250, 165]], label: 'smoke', kind: 'smoke' },
  bubbles: { at: [[470, 165]], label: 'bubbles', kind: 'bubbles' },
};

function Appliance({ name, on }: { name: string; on: boolean }) {
  const a = APPLIANCES[name];
  if (!a) return null;
  return (
    <g className={`appliance ${on ? 'on' : ''}`} aria-label={`${name} ${on ? 'on' : 'off'}`}>
      {a.at.map(([x, y], i) => (
        <g key={i}>
          {a.kind === 'bar' && <rect className="fixture" x={x - 200} y={y - 4} width={400} height={8} rx={4} />}
          {a.kind === 'lamp' && <><circle className="glow" cx={x} cy={y} r={34} /><circle className="fixture" cx={x} cy={y} r={9} /></>}
          {a.kind === 'smoke' && <><circle className="cloud" cx={x - 18} cy={y - 8} r={on ? 26 : 0} /><circle className="cloud" cx={x + 14} cy={y - 14} r={on ? 32 : 0} /><rect className="fixture" x={x - 12} y={y - 6} width={24} height={12} rx={3} /></>}
          {a.kind === 'bubbles' && <>{on && [[-20, -24, 7], [8, -34, 10], [22, -14, 6], [-4, -50, 5]].map(([dx, dy, r]) => <circle key={`${dx}`} className="bubble" cx={x + dx} cy={y + dy} r={r} />)}<rect className="fixture" x={x - 12} y={y - 6} width={24} height={12} rx={3} /></>}
          {i === 0 && <text className="appliance-label" x={x} y={a.kind === 'bar' ? y + 22 : y + 26} textAnchor="middle">{a.label}</text>}
        </g>
      ))}
    </g>
  );
}

/**
 * The T-stage of the stage spec drawing: perimeter LEDs with halos, side and centre washes, the two
 * pole gauges with their button lamps, the smoke puff. `frame` is asked for a frame on every animation frame.
 */
export function StageView({ spec, frame, appliances }: { spec: ShowSpec; frame: () => StageFrame; appliances: { name: string; is_on: boolean }[] }) {
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
    const lamps = Object.fromEntries(SIDES.map(s => [s, root.querySelector<SVGCircleElement>(`.pole-${s} .lamp`)!]));
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
        pctText[s].textContent = p && !strip ? `${Math.round(p.pct)}%` : '';
        lamps[s].classList.toggle('on', f.buttons[s]);
      }
      puff.setAttribute('r', String(f.puff?.r ?? 30));
      puff.style.fillOpacity = f.puff ? Math.min(0.5, f.puff.a).toFixed(3) : '0';
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [spec]);

  return (
    <svg ref={svg} className="emulator-tstage" viewBox="0 0 720 600" role="img" aria-label="Stage">
      <defs><clipPath id="tstage-clip"><path d={TPATH} /></clipPath></defs>
      <path className="tstage-body" d={TPATH} />
      <g clipPath="url(#tstage-clip)">
        {(['L', 'R', 'C'] as Wash[]).map(w => (
          <rect key={w} className={`wash-${w}`} x={WASH_BOX[w][0]} y={0} width={WASH_BOX[w][1]} height={470} fillOpacity={0} />
        ))}
      </g>
      {appliances.map(d => <Appliance key={d.name} name={d.name} on={d.is_on} />)}
      <text className="stage-label big" x="360" y="128" textAnchor="middle">stage</text>
      <text className="stage-label" x="360" y="290" textAnchor="middle">catwalk</text>
      <text className="stage-label" x="360" y="404" textAnchor="middle">entrance</text>
      <g>{LEDS.map(([x, y], i) => <circle key={i} className="halo" cx={x} cy={y} r={9} fillOpacity={0} />)}</g>
      <g>{LEDS.map(([x, y], i) => <circle key={i} className="led" cx={x} cy={y} r={3.7} />)}</g>
      {SIDES.map(s => (
        <g key={s} className={`pole-${s}`}>
          {Array.from({ length: SEGMENTS }, (_, k) => (
            <rect key={k} className="seg" x={POLE_X[s] - 7} y={424 + (SEGMENTS - 1 - k) * 5.5} width={14} height={4} rx={1.5} />
          ))}
          <text className="pct" x={s === 'L' ? POLE_X[s] + 12 : POLE_X[s] - 12} y={362} textAnchor={s === 'L' ? 'end' : 'start'} />
          <circle className="lamp" cx={POLE_X[s]} cy={395} r={17} />
          <text className="stage-label" x={POLE_X[s]} y={584} textAnchor="middle">{s === 'L' ? 'left' : 'right'}</text>
        </g>
      ))}
      <circle className="puff" cx={360} cy={140} r={30} fillOpacity={0} />
    </svg>
  );
}
