import { useEffect, useRef, useCallback } from 'react';
import { playlistsApi } from '../api';
import type { Song } from '../api';

const WS_URL = import.meta.env.DEV ? 'ws://localhost:8000/api/buttons/ws' : `ws://${window.location.host}/api/buttons/ws`;

interface ButtonEvent {
  action: 'start' | 'stop' | 'skip' | 'claps' | 'special';
  timestamp: string;
  playlist_id?: number;
  playlist_name?: string;
  overlay_song_id?: number;
}

interface UseButtonEventsProps {
  onStart: (songs: Song[], playlistName: string) => void;
  onStop: () => void;
  onSkip: () => void;
  onOverlay: (songId: number) => void;
}

export function useButtonEvents({ onStart, onStop, onSkip, onOverlay }: UseButtonEventsProps) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log('Button events WebSocket connected');
    };

    ws.onmessage = async (event) => {
      try {
        const data: ButtonEvent = JSON.parse(event.data);
        console.log('Button event:', data);

        switch (data.action) {
          case 'start':
            console.log('WS: start received, playlist_id:', data.playlist_id);
            if (data.playlist_id) {
              const playlist = await playlistsApi.get(data.playlist_id);
              console.log('WS: playlist loaded, songs:', playlist.songs.length);
              if (playlist.songs.length > 0) {
                onStart(playlist.songs, playlist.name);
              }
            }
            break;
          case 'stop':
            console.log('WS: stop received');
            onStop();
            break;
          case 'skip':
            console.log('WS: skip received');
            onSkip();
            break;
          case 'claps':
          case 'special':
            console.log('WS: overlay received, song_id:', data.overlay_song_id);
            if (data.overlay_song_id) {
              onOverlay(data.overlay_song_id);
            }
            break;
        }
      } catch (e) {
        console.error('Failed to parse button event:', e);
      }
    };

    ws.onclose = () => {
      console.log('Button events WebSocket closed, reconnecting...');
      reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
    };

    ws.onerror = (e) => {
      console.error('Button events WebSocket error:', e);
      ws.close();
    };

    wsRef.current = ws;
  }, [onStart, onStop, onSkip, onOverlay]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);
}
