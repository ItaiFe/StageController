import { useState, useEffect, useCallback, useRef } from 'react';
import type { PlayerState } from '../api';
import { playerApi } from '../api';

export function useBackendPlayer() {
  const [state, setState] = useState<PlayerState | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const newState = await playerApi.getState();
      setState(newState);
    } catch (e) {
      console.error('Failed to fetch player state:', e);
    }
  }, []);

  useEffect(() => {
    fetchState();
    // Poll every 500ms for updates
    pollIntervalRef.current = window.setInterval(fetchState, 500);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchState]);

  const toggle = useCallback(async () => {
    await playerApi.toggle();
    fetchState();
  }, [fetchState]);

  const next = useCallback(async () => {
    await playerApi.next();
    fetchState();
  }, [fetchState]);

  const prev = useCallback(async () => {
    await playerApi.prev();
    fetchState();
  }, [fetchState]);

  const seek = useCallback(async (time: number) => {
    await playerApi.seek(time);
  }, []);

  const setVolume = useCallback(async (volume: number) => {
    await playerApi.setVolume(volume);
    fetchState();
  }, [fetchState]);

  const stop = useCallback(async () => {
    await playerApi.stop();
    fetchState();
  }, [fetchState]);

  return {
    currentSong: state?.current_song || null,
    playlistName: state?.playlist_name || null,
    isPlaying: state?.is_playing || false,
    currentTime: state?.current_time || 0,
    duration: state?.duration || 0,
    volume: state?.volume || 70,
    toggle,
    next,
    prev,
    seek,
    setVolume,
    stop,
    refreshState: fetchState,
  };
}
