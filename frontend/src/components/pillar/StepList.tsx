import { useMemo, useState } from 'react';
import { stepStill } from '../../pillar/sequence';
import type { Step } from '../../pillar/types';
import { StripCanvas } from './StripCanvas';

interface Props {
  steps: Step[];
  selected: number;
  errors: Record<number, string>;
  onSelect: (index: number) => void;
  onMove: (from: number, to: number) => void;
}

function label(step: Step): string {
  if (step.kind === 'effect') return `Effect · ${step.effect}`;
  return `Frame · ${step.transition.type}`;
}

/** Tracker overview: one row per step, its 100 LEDs across. Drag a row's handle to reorder. */
export function StepList({ steps, selected, errors, onSelect, onMove }: Props) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const stills = useMemo(() => steps.map(s => stepStill(s)), [steps]);

  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };

  return (
    <ol className="step-list">
      {steps.map((step, i) => (
        <li
          key={i}
          className={[
            'step-row',
            i === selected ? 'selected' : '',
            errors[i] ? 'invalid' : '',
            dragOver === i && dragFrom !== i ? 'drop-target' : '',
          ].join(' ')}
          onClick={() => onSelect(i)}
          onDragOver={e => {
            if (dragFrom === null) return;
            e.preventDefault();
            setDragOver(i);
          }}
          onDrop={e => {
            e.preventDefault();
            if (dragFrom !== null && dragFrom !== i) onMove(dragFrom, i);
            endDrag();
          }}
        >
          <span
            className="step-handle"
            draggable
            onDragStart={e => {
              e.dataTransfer.effectAllowed = 'move';
              setDragFrom(i);
            }}
            onDragEnd={endDrag}
            title="Drag to reorder"
          >
            ⠿
          </span>
          <span className="step-label">{i + 1} · {label(step)}</span>
          <StripCanvas strip={stills[i]} orientation="horizontal" className="step-thumb" />
          <span className="step-duration">{step.duration_ms} ms</span>
          {errors[i] && <span className="step-error" title={errors[i]}>!</span>}
        </li>
      ))}
    </ol>
  );
}
