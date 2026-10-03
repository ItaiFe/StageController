import { useEffect, useRef, useState } from 'react';
import { describeEvent } from '../show/events';
import type { ButtonLights, ShowCue, ShowEvent } from '../show/events';

const WS_URL = import.meta.env.DEV ? 'ws://localhost:8000/api/buttons/ws' : `ws://${window.location.host}/api/buttons/ws`;
const MAX_LOG = 40;

export interface LogLine {
  id: number;
  time: Date;
  text: string;
}

/** Listens on the button socket: the latest show event (and when it arrived) plus a log of everything. */
export function useShowEvents() {
  const [connected, setConnected] = useState(false);
  const [show, setShow] = useState<{ event: ShowEvent; at: number } | null>(null);
  const [cue, setCue] = useState<{ cue: ShowCue; at: number } | null>(null);
  const [handover, setHandover] = useState<{ buttons: ButtonLights; at: number } | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const nextId = useRef(1);

  useEffect(() => {
    let ws: WebSocket;
    let retry: number | undefined;
    let closed = false;

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setConnected(true);
      ws.onmessage = e => {
        const data = JSON.parse(e.data);
        if (data.action === 'show') setShow({ event: data, at: performance.now() });
        if (data.action === 'show' && data.buttons?.pulses > 0) setHandover({ buttons: data.buttons, at: performance.now() });
        if (data.action === 'cue') setCue({ cue: data, at: performance.now() });
        const line = { id: nextId.current++, time: new Date(), text: describeEvent(data) };
        setLog(prev => [line, ...prev].slice(0, MAX_LOG));
      };
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = window.setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    };
    connect();

    return () => {
      closed = true;
      window.clearTimeout(retry);
      ws.close();
    };
  }, []);

  return { connected, show, cue, handover, log, clearLog: () => setLog([]) };
}
