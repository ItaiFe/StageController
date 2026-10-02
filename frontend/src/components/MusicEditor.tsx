import { useState, useRef, useEffect, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.js';
import type { Song } from '../api';
import './MusicEditor.css';

interface MusicEditorProps {
  song: Song;
  onClose: () => void;
  onSave: () => void;
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:8000/api' : '/api';

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

export function MusicEditor({ song, onClose, onSave }: MusicEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#ff6b9d',
      progressColor: '#ff1a6c',
      cursorColor: '#ffffff',
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 128,
      normalize: true,
      plugins: [regions],
    });

    wavesurferRef.current = ws;

    ws.on('ready', () => {
      const dur = ws.getDuration();
      setDuration(dur);
      setTrimEnd(dur);
      setIsLoading(false);

      // Add initial region covering full song
      regions.addRegion({
        start: 0,
        end: dur,
        color: 'rgba(255, 107, 157, 0.3)',
        drag: true,
        resize: true,
      });
    });

    ws.on('timeupdate', (time) => {
      setCurrentTime(time);
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));

    ws.on('error', (err) => {
      console.error('WaveSurfer error:', err);
      setError('Failed to load audio file');
      setIsLoading(false);
    });

    regions.on('region-updated', (region) => {
      setTrimStart(region.start);
      setTrimEnd(region.end);
    });

    // Load the song via fetch to handle CORS properly
    const loadAudio = async () => {
      try {
        const url = `${API_BASE}/songs/${song.id}/stream`;
        console.log('Fetching audio from:', url);
        const response = await fetch(url);
        console.log('Response status:', response.status, response.statusText);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        console.log('Blob size:', blob.size, 'type:', blob.type);
        const blobUrl = URL.createObjectURL(blob);
        console.log('Loading blob URL into wavesurfer');
        ws.load(blobUrl);
      } catch (err) {
        console.error('Failed to fetch audio:', err);
        setError(`Failed to load audio: ${err}`);
        setIsLoading(false);
      }
    };
    loadAudio();

    return () => {
      ws.destroy();
    };
  }, [song.id]);

  const togglePlay = useCallback(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  }, []);

  const playSelection = useCallback(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setTime(trimStart);
      wavesurferRef.current.play();

      // Stop at trimEnd
      const checkTime = () => {
        if (wavesurferRef.current && wavesurferRef.current.getCurrentTime() >= trimEnd) {
          wavesurferRef.current.pause();
          wavesurferRef.current.setTime(trimStart);
        } else if (wavesurferRef.current?.isPlaying()) {
          requestAnimationFrame(checkTime);
        }
      };
      requestAnimationFrame(checkTime);
    }
  }, [trimStart, trimEnd]);

  const handleTrim = async () => {
    if (trimStart === 0 && trimEnd === duration) {
      onClose();
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE}/songs/${song.id}/trim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_time: trimStart,
          end_time: trimEnd,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to trim song');
      }

      onSave();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to trim song');
    } finally {
      setIsSaving(false);
    }
  };

  const setStartHere = () => {
    if (regionsRef.current) {
      const regions = regionsRef.current.getRegions();
      if (regions.length > 0) {
        regions[0].setOptions({ start: currentTime });
        setTrimStart(currentTime);
      }
    }
  };

  const setEndHere = () => {
    if (regionsRef.current) {
      const regions = regionsRef.current.getRegions();
      if (regions.length > 0) {
        regions[0].setOptions({ end: currentTime });
        setTrimEnd(currentTime);
      }
    }
  };

  const resetSelection = () => {
    if (regionsRef.current) {
      const regions = regionsRef.current.getRegions();
      if (regions.length > 0) {
        regions[0].setOptions({ start: 0, end: duration });
        setTrimStart(0);
        setTrimEnd(duration);
      }
    }
  };

  const selectDuration = (seconds: number) => {
    if (regionsRef.current) {
      const regions = regionsRef.current.getRegions();
      if (regions.length > 0) {
        const end = Math.min(seconds, duration);
        regions[0].setOptions({ start: 0, end });
        setTrimStart(0);
        setTrimEnd(end);
      }
    }
  };

  return (
    <div className="music-editor-overlay" onClick={onClose}>
      <div className="music-editor" onClick={e => e.stopPropagation()}>
        <div className="editor-header">
          <h2>Edit: {song.title}</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>

        <div className="editor-content">
          {isLoading && (
            <div className="loading-overlay">
              <div className="loading-spinner" />
              <p>Loading waveform...</p>
            </div>
          )}

          <div className="waveform-wrapper">
            <div
              className="trim-overlay trim-overlay-left"
              style={{ width: `${(trimStart / duration) * 100}%` }}
            />
            <div className="waveform-container" ref={containerRef} />
            <div
              className="trim-overlay trim-overlay-right"
              style={{ width: `${((duration - trimEnd) / duration) * 100}%` }}
            />
          </div>

          <div className="time-display">
            <span>{formatTime(currentTime)}</span>
            <span className="duration">/ {formatTime(duration)}</span>
          </div>

          <div className="trim-info">
            <div className="trim-range">
              <span className="label">Selection:</span>
              <span className="times">
                {formatTime(trimStart)} - {formatTime(trimEnd)}
              </span>
              <span className="duration-badge">
                ({formatTime(trimEnd - trimStart)})
              </span>
            </div>
          </div>

          <div className="editor-controls">
            <div className="playback-controls">
              <button onClick={togglePlay} className="play-btn">
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button onClick={playSelection} className="play-selection-btn">
                ▶ Play Selection
              </button>
            </div>

            <div className="trim-controls">
              <button onClick={setStartHere} title="Set selection start to current position">
                Set Start Here
              </button>
              <button onClick={setEndHere} title="Set selection end to current position">
                Set End Here
              </button>
              <button onClick={() => selectDuration(180)} title="Select first 3 minutes">
                First 3 min
              </button>
              <button onClick={resetSelection} className="reset-btn">
                Reset
              </button>
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="editor-actions">
            <button onClick={onClose} className="cancel-btn">
              Cancel
            </button>
            <button
              onClick={handleTrim}
              className="save-btn"
              disabled={isSaving || (trimStart === 0 && trimEnd === duration)}
            >
              {isSaving ? 'Saving...' : 'Save Trimmed'}
            </button>
          </div>

          <p className="help-text">
            Drag the edges of the highlighted region to select the portion you want to keep.
            The song will be permanently trimmed to the selected range.
          </p>
        </div>
      </div>
    </div>
  );
}
