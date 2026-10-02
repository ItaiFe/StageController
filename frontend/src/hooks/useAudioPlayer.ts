import { useState, useRef, useEffect, useCallback } from 'react';
import type { Song } from '../api';
import { songsApi, statsApi } from '../api';

const API_BASE = import.meta.env.DEV ? 'http://localhost:8000/api' : '/api';

const VOLUME_KEY = 'stagecontroller_volume';

export function useAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const overlayRef = useRef<HTMLAudioElement | null>(null);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [queue, setQueue] = useState<Song[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem(VOLUME_KEY);
    return saved ? parseFloat(saved) : 0.7;
  });
  const [playlistName, setPlaylistName] = useState<string | null>(null);
  const hasPlayedRef = useRef(false);

  useEffect(() => {
    audioRef.current = new Audio();
    overlayRef.current = new Audio();
    const audio = audioRef.current;

    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime);
      if (audio.currentTime > 0.5) hasPlayedRef.current = true;
    });
    audio.addEventListener('loadedmetadata', () => setDuration(audio.duration));
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));

    return () => {
      audio.pause();
      audio.src = '';
      if (overlayRef.current) {
        overlayRef.current.pause();
        overlayRef.current.src = '';
      }
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      localStorage.setItem(VOLUME_KEY, String(volume));
    }
    if (overlayRef.current) {
      overlayRef.current.volume = volume;
    }
  }, [volume]);

  const play = useCallback((song: Song, songs: Song[], index?: number, playlist?: string) => {
    const idx = index ?? songs.findIndex(s => s.id === song.id);
    setQueue(songs);
    setCurrentIndex(idx);
    setCurrentSong(song);
    hasPlayedRef.current = false;
    if (playlist !== undefined) {
      setPlaylistName(playlist);
    }

    if (audioRef.current) {
      audioRef.current.src = songsApi.getStreamUrl(song.id);
      audioRef.current.play().catch((e) => {
        console.warn('Autoplay blocked, click play to start:', e.message);
      });
    }
  }, []);

  const togglePlay = useCallback(() => {
    if (!audioRef.current || !currentSong) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  }, [isPlaying, currentSong]);

  const prev = useCallback(() => {
    if (queue.length === 0) return;
    const newIndex = currentIndex <= 0 ? queue.length - 1 : currentIndex - 1;
    play(queue[newIndex], queue, newIndex);
  }, [queue, currentIndex, play]);

  const next = useCallback((recordSkip = true) => {
    if (queue.length === 0) return;
    // Record skip stat for current song
    if (recordSkip && currentSong) {
      statsApi.record(currentSong.id, 'skipped').catch(console.error);
    }
    const newIndex = currentIndex >= queue.length - 1 ? 0 : currentIndex + 1;
    play(queue[newIndex], queue, newIndex);
  }, [queue, currentIndex, currentSong, play]);

  const seek = useCallback((time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  }, []);

  const stop = useCallback((recordStopped = true) => {
    // Record stopped stat for current song
    if (recordStopped && currentSong) {
      statsApi.record(currentSong.id, 'stopped').catch(console.error);
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setCurrentSong(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setQueue([]);
    setCurrentIndex(-1);
  }, [currentSong]);

  const endShow = useCallback(async (recordStopped = false, notifyBackend = true) => {
    // Record stopped stat if this was a manual stop (not song completion)
    if (recordStopped && currentSong) {
      statsApi.record(currentSong.id, 'stopped').catch(console.error);
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    // Advance to next song index but don't clear queue
    setCurrentIndex(prev => prev + 1);
    setCurrentSong(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    if (notifyBackend) {
      try {
        await fetch(`${API_BASE}/buttons/end`, { method: 'POST' });
      } catch (e) {
        console.error('Failed to end show:', e);
      }
    }
  }, [currentSong]);

  // Set up ended event listener - when song ends naturally, stop show and notify backend
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleEnded = async () => {
      // Only handle if song actually played past the first half second
      if (hasPlayedRef.current) {
        const songId = currentSong?.id;
        if (songId) {
          statsApi.record(songId, 'completed').catch(console.error);
        }
        hasPlayedRef.current = false;
        // Song ended naturally - notify backend to turn off devices
        endShow(false, true);
      }
    };

    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('ended', handleEnded);
    };
  }, [endShow, currentSong]);

  const resume = useCallback(() => {
    if (queue.length === 0) return false;
    // If we've gone past the end, loop back and reshuffle would happen on start
    const idx = currentIndex >= queue.length ? 0 : currentIndex;
    if (queue[idx]) {
      play(queue[idx], queue, idx);
      return true;
    }
    return false;
  }, [queue, currentIndex, play]);

  const playOverlay = useCallback((song: Song) => {
    if (overlayRef.current) {
      overlayRef.current.src = songsApi.getStreamUrl(song.id);
      overlayRef.current.volume = volume;
      overlayRef.current.play();
    }
  }, [volume]);

  return {
    currentSong,
    queue,
    currentIndex,
    playlistName,
    isPlaying,
    currentTime,
    duration,
    volume,
    setVolume,
    play,
    togglePlay,
    prev,
    next,
    seek,
    stop,
    endShow,
    resume,
    playOverlay,
  };
}
