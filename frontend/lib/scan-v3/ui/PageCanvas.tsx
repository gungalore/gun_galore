import { useEffect, useMemo, useRef, type ReactElement } from 'react';
import { resizeImageData } from '../pipeline/decode';

/** Draws ImageData into a canvas, downscaled for the screen. */
export function PageCanvas({ image, maxEdge = 1400, className }: { image: ImageData; maxEdge?: number; className?: string }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const small = useMemo(() => resizeImageData(image, maxEdge), [image, maxEdge]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = small.width;
    c.height = small.height;
    c.getContext('2d')?.putImageData(small, 0, 0);
  }, [small]);
  return <canvas ref={ref} className={className} style={{ aspectRatio: `${small.width} / ${small.height}` }} />;
}
