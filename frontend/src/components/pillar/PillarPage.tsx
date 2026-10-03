import { useCallback, useEffect, useMemo, useState } from 'react';
import { PillarValidationError, pillarApi } from '../../api';
import type { PillarStatus } from '../../api';
import { newEffect, newFrame, validateSequence } from '../../pillar/painter';
import { sequenceDuration, stepStill } from '../../pillar/sequence';
import { MAX_STEPS, SLOTS, blankStrip } from '../../pillar/types';
import type { Sequence, Slot, Step } from '../../pillar/types';
import { PillarPreview } from './PillarPreview';
import { StepEditor } from './StepEditor';
import { StepList } from './StepList';
import './PillarPage.css';

const SLOT_INFO: Record<Slot, string> = {
  idle: 'Shown while no song is loaded',
  start: 'Plays for the whole song (single press starts the show)',
  claps: '2 taps, then back to the song loop',
  special: '3 or 5+ taps, then back to the song loop',
  skip: '4 taps, then back to the song loop',
  stop: 'Long press or show end, then idle',
};
const STATUS_POLL_MS = 2000;
const MAX_HISTORY = 100;
const GROUP_WINDOW_MS = 1500;

interface History {
  past: Sequence[];
  future: Sequence[];
  group?: string;
  groupAt?: number;
}

interface EditorState {
  defaults: Record<Slot, Sequence>;
  saved: Record<Slot, Sequence | null>;
  drafts: Record<Slot, Sequence>;
  history: Record<Slot, History>;
  selected: Record<Slot, number>;
  slot: Slot;
}

// Survives switching to another tab of the app (the page unmounts); a reload starts fresh
let cachedState: EditorState | null = null;

const clone = <T,>(v: T): T => structuredClone(v);
const perSlot = <T,>(make: (slot: Slot) => T) => Object.fromEntries(SLOTS.map(s => [s, make(s)])) as Record<Slot, T>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function PillarPage() {
  const [state, setState] = useState<EditorState | null>(cachedState);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<PillarStatus | null>(null);
  const [previewId, setPreviewId] = useState(0);

  useEffect(() => {
    cachedState = state;
  }, [state]);

  useEffect(() => {
    if (cachedState) return;
    Promise.all([pillarApi.getPlans(), pillarApi.getDefaults()])
      .then(([plans, defaults]) => setState({
        defaults,
        saved: plans.slots,
        drafts: perSlot(s => clone(plans.slots[s] ?? defaults[s])),
        history: perSlot(() => ({ past: [], future: [] })),
        selected: perSlot(() => 0),
        slot: 'idle',
      }))
      .catch(e => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    const poll = () => pillarApi.status().then(setStatus).catch(() => setStatus(null));
    poll();
    const id = window.setInterval(poll, STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, []);

  const dirtySlots = useMemo(
    () => (state ? SLOTS.filter(s => !same(state.drafts[s], state.saved[s] ?? state.defaults[s])) : []),
    [state],
  );

  useEffect(() => {
    if (dirtySlots.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirtySlots.length]);

  /** Replace the current slot's draft; edits sharing a `group` within a moment form one undo step. */
  const updateDraft = useCallback((next: Sequence, group?: string, selected?: number) => {
    setServerErrors({});
    setMessage(null);
    setState(s => {
      if (!s) return s;
      const h = s.history[s.slot];
      const now = Date.now();
      const merge = group !== undefined && h.group === group && now - (h.groupAt ?? 0) < GROUP_WINDOW_MS;
      const history: History = merge
        ? { ...h, groupAt: now }
        : { past: [...h.past, s.drafts[s.slot]].slice(-MAX_HISTORY), future: [], group, groupAt: now };
      return {
        ...s,
        drafts: { ...s.drafts, [s.slot]: next },
        history: { ...s.history, [s.slot]: history },
        selected: selected === undefined ? s.selected : { ...s.selected, [s.slot]: selected },
      };
    });
  }, []);

  const undoRedo = useCallback((redo: boolean) => {
    setState(s => {
      if (!s) return s;
      const h = s.history[s.slot];
      const from = redo ? h.future : h.past;
      if (from.length === 0) return s;
      const target = from[from.length - 1];
      const current = s.drafts[s.slot];
      const history: History = redo
        ? { past: [...h.past, current], future: h.future.slice(0, -1) }
        : { past: h.past.slice(0, -1), future: [...h.future, current] };
      const selected = Math.min(s.selected[s.slot], Math.max(0, target.steps.length - 1));
      return {
        ...s,
        drafts: { ...s.drafts, [s.slot]: target },
        history: { ...s.history, [s.slot]: history },
        selected: { ...s.selected, [s.slot]: selected },
      };
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      e.preventDefault();
      undoRedo(e.shiftKey);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undoRedo]);

  const draft = state?.drafts[state.slot];
  const clientErrors = useMemo(() => (draft ? validateSequence(draft) : {}), [draft]);
  const errors = Object.keys(serverErrors).length ? serverErrors : clientErrors;
  const hasErrors = Object.keys(clientErrors).length > 0;
  const selectedIndex = state ? Math.min(state.selected[state.slot], Math.max(0, (draft?.steps.length ?? 1) - 1)) : 0;
  const selectedStep = draft?.steps[selectedIndex];
  const still = useMemo(() => (selectedStep ? stepStill(selectedStep) : blankStrip()), [selectedStep]);

  if (loadError) return <div className="pillar-page"><p className="pillar-error">Couldn't load pillar plans: {loadError}</p></div>;
  if (!state || !draft) return <div className="pillar-page"><p className="pillar-hint">Loading…</p></div>;

  const slot = state.slot;
  const history = state.history[slot];
  const usesDefault = state.saved[slot] === null;
  const dirty = dirtySlots.includes(slot);

  const setSteps = (steps: Step[], selected?: number, group?: string) => updateDraft({ ...draft, steps }, group, selected);

  const insertStep = (step: Step) => {
    const at = draft.steps.length ? selectedIndex + 1 : 0;
    setSteps([...draft.steps.slice(0, at), step, ...draft.steps.slice(at)], at);
  };

  const moveStep = (from: number, to: number) => {
    const steps = [...draft.steps];
    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    setSteps(steps, to);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const { version } = await pillarApi.save(slot, draft);
      setState(s => s && { ...s, saved: { ...s.saved, [slot]: clone(draft) } });
      setMessage(`Saved · plans version ${version}. The pillar picks it up within a second.`);
    } catch (e) {
      if (e instanceof PillarValidationError) setServerErrors(e.stepErrors);
      else setMessage(`Save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  const resetToDefault = async () => {
    if (!window.confirm(`Reset "${slot}" to the pillar's built-in sequence? Your saved version will be deleted.`)) return;
    try {
      const { version } = await pillarApi.reset(slot);
      const def = clone(state.defaults[slot]);
      setState(s => s && { ...s, saved: { ...s.saved, [slot]: null } });
      updateDraft(def, undefined, 0);
      setMessage(`Reset to default · plans version ${version}`);
    } catch (e) {
      setMessage(`Reset failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const playOnPillar = async () => {
    try {
      const { preview_id } = await pillarApi.startPreview(draft);
      setPreviewId(preview_id);
    } catch (e) {
      if (e instanceof PillarValidationError) setServerErrors(e.stepErrors);
      else setMessage(`Couldn't start the pillar preview: ${e instanceof Error ? e.message : e}`);
    }
  };

  const stopOnPillar = async () => {
    await pillarApi.stopPreview().catch(() => undefined);
    setPreviewId(0);
  };

  const pillarPlaying = previewId > 0 && status?.preview_id === previewId;
  const seconds = (sequenceDuration(draft) / 1000).toFixed(1);

  return (
    <div className="pillar-page">
      <div className="pillar-header">
        <h2>Pillar LEDs</h2>
        <div className="slot-tabs">
          {SLOTS.map(s => (
            <button key={s} type="button" title={SLOT_INFO[s]}
              className={`slot-tab ${s === slot ? 'active' : ''}`}
              onClick={() => { setServerErrors({}); setMessage(null); setState({ ...state, slot: s }); }}>
              {s}{state.drafts[s].loop ? ' ↻' : ''}
              {state.saved[s] === null && <span className="slot-dot" title="Uses the built-in default" />}
              {dirtySlots.includes(s) && <span className="slot-dirty" title="Unsaved changes">•</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="pillar-layout">
        <div className="pillar-main">
          <section className="pillar-card">
            <div className="sequence-bar">
              <span className="pillar-field-label">
                {slot} · {SLOT_INFO[slot]} · {draft.steps.length} step{draft.steps.length === 1 ? '' : 's'} · {seconds} s
                {usesDefault && ' · built-in default'}
              </span>
              <label className="pillar-check">
                <input type="checkbox" checked={draft.loop} onChange={e => updateDraft({ ...draft, loop: e.target.checked })} />
                Loop
              </label>
            </div>

            <StepList steps={draft.steps} selected={selectedIndex} errors={errors}
              onSelect={i => setState({ ...state, selected: { ...state.selected, [slot]: i } })}
              onMove={moveStep} />
            {errors[-1] && <div className="step-editor-error">{errors[-1]}</div>}

            <div className="sequence-actions">
              <button type="button" className="pillar-btn" disabled={draft.steps.length >= MAX_STEPS} onClick={() => insertStep(newEffect())}>+ Effect</button>
              <button type="button" className="pillar-btn" disabled={draft.steps.length >= MAX_STEPS} onClick={() => insertStep(newFrame())}>+ Frame</button>
              <button type="button" className="pillar-btn" disabled={!selectedStep || draft.steps.length >= MAX_STEPS}
                onClick={() => selectedStep && insertStep(clone(selectedStep))}>Duplicate</button>
              <button type="button" className="pillar-btn" disabled={!selectedStep}
                onClick={() => setSteps(draft.steps.filter((_, i) => i !== selectedIndex), Math.max(0, selectedIndex - 1))}>Delete</button>
              <span className="toolbar-gap" />
              <button type="button" className="pillar-btn" disabled={!history.past.length} onClick={() => undoRedo(false)} title="Undo (⌘Z)">↶ Undo</button>
              <button type="button" className="pillar-btn" disabled={!history.future.length} onClick={() => undoRedo(true)} title="Redo (⇧⌘Z)">↷ Redo</button>
            </div>
          </section>

          {selectedStep && (
            <section className="pillar-card">
              <div className="pillar-field-label">Step {selectedIndex + 1}</div>
              <StepEditor step={selectedStep} error={errors[selectedIndex]}
                onChange={(step, group) => setSteps(draft.steps.map((s, i) => (i === selectedIndex ? step : s)), undefined, group)} />
            </section>
          )}

          <div className="pillar-save-bar">
            {message && <span className="pillar-message">{message}</span>}
            <span className="toolbar-gap" />
            <button type="button" className="pillar-btn" disabled={usesDefault && !dirty} onClick={resetToDefault}>Reset to default</button>
            <button type="button" className="pillar-btn primary" disabled={!dirty || hasErrors || saving} onClick={save}>
              {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
            </button>
          </div>
        </div>

        <PillarPreview sequence={draft} still={still} status={status} pillarPlaying={pillarPlaying}
          onPlayOnPillar={playOnPillar} onStopOnPillar={stopOnPillar} canPlay={!hasErrors && draft.steps.length > 0} />
      </div>
    </div>
  );
}
