import { useEffect, useRef } from 'react';
import { PIXEL_COUNT } from '../../pillar/types';
import type { Strip } from '../../pillar/types';

interface Props {
  strip: Strip;
  orientation: 'horizontal' | 'vertical';
  /** Scale colours by this factor, e.g. 80/255 to mimic the pillar's brightness cap */
  dim?: number;
  className?: string;
}

/** Draws a 100-LED strip; LED 1 (index 0) is on the left, or at the bottom when vertical. */
export function StripCanvas({ strip, orientation, dim = 1, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const vertical = orientation === 'vertical';

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = vertical ? 1 : PIXEL_COUNT;
    const h = vertical ? PIXEL_COUNT : 1;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const img = ctx.createImageData(w, h);
    for (let i = 0; i < PIXEL_COUNT; i++) {
      // Canvas y grows downward, so a vertical strip draws LED 1 at the bottom
      const o = (vertical ? PIXEL_COUNT - 1 - i : i) * 4;
      img.data[o] = strip[i * 3] * dim;
      img.data[o + 1] = strip[i * 3 + 1] * dim;
      img.data[o + 2] = strip[i * 3 + 2] * dim;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [strip, vertical, dim]);

  // One canvas pixel per LED, stretched by CSS with crisp edges
  return <canvas ref={ref} className={`strip-canvas ${className ?? ''}`} />;
}
