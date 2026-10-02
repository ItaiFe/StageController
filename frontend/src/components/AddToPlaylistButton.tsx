import { useState, useRef, useEffect } from 'react';
import type { Playlist } from '../api';
import './AddToPlaylistButton.css';

interface AddToPlaylistButtonProps {
  playlists: Playlist[];
  onAdd: (playlistId: number) => void;
  onCreateNew: () => void;
}

export function AddToPlaylistButton({ playlists, onAdd, onCreateNew }: AddToPlaylistButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [addedTo, setAddedTo] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (addedTo !== null) {
      const timer = setTimeout(() => setAddedTo(null), 1500);
      return () => clearTimeout(timer);
    }
  }, [addedTo]);

  const handleAdd = (playlistId: number) => {
    onAdd(playlistId);
    setAddedTo(playlistId);
    setIsOpen(false);
  };

  const handleClick = () => {
    if (playlists.length === 0) {
      onCreateNew();
    } else if (playlists.length === 1) {
      handleAdd(playlists[0].id);
    } else {
      setIsOpen(!isOpen);
    }
  };

  const buttonText = addedTo !== null
    ? `Added!`
    : '+ Playlist';

  return (
    <div className="add-to-playlist" ref={containerRef}>
      <button
        className={`add-btn ${addedTo !== null ? 'added' : ''}`}
        onClick={handleClick}
      >
        {buttonText}
      </button>

      {isOpen && playlists.length > 1 && (
        <div className="playlist-dropdown">
          <div className="dropdown-header">Add to playlist</div>
          {playlists.map(pl => (
            <button
              key={pl.id}
              className="dropdown-item"
              onClick={() => handleAdd(pl.id)}
            >
              {pl.name}
              <span className="song-count">{pl.song_count}</span>
            </button>
          ))}
          <button className="dropdown-item new" onClick={() => { onCreateNew(); setIsOpen(false); }}>
            + Create new playlist
          </button>
        </div>
      )}
    </div>
  );
}
