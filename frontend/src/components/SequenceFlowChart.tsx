import { useState, useRef, useCallback } from 'react';
import type { Device, SequenceStep } from '../api';
import './SequenceFlowChart.css';

interface FlowNode {
  id: string;
  device_id: number;
  action: 'on' | 'off';
  delay_before: number;
  x: number;
  y: number;
  parallelGroup: number | null;
}

interface Props {
  devices: Device[];
  initialSteps?: SequenceStep[];
  onChange: (steps: Omit<SequenceStep, 'id' | 'device_name'>[]) => void;
}

const NODE_WIDTH = 140;
const NODE_HEIGHT = 80;
const GRID_SIZE = 20;
const COLUMN_SPACING = 180;
const ROW_SPACING = 120;
const ORIGIN_X = 60;
const ORIGIN_Y = 80;
// Keep nodes off the canvas edge so the delete button and delay badge aren't clipped
const EDGE_MARGIN = GRID_SIZE;
const SURFACE_PADDING = 60;

// Lay saved steps out so each parallel group shares a column (stacked vertically)
function layoutSteps(steps: SequenceStep[]): FlowNode[] {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  let column = -1;
  let row = 0;
  let prevGroup: number | null = null;

  return sorted.map((step, i) => {
    const group = step.parallel_group ?? null;
    if (group !== null && group === prevGroup) {
      row++;
    } else {
      column++;
      row = 0;
    }
    prevGroup = group;

    return {
      id: `node-${Date.now()}-${i}`,
      device_id: step.device_id,
      action: step.action,
      delay_before: step.delay_before,
      x: ORIGIN_X + column * COLUMN_SPACING,
      y: ORIGIN_Y + row * ROW_SPACING,
      parallelGroup: group,
    };
  });
}

export function SequenceFlowChart({ devices, initialSteps, onChange }: Props) {
  const [nodes, setNodes] = useState<FlowNode[]>(() =>
    initialSteps && initialSteps.length > 0 ? layoutSteps(initialSteps) : []
  );

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const snapToGrid = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

  const getDeviceName = (deviceId: number) => {
    const device = devices.find(d => d.id === deviceId);
    return device?.name || 'Unknown';
  };

  const getDeviceIcon = (deviceId: number) => {
    const device = devices.find(d => d.id === deviceId);
    const icons: Record<string, string> = {
      bubble_machine: '🫧',
      flickers: '✨',
      lights: '💡',
      smoke_machine: '💨',
      custom: '🔌',
    };
    return icons[device?.role || 'custom'] || '🔌';
  };

  const updateStepsFromNodes = useCallback((newNodes: FlowNode[]) => {
    // Sort left-to-right, then top-to-bottom within same column
    const sorted = [...newNodes].sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

    let currentGroup = 0;
    let lastX = -1;

    const steps = sorted.map((node, index) => {
      if (lastX !== -1 && Math.abs(node.x - lastX) < NODE_WIDTH / 2) {
        // Same column = parallel
      } else if (lastX !== -1) {
        currentGroup++;
      }
      lastX = node.x;

      const sameColumnNodes = sorted.filter(n => Math.abs(n.x - node.x) < NODE_WIDTH / 2);
      const isParallel = sameColumnNodes.length > 1;

      return {
        device_id: node.device_id,
        action: node.action,
        delay_before: node.delay_before,
        parallel_group: isParallel ? currentGroup : null,
        order: index,
      };
    });

    onChange(steps);
  }, [onChange]);

  const addNode = () => {
    if (devices.length === 0) return;

    // Append after the right-most column so new steps never land on top of existing ones
    const rightmost = nodes.reduce((max, n) => Math.max(max, n.x), -Infinity);
    const newNode: FlowNode = {
      id: `node-${Date.now()}`,
      device_id: devices[0].id,
      action: 'on',
      delay_before: 0,
      x: nodes.length > 0 ? rightmost + COLUMN_SPACING : ORIGIN_X,
      y: ORIGIN_Y,
      parallelGroup: null,
    };

    const newNodes = [...nodes, newNode];
    setNodes(newNodes);
    setSelectedNode(newNode.id);
    updateStepsFromNodes(newNodes);
  };

  const deleteNode = (id: string) => {
    const newNodes = nodes.filter(n => n.id !== id);
    setNodes(newNodes);
    setSelectedNode(null);
    updateStepsFromNodes(newNodes);
  };

  const updateNode = (id: string, updates: Partial<FlowNode>) => {
    const newNodes = nodes.map(n => n.id === id ? { ...n, ...updates } : n);
    setNodes(newNodes);
    updateStepsFromNodes(newNodes);
  };

  // Pointer events + capture: works for mouse and touch, and the drag keeps tracking
  // even when the pointer leaves the canvas
  const handlePointerDown = (e: React.PointerEvent, nodeId: string) => {
    if (e.button !== 0) return;
    const node = nodes.find(n => n.id === nodeId);
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!node || !rect) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectedNode(nodeId);
    setDragging({
      id: nodeId,
      offsetX: e.clientX - rect.left - node.x,
      offsetY: e.clientY - rect.top - node.y,
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;

    // The surface rect moves with scrolling, so positions stay in content coordinates
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = Math.max(EDGE_MARGIN, snapToGrid(e.clientX - rect.left - dragging.offsetX));
    const y = Math.max(EDGE_MARGIN, snapToGrid(e.clientY - rect.top - dragging.offsetY));

    setNodes(prev => prev.map(n => n.id === dragging.id ? { ...n, x, y } : n));
  };

  const handlePointerUp = () => {
    if (dragging) {
      updateStepsFromNodes(nodes);
    }
    setDragging(null);
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || e.target === surfaceRef.current) {
      setSelectedNode(null);
    }
  };

  const selectedNodeData = nodes.find(n => n.id === selectedNode);

  // Size the scrollable surface to fit every node so the grid and arrows cover it all
  const surfaceWidth = nodes.reduce((max, n) => Math.max(max, n.x + NODE_WIDTH), 0) + SURFACE_PADDING;
  const surfaceHeight = nodes.reduce((max, n) => Math.max(max, n.y + NODE_HEIGHT), 0) + SURFACE_PADDING;

  // Calculate connections (arrows between columns, left to right)
  const getConnections = () => {
    const sorted = [...nodes].sort((a, b) => {
      if (a.x !== b.x) return a.x - b.x;
      return a.y - b.y;
    });

    const columns: FlowNode[][] = [];
    let currentColumn: FlowNode[] = [];
    let lastX = -1;

    sorted.forEach(node => {
      if (lastX === -1 || Math.abs(node.x - lastX) < NODE_WIDTH / 2) {
        currentColumn.push(node);
      } else {
        if (currentColumn.length > 0) columns.push(currentColumn);
        currentColumn = [node];
      }
      lastX = node.x;
    });
    if (currentColumn.length > 0) columns.push(currentColumn);

    const connections: { from: FlowNode; to: FlowNode }[] = [];
    for (let i = 0; i < columns.length - 1; i++) {
      const fromCol = columns[i];
      const toCol = columns[i + 1];

      // Connect center of from column to center of to column
      const fromCenterY = fromCol.reduce((sum, n) => sum + n.y + NODE_HEIGHT / 2, 0) / fromCol.length;
      const toCenterY = toCol.reduce((sum, n) => sum + n.y + NODE_HEIGHT / 2, 0) / toCol.length;

      connections.push({
        from: { ...fromCol[0], x: fromCol[0].x, y: fromCenterY - NODE_HEIGHT / 2 },
        to: { ...toCol[0], x: toCol[0].x, y: toCenterY - NODE_HEIGHT / 2 },
      });
    }

    return connections;
  };

  return (
    <div className="flow-chart-container">
      <div className="flow-toolbar">
        <button
          type="button"
          className="btn-add-node"
          onClick={addNode}
          disabled={devices.length === 0}
          title={devices.length === 0 ? 'Add a device first' : undefined}
        >
          + Add Step
        </button>
        <span className="flow-hint">
          Drag nodes to reorder. Same column = parallel execution.
        </span>
      </div>

      <div ref={canvasRef} className="flow-canvas" onClick={handleCanvasClick}>
        <div
          ref={surfaceRef}
          className="flow-surface"
          style={{ minWidth: surfaceWidth, minHeight: surfaceHeight }}
        >
          {/* Grid background */}
          <div className="flow-grid" />

          {/* Connection arrows */}
          <svg className="flow-connections">
            {getConnections().map((conn, i) => {
              const fromX = conn.from.x + NODE_WIDTH;
              const fromY = conn.from.y + NODE_HEIGHT / 2;
              const toX = conn.to.x;
              const toY = conn.to.y + NODE_HEIGHT / 2;

              return (
                <g key={i}>
                  <path
                    d={`M ${fromX} ${fromY} C ${fromX + 30} ${fromY}, ${toX - 30} ${toY}, ${toX} ${toY}`}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="2"
                    strokeDasharray="5,5"
                    opacity="0.6"
                  />
                  <polygon
                    points={`${toX},${toY} ${toX - 10},${toY - 6} ${toX - 10},${toY + 6}`}
                    fill="var(--accent)"
                    opacity="0.6"
                  />
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map(node => (
            <div
              key={node.id}
              className={`flow-node ${node.action} ${selectedNode === node.id ? 'selected' : ''} ${dragging?.id === node.id ? 'dragging' : ''}`}
              style={{ left: node.x, top: node.y }}
              onPointerDown={e => handlePointerDown(e, node.id)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <div className="node-icon">{getDeviceIcon(node.device_id)}</div>
              <div className="node-content">
                <span className="node-device">{getDeviceName(node.device_id)}</span>
                <span className={`node-action ${node.action}`}>
                  {node.action.toUpperCase()}
                </span>
              </div>
              {node.delay_before > 0 && (
                <div className="node-delay">{node.delay_before}ms</div>
              )}
              <button
                type="button"
                className="node-delete"
                title="Delete step"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); deleteNode(node.id); }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {nodes.length === 0 && (
          <div className="flow-empty">
            Click "+ Add Step" to start building your sequence
          </div>
        )}
      </div>

      {/* Properties panel: always rendered (disabled when nothing is selected) so the layout doesn't jump */}
      <div className={`flow-properties ${selectedNodeData ? '' : 'empty'}`}>
        <h4>{selectedNodeData ? 'Step Properties' : 'Select a step to edit its properties'}</h4>

        <div className="prop-field">
          <label htmlFor="flow-prop-device">Device</label>
          <select
            id="flow-prop-device"
            disabled={!selectedNodeData}
            value={selectedNodeData?.device_id ?? ''}
            onChange={e => selectedNodeData && updateNode(selectedNodeData.id, { device_id: Number(e.target.value) })}
          >
            {!selectedNodeData && <option value="">—</option>}
            {devices.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>

        <div className="prop-field">
          <label>Action</label>
          <div className="action-toggle">
            <button
              type="button"
              disabled={!selectedNodeData}
              className={selectedNodeData?.action === 'on' ? 'active on' : ''}
              onClick={() => selectedNodeData && updateNode(selectedNodeData.id, { action: 'on' })}
            >
              ON
            </button>
            <button
              type="button"
              disabled={!selectedNodeData}
              className={selectedNodeData?.action === 'off' ? 'active off' : ''}
              onClick={() => selectedNodeData && updateNode(selectedNodeData.id, { action: 'off' })}
            >
              OFF
            </button>
          </div>
        </div>

        <div className="prop-field">
          <label htmlFor="flow-prop-delay">Delay Before (ms)</label>
          <input
            id="flow-prop-delay"
            type="number"
            min="0"
            step="100"
            disabled={!selectedNodeData}
            value={selectedNodeData?.delay_before ?? ''}
            // Enter would otherwise submit the surrounding sequence form and close the dialog
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
            onChange={e => selectedNodeData && updateNode(selectedNodeData.id, { delay_before: Math.max(0, Number(e.target.value)) })}
          />
        </div>
      </div>
    </div>
  );
}
