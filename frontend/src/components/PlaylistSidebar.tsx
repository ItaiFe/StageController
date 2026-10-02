import type { Playlist } from '../api';
import './PlaylistSidebar.css';

interface PlaylistSidebarProps {
  playlists: Playlist[];
  selectedId?: number;
  onSelect: (id: number) => void;
  onDelete: (id: number) => void;
  onCreateNew: () => void;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins} min`;
}

export function PlaylistSidebar({
  playlists,
  selectedId,
  onSelect,
  onDelete,
  onCreateNew,
}: PlaylistSidebarProps) {
  return (
    <div className="playlist-sidebar">
      <button className="new-playlist-btn" onClick={onCreateNew}>
        + New Playlist
      </button>

      {playlists.length === 0 ? (
        <p className="no-playlists">No playlists yet</p>
      ) : (
        <ul className="playlist-list">
          {playlists.map(pl => (
            <li
              key={pl.id}
              className={selectedId === pl.id ? 'selected' : ''}
              onClick={() => onSelect(pl.id)}
            >
              <div className="pl-info">
                <span className="pl-name">{pl.name}</span>
                <span className="pl-meta">
                  {pl.song_count} songs · {formatDuration(pl.total_duration)}
                </span>
              </div>
              <button
                className="pl-delete"
                onClick={e => {
                  e.stopPropagation();
                  onDelete(pl.id);
                }}
                title="Delete playlist"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
