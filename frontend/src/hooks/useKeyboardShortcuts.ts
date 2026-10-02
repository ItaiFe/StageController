import { useEffect } from 'react';

interface Shortcuts {
  onTogglePlay?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  onSeekForward?: () => void;
  onSeekBackward?: () => void;
  onVolumeUp?: () => void;
  onVolumeDown?: () => void;
}

export function useKeyboardShortcuts(shortcuts: Shortcuts) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          shortcuts.onTogglePlay?.();
          break;
        case 'ArrowRight':
          if (e.shiftKey) {
            shortcuts.onNext?.();
          } else {
            shortcuts.onSeekForward?.();
          }
          break;
        case 'ArrowLeft':
          if (e.shiftKey) {
            shortcuts.onPrev?.();
          } else {
            shortcuts.onSeekBackward?.();
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          shortcuts.onVolumeUp?.();
          break;
        case 'ArrowDown':
          e.preventDefault();
          shortcuts.onVolumeDown?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts]);
}
