import { useRef } from 'react';

// Overlay props that close only on a genuine backdrop click. A press that starts inside
// the dialog and is released over the backdrop (e.g. a drag or text selection) is ignored.
export function useOverlayDismiss(onClose: () => void) {
  const pressedOnOverlay = useRef(false);
  return {
    onMouseDown: (e: React.MouseEvent) => {
      pressedOnOverlay.current = e.target === e.currentTarget;
    },
    onClick: (e: React.MouseEvent) => {
      if (pressedOnOverlay.current && e.target === e.currentTarget) onClose();
      pressedOnOverlay.current = false;
    },
  };
}
