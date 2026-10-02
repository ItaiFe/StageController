import { useState, useRef } from 'react';
import './Player.css';

interface PlayerSong {
  id: number;
  title: string;
  artist: string;
}

interface PlayerProps {
  song: PlayerSong;
  playlistName?: string | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (time: number) => void;
  onVolumeChange: (volume: number) => void;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function Player({
  song,
  playlistName,
  isPlaying,
  currentTime,
  duration,
  volume,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
  onVolumeChange,
}: PlayerProps) {
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [tooltipX, setTooltipX] = useState(0);
  const progressRef = useRef<HTMLDivElement>(null);

  const handleProgressHover = (e: React.MouseEvent) => {
    if (!progressRef.current || !duration) return;
    const rect = progressRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const progress = x / rect.width;
    const time = progress * duration;
    setHoverTime(Math.max(0, Math.min(duration, time)));
    setTooltipX(x);
  };

  const handleProgressLeave = () => {
    setHoverTime(null);
  };

  return (
    <footer className="player">
      <div className="player-progress">
        <span className="time">{formatTime(currentTime)}</span>
        <div
          className="progress-wrapper"
          ref={progressRef}
          onMouseMove={handleProgressHover}
          onMouseLeave={handleProgressLeave}
        >
          <input
            type="range"
            className="progress-bar"
            min={0}
            max={duration || 0}
            // Step the bar on whole seconds so it moves in lockstep with the timer text
            value={Math.floor(currentTime)}
            onChange={e => onSeek(parseFloat(e.target.value))}
          />
          {hoverTime !== null && (
            <div
              className="time-tooltip"
              style={{ left: tooltipX }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>
        <span className="time">{formatTime(duration)}</span>
      </div>

      <div className="player-main">
        <div className="now-playing">
          <div className="track-title">{song.title}</div>
          <div className="track-artist">
            {song.artist}
            {playlistName && <span className="track-playlist"> · {playlistName}</span>}
          </div>
        </div>

        <div className="controls">
          <button className="control-btn" onClick={onPrev} title="Previous (Shift+←)">
            ⏮
          </button>
          <button
            className={`control-btn play-pause ${isPlaying ? 'playing' : ''}`}
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? '⏸' : '▶'}
          </button>
          <button className="control-btn" onClick={onNext} title="Next (Shift+→)">
            ⏭
          </button>
        </div>

        <div className="volume-control">
          <button
            className="volume-btn"
            onClick={() => onVolumeChange(volume === 0 ? 0.7 : 0)}
            title="Mute"
          >
            {volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
          </button>
          <input
            type="range"
            className="volume-slider"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={e => onVolumeChange(parseFloat(e.target.value))}
          />
        </div>
      </div>
    </footer>
  );
}
