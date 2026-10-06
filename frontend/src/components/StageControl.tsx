import { useState, useEffect, useCallback } from 'react';
import type { Device, Sequence, SequenceStep } from '../api';
import { devicesApi, sequencesApi } from '../api';
import { SequenceFlowChart } from './SequenceFlowChart';
import { ShowTunables } from './ShowTunables';
import { useOverlayDismiss } from '../hooks/useOverlayDismiss';
import './StageControl.css';

interface Props {
  onOpenDeviceModal: () => void;
  onOpenSequenceModal: (sequence?: Sequence) => void;
  // Bumped by the parent after a device/sequence is saved so this view reloads
  refreshKey: number;
}

const ROLE_ICONS: Record<string, string> = {
  bubble_machine: '🫧',
  flickers: '✨',
  lights: '💡',
  smoke_machine: '💨',
  custom: '🔌',
};

const ROLE_LABELS: Record<string, string> = {
  bubble_machine: 'Bubbles',
  flickers: 'Flickers',
  lights: 'Lights',
  smoke_machine: 'Smoke',
  custom: 'Custom',
};

export function StageControl({ onOpenDeviceModal, onOpenSequenceModal, refreshKey }: Props) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [togglingDevice, setTogglingDevice] = useState<number | null>(null);
  const [executingSequence, setExecutingSequence] = useState<number | null>(null);

  const loadDevices = useCallback(async () => {
    try {
      const data = await devicesApi.getAll();
      setDevices(data);
    } catch (e) {
      console.error('Failed to load devices:', e);
    }
  }, []);

  const loadSequences = useCallback(async () => {
    try {
      const data = await sequencesApi.getAll();
      setSequences(data);
    } catch (e) {
      console.error('Failed to load sequences:', e);
    }
  }, []);

  useEffect(() => {
    loadDevices();
    loadSequences();
  }, [loadDevices, loadSequences, refreshKey]);

  const handleToggleDevice = async (device: Device) => {
    setTogglingDevice(device.id);
    try {
      const updated = await devicesApi.toggle(device.id, !device.is_on);
      setDevices(prev => prev.map(d => d.id === device.id ? updated : d));
    } catch (e) {
      console.error('Failed to toggle device:', e);
      setDevices(prev => prev.map(d => d.id === device.id ? { ...d, is_online: false } : d));
    } finally {
      setTogglingDevice(null);
    }
  };

  const handleAllOn = async () => {
    try {
      await devicesApi.allOn();
      loadDevices();
    } catch (e) {
      console.error('Failed to turn all on:', e);
    }
  };

  const handleAllOff = async () => {
    try {
      await devicesApi.allOff();
      loadDevices();
    } catch (e) {
      console.error('Failed to turn all off:', e);
    }
  };

  const handleExecuteSequence = async (sequence: Sequence) => {
    setExecutingSequence(sequence.id);
    try {
      await sequencesApi.execute(sequence.id);
      loadDevices();
    } catch (e) {
      console.error('Failed to execute sequence:', e);
    } finally {
      setExecutingSequence(null);
    }
  };

  const handleDeleteDevice = async (id: number) => {
    try {
      await devicesApi.delete(id);
      loadDevices();
    } catch (e) {
      console.error('Failed to delete device:', e);
    }
  };

  const handleDeleteSequence = async (id: number) => {
    try {
      await sequencesApi.delete(id);
      loadSequences();
    } catch (e) {
      console.error('Failed to delete sequence:', e);
    }
  };

  return (
    <div className="stage-control">
      <section className="stage-section">
        <div className="section-header">
          <h2>Devices</h2>
          <div className="section-actions">
            <button className="btn-master btn-on" onClick={handleAllOn}>All On</button>
            <button className="btn-master btn-off" onClick={handleAllOff}>All Off</button>
            <button className="btn-add" onClick={onOpenDeviceModal}>+ Add Device</button>
          </div>
        </div>

        {devices.length === 0 ? (
          <p className="empty">No devices configured. Add your first Tasmota device!</p>
        ) : (
          <div className="device-grid">
            {devices.map(device => (
              <div
                key={device.id}
                className={`device-card ${device.is_on ? 'on' : 'off'} ${!device.is_online ? 'offline' : ''}`}
              >
                <div className="device-icon">
                  {ROLE_ICONS[device.role] || '🔌'}
                </div>
                <div className="device-info">
                  <span className="device-name">{device.name}</span>
                  <span className="device-role">{ROLE_LABELS[device.role] || device.role}</span>
                  <span className="device-ip">{device.ip_address}</span>
                </div>
                <div className="device-status">
                  {!device.is_online ? (
                    <span className="status-offline">Offline</span>
                  ) : device.is_on ? (
                    <span className="status-on">ON</span>
                  ) : (
                    <span className="status-off">OFF</span>
                  )}
                </div>
                <div className="device-actions">
                  <button
                    className={`toggle-btn ${device.is_on ? 'on' : 'off'}`}
                    onClick={() => handleToggleDevice(device)}
                    disabled={togglingDevice === device.id || !device.is_online}
                  >
                    {togglingDevice === device.id ? '...' : device.is_on ? 'Turn Off' : 'Turn On'}
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDeleteDevice(device.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="stage-section">
        <div className="section-header">
          <h2>Sequences</h2>
          <button className="btn-add" onClick={() => onOpenSequenceModal()}>+ New Sequence</button>
        </div>

        {sequences.length === 0 ? (
          <p className="empty">No sequences yet. Create one to automate your stage!</p>
        ) : (
          <div className="sequence-list">
            {sequences.map(sequence => (
              <div key={sequence.id} className="sequence-card">
                <div className="sequence-info">
                  <span className="sequence-name">{sequence.name}</span>
                  {sequence.description && (
                    <span className="sequence-desc">{sequence.description}</span>
                  )}
                  <span className="sequence-steps">
                    {sequence.steps.length} step{sequence.steps.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="sequence-actions">
                  <button
                    className="run-btn"
                    onClick={() => handleExecuteSequence(sequence)}
                    disabled={executingSequence === sequence.id}
                  >
                    {executingSequence === sequence.id ? 'Running...' : '▶ Run'}
                  </button>
                  <button
                    className="edit-btn"
                    onClick={() => onOpenSequenceModal(sequence)}
                  >
                    Edit
                  </button>
                  <button
                    className="delete-btn"
                    onClick={() => handleDeleteSequence(sequence.id)}
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <ShowTunables />
    </div>
  );
}

interface DeviceModalProps {
  onClose: () => void;
  onSave: () => void;
}

export function AddDeviceModal({ onClose, onSave }: DeviceModalProps) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState('');
  const [role, setRole] = useState('lights');
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<{ ip_address: string; hostname?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const overlayProps = useOverlayDismiss(onClose);

  const handleDiscover = async () => {
    setDiscovering(true);
    try {
      const devices = await devicesApi.discover();
      setDiscovered(devices);
    } catch (e) {
      console.error('Discovery failed:', e);
    } finally {
      setDiscovering(false);
    }
  };

  const handleSelectDiscovered = (device: { ip_address: string; hostname?: string }) => {
    setIp(device.ip_address);
    if (device.hostname) {
      setName(device.hostname);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !ip.trim()) return;

    setSaving(true);
    try {
      await devicesApi.create({ name: name.trim(), ip_address: ip.trim(), role });
      onSave();
      onClose();
    } catch (e) {
      console.error('Failed to create device:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal device-modal">
        <div className="modal-header">
          <h3>Add Device</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="modal-label">Device Name</label>
            <input
              className="modal-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Main Lights"
              required
            />
          </div>

          <div className="form-row">
            <label className="modal-label">IP Address</label>
            <div className="input-with-btn">
              <input
                className="modal-input"
                type="text"
                value={ip}
                onChange={e => setIp(e.target.value)}
                placeholder="e.g. 192.168.1.100"
                required
              />
              <button
                type="button"
                className="btn-secondary"
                onClick={handleDiscover}
                disabled={discovering}
              >
                {discovering ? 'Scanning...' : 'Discover'}
              </button>
            </div>
          </div>

          {discovered.length > 0 && (
            <div className="discovered-list">
              <label className="modal-label">Found Devices:</label>
              {discovered.map(d => (
                <button
                  key={d.ip_address}
                  type="button"
                  className="discovered-item"
                  onClick={() => handleSelectDiscovered(d)}
                >
                  {d.ip_address} {d.hostname && `(${d.hostname})`}
                </button>
              ))}
            </div>
          )}

          <div className="form-row">
            <label className="modal-label">Role</label>
            <select
              className="modal-input"
              value={role}
              onChange={e => setRole(e.target.value)}
            >
              <option value="lights">💡 Lights</option>
              <option value="bubble_machine">🫧 Bubble Machine</option>
              <option value="flickers">✨ Flickers</option>
              <option value="smoke_machine">💨 Smoke Machine</option>
              <option value="custom">🔌 Custom</option>
            </select>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Add Device'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SequenceModalProps {
  devices: Device[];
  sequence?: Sequence;
  onClose: () => void;
  onSave: () => void;
}

export function SequenceModal({ devices, sequence, onClose, onSave }: SequenceModalProps) {
  const [name, setName] = useState(sequence?.name || '');
  const [description, setDescription] = useState(sequence?.description || '');
  const [steps, setSteps] = useState<Omit<SequenceStep, 'id' | 'device_name'>[]>(
    sequence?.steps.map(s => ({
      device_id: s.device_id,
      action: s.action,
      delay_before: s.delay_before,
      parallel_group: s.parallel_group,
      order: s.order,
    })) || []
  );
  const [saving, setSaving] = useState(false);
  const overlayProps = useOverlayDismiss(onClose);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      if (sequence) {
        await sequencesApi.update(sequence.id, { name: name.trim(), description: description.trim() || undefined, steps });
      } else {
        await sequencesApi.create({ name: name.trim(), description: description.trim() || undefined, steps });
      }
      onSave();
      onClose();
    } catch (e) {
      console.error('Failed to save sequence:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" {...overlayProps}>
      <div className="modal sequence-modal flowchart-modal">
        <div className="modal-header">
          <h3>{sequence ? 'Edit Sequence' : 'New Sequence'}</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <form className="modal-body" onSubmit={handleSubmit}>
          <div className="sequence-info-row">
            <div className="form-row">
              <label className="modal-label">Sequence Name</label>
              <input
                className="modal-input"
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Grand Entrance"
                required
              />
            </div>

            <div className="form-row">
              <label className="modal-label">Description (optional)</label>
              <input
                className="modal-input"
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="e.g. All lights on with smoke effect"
              />
            </div>
          </div>

          <div className="flowchart-section">
            <SequenceFlowChart
              devices={devices}
              initialSteps={sequence?.steps}
              onChange={setSteps}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving...' : sequence ? 'Save Changes' : 'Create Sequence'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
