import { useState, useEffect, useCallback } from 'react';
import type { Song, Playlist, PlaylistDetail, Device, Sequence } from './api';
import { songsApi, playlistsApi, devicesApi } from './api';
import { Player, SongTable, PlaylistSidebar, UploadButton, AddToPlaylistButton, PromptModal, ConfirmModal, LoginPage, StageControl, AddDeviceModal, SequenceModal, StatsPage, MusicEditor, ButtonTestPage, PillarPage, StageEmulator } from './components';
import { useBackendPlayer } from './hooks/useBackendPlayer';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import './App.css';

const AUTH_KEY = 'flamingods_auth';
const STAGE_PASSWORD = 'flamingo';

type View = 'songs' | 'playlists' | 'stage' | 'pillar' | 'stats' | 'test' | 'emulator';
type ModalState =
  | { type: 'none' }
  | { type: 'createPlaylist' }
  | { type: 'deletePlaylist'; id: number; name: string }
  | { type: 'deleteSong'; id: number; title: string }
  | { type: 'addDevice' }
  | { type: 'editSequence'; sequence?: Sequence }
  | { type: 'editSong'; song: Song };

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem(AUTH_KEY) === 'true';
  });
  const [loginError, setLoginError] = useState('');
  const [songs, setSongs] = useState<Song[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [view, setView] = useState<View>('songs');
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [isLoading, setIsLoading] = useState(true);
  const [devices, setDevices] = useState<Device[]>([]);
  const [stageRefreshKey, setStageRefreshKey] = useState(0);

  const player = useBackendPlayer();

  useKeyboardShortcuts({
    onTogglePlay: player.toggle,
    onNext: player.next,
    onPrev: player.prev,
    onSeekForward: () => player.seek(player.currentTime + 10),
    onSeekBackward: () => player.seek(Math.max(0, player.currentTime - 10)),
    onVolumeUp: () => player.setVolume(Math.min(100, player.volume + 10)),
    onVolumeDown: () => player.setVolume(Math.max(0, player.volume - 10)),
  });

  const loadSongs = useCallback(async (search?: string) => {
    try {
      const data = await songsApi.getAll({ search: search || undefined });
      setSongs(data.songs);
    } catch (e) {
      console.error('Failed to load songs:', e);
    }
  }, []);

  const loadPlaylists = useCallback(async () => {
    try {
      const data = await playlistsApi.getAll();
      setPlaylists(data);
    } catch (e) {
      console.error('Failed to load playlists:', e);
    }
  }, []);

  const loadPlaylistDetail = useCallback(async (id: number) => {
    try {
      const detail = await playlistsApi.get(id);
      setSelectedPlaylist(detail);
    } catch (e) {
      console.error('Failed to load playlist:', e);
    }
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      const data = await devicesApi.getAll();
      setDevices(data);
    } catch (e) {
      console.error('Failed to load devices:', e);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      Promise.all([loadSongs(), loadPlaylists(), loadDevices()]).finally(() => setIsLoading(false));
    }
  }, [isAuthenticated, loadSongs, loadPlaylists, loadDevices]);

  const handleLogin = (password: string) => {
    if (password === STAGE_PASSWORD) {
      localStorage.setItem(AUTH_KEY, 'true');
      setIsAuthenticated(true);
      setLoginError('');
    } else {
      setLoginError('Wrong password');
    }
  };

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} error={loginError} />;
  }

  const handlePlay = useCallback(async (song: Song) => {
    // Play song via backend API
    try {
      await fetch(`${import.meta.env.DEV ? 'http://localhost:8000/api' : '/api'}/player/play/song`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ song_id: song.id }),
      });
      player.refreshState();
    } catch (e) {
      console.error('Failed to play song:', e);
    }
  }, [player]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadSongs(searchQuery);
  };

  const handleCreatePlaylist = async (name: string) => {
    await playlistsApi.create({ name });
    loadPlaylists();
  };

  const handleDeletePlaylist = async (id: number) => {
    await playlistsApi.delete(id);
    loadPlaylists();
    if (selectedPlaylist?.id === id) {
      setSelectedPlaylist(null);
    }
  };

  const handleDeleteSong = async (id: number) => {
    await songsApi.delete(id);
    loadSongs(searchQuery);
    if (player.currentSong?.id === id) {
      player.stop();
    }
  };

  const handleAddToPlaylist = async (playlistId: number, songId: number) => {
    await playlistsApi.addSongs(playlistId, [songId]);
    if (selectedPlaylist?.id === playlistId) {
      loadPlaylistDetail(playlistId);
    }
    loadPlaylists();
  };

  const handleRemoveFromPlaylist = async (songId: number) => {
    if (!selectedPlaylist) return;
    await playlistsApi.removeSongs(selectedPlaylist.id, [songId]);
    loadPlaylistDetail(selectedPlaylist.id);
    loadPlaylists();
  };

  const handleShufflePlaylist = async () => {
    if (!selectedPlaylist) return;
    await playlistsApi.shuffle(selectedPlaylist.id);
    loadPlaylistDetail(selectedPlaylist.id);
  };

  if (isLoading) {
    return (
      <div className="app loading">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="app">
      <div className="ambient-bg">
        <div className="gradient-orb orb-1" />
        <div className="gradient-orb orb-2" />
        <div className="gradient-orb orb-3" />
        <div className="gradient-orb orb-4" />
        <img src="/flamingo-silhouette.png" alt="" className="flamingo-shade" />
      </div>

      <header className="header">
        <h1>🦩 The Flamingods Stage</h1>
        <nav>
          <button
            className={view === 'songs' ? 'active' : ''}
            onClick={() => setView('songs')}
          >
            Songs
          </button>
          <button
            className={view === 'playlists' ? 'active' : ''}
            onClick={() => setView('playlists')}
          >
            Playlists
          </button>
          <button
            className={view === 'stage' ? 'active' : ''}
            onClick={() => setView('stage')}
          >
            Stage
          </button>
          <button
            className={view === 'pillar' ? 'active' : ''}
            onClick={() => setView('pillar')}
          >
            Pillar
          </button>
          <button
            className={view === 'stats' ? 'active' : ''}
            onClick={() => setView('stats')}
          >
            Stats
          </button>
          <button
            className={view === 'test' ? 'active' : ''}
            onClick={() => setView('test')}
          >
            Test
          </button>
          <button
            className={view === 'emulator' ? 'active' : ''}
            onClick={() => setView('emulator')}
          >
            Emulator
          </button>
        </nav>
      </header>

      <main className="main">
        {view === 'songs' && (
          <div className="songs-view">
            <div className="toolbar">
              <form onSubmit={handleSearch}>
                <input
                  type="text"
                  placeholder="Search songs..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                <button type="submit">Search</button>
              </form>
              <UploadButton onUploadComplete={() => loadSongs(searchQuery)} />
            </div>

            <SongTable
              songs={songs}
              currentSongId={player.currentSong?.id}
              isPlaying={player.isPlaying}
              onPlay={handlePlay}
              onTogglePlay={player.toggle}
              actions={song => (
                <>
                  <button
                    onClick={() => setModal({ type: 'editSong', song })}
                    title="Edit song"
                  >
                    Edit
                  </button>
                  <AddToPlaylistButton
                    playlists={playlists}
                    onAdd={(playlistId) => handleAddToPlaylist(playlistId, song.id)}
                    onCreateNew={() => setModal({ type: 'createPlaylist' })}
                  />
                  <button
                    onClick={() => setModal({
                      type: 'deleteSong',
                      id: song.id,
                      title: song.title,
                    })}
                  >
                    Delete
                  </button>
                </>
              )}
            />

            {songs.length === 0 && (
              <p className="empty">No songs yet. Upload some!</p>
            )}
          </div>
        )}

        {view === 'playlists' && (
          <div className="playlists-view">
            <PlaylistSidebar
              playlists={playlists}
              selectedId={selectedPlaylist?.id}
              onSelect={loadPlaylistDetail}
              onDelete={id => {
                const pl = playlists.find(p => p.id === id);
                if (pl) setModal({ type: 'deletePlaylist', id, name: pl.name });
              }}
              onCreateNew={() => setModal({ type: 'createPlaylist' })}
            />

            <div className="playlist-detail">
              {selectedPlaylist ? (
                <>
                  <div className="playlist-header">
                    <h2>{selectedPlaylist.name}</h2>
                    <button onClick={handleShufflePlaylist}>Shuffle</button>
                  </div>

                  <SongTable
                    songs={selectedPlaylist.songs}
                    currentSongId={player.currentSong?.id}
                    isPlaying={player.isPlaying}
                    onPlay={handlePlay}
                    onTogglePlay={player.toggle}
                    showAlbum={false}
                    showSize={false}
                    actions={song => (
                      <button onClick={() => handleRemoveFromPlaylist(song.id)}>
                        Remove
                      </button>
                    )}
                  />

                  {selectedPlaylist.songs.length === 0 && (
                    <p className="empty">
                      Playlist is empty. Add songs from the Songs tab.
                    </p>
                  )}
                </>
              ) : (
                <p className="empty">Select a playlist</p>
              )}
            </div>
          </div>
        )}

        {view === 'stage' && (
          <StageControl
            onOpenDeviceModal={() => setModal({ type: 'addDevice' })}
            onOpenSequenceModal={(sequence) => setModal({ type: 'editSequence', sequence })}
            refreshKey={stageRefreshKey}
          />
        )}

        {view === 'stats' && <StatsPage />}
        {view === 'pillar' && <PillarPage />}
        {view === 'test' && <ButtonTestPage />}
        {view === 'emulator' && <StageEmulator />}
      </main>

      {player.currentSong && (
        <Player
          song={player.currentSong}
          playlistName={player.playlistName}
          isPlaying={player.isPlaying}
          currentTime={player.currentTime}
          duration={player.duration}
          volume={player.volume}
          onTogglePlay={player.toggle}
          onPrev={player.prev}
          onNext={player.next}
          onSeek={player.seek}
          onVolumeChange={player.setVolume}
        />
      )}

      {modal.type === 'createPlaylist' && (
        <PromptModal
          title="New Playlist"
          label="Playlist name"
          placeholder="My awesome playlist"
          submitText="Create"
          onSubmit={handleCreatePlaylist}
          onClose={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'deletePlaylist' && (
        <ConfirmModal
          title="Delete Playlist"
          message={`Are you sure you want to delete "${modal.name}"? This cannot be undone.`}
          confirmText="Delete"
          onConfirm={() => handleDeletePlaylist(modal.id)}
          onClose={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'deleteSong' && (
        <ConfirmModal
          title="Delete Song"
          message={`Are you sure you want to delete "${modal.title}"? The file will be permanently removed.`}
          confirmText="Delete"
          onConfirm={() => handleDeleteSong(modal.id)}
          onClose={() => setModal({ type: 'none' })}
        />
      )}

      {modal.type === 'addDevice' && (
        <AddDeviceModal
          onClose={() => setModal({ type: 'none' })}
          onSave={() => {
            loadDevices();
            setStageRefreshKey(k => k + 1);
          }}
        />
      )}

      {modal.type === 'editSequence' && (
        <SequenceModal
          devices={devices}
          sequence={modal.sequence}
          onClose={() => setModal({ type: 'none' })}
          onSave={() => setStageRefreshKey(k => k + 1)}
        />
      )}

      {modal.type === 'editSong' && (
        <MusicEditor
          song={modal.song}
          onClose={() => setModal({ type: 'none' })}
          onSave={() => loadSongs(searchQuery)}
        />
      )}
    </div>
  );
}
