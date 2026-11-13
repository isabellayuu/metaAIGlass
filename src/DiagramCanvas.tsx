import {useEffect, useRef} from 'react';
import {drawDiagram} from './diagram';
import type {Diagram} from './problems';

interface Props {
  diagram: Diagram;
  label: string;
}

/**
 * Canvas sized from its container. It redraws only when the diagram or the
 * available size changes — there is no animation loop.
 */
export function DiagramCanvas({diagram, label}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;

    const render = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const font = getComputedStyle(canvas).fontFamily || 'sans-serif';
      drawDiagram(g, rect.width, rect.height, diagram, font);
    };

    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [diagram]);

  return <canvas ref={ref} className="diagram" role="img" aria-label={label} />;
}
