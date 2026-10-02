import type { Song } from '../api';

interface SongTableProps {
  songs: Song[];
  currentSongId?: number;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
  onTogglePlay?: () => void;
  actions?: (song: Song) => React.ReactNode;
  showAlbum?: boolean;
  showSize?: boolean;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function SongTable({
  songs,
  currentSongId,
  isPlaying,
  onPlay,
  onTogglePlay,
  actions,
  showAlbum = true,
  showSize = true,
}: SongTableProps) {
  if (songs.length === 0) {
    return null;
  }

  return (
    <table className="song-table">
      <thead>
        <tr>
          <th style={{ width: 50 }}></th>
          <th>Title</th>
          <th>Artist</th>
          {showAlbum && <th>Album</th>}
          <th style={{ width: 80 }}>Duration</th>
          {showSize && <th style={{ width: 80 }}>Size</th>}
          {actions && <th>Actions</th>}
        </tr>
      </thead>
      <tbody>
        {songs.map(song => (
          <tr
            key={song.id}
            className={currentSongId === song.id ? 'playing' : ''}
          >
            <td>
              <button
                className="play-btn"
                onClick={() => {
                  if (currentSongId === song.id && onTogglePlay) {
                    onTogglePlay();
                  } else {
                    onPlay(song);
                  }
                }}
              >
                {currentSongId === song.id && isPlaying ? '⏸' : '▶'}
              </button>
            </td>
            <td>{song.title}</td>
            <td>{song.artist}</td>
            {showAlbum && <td>{song.album}</td>}
            <td>{formatDuration(song.duration)}</td>
            {showSize && <td>{formatFileSize(song.file_size)}</td>}
            {actions && <td className="actions">{actions(song)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
