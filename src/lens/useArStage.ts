import {useEffect, useRef, useState, type RefObject} from 'react';
import type {ScanHighlight} from '../../server/schema';
import type {ARStage} from '../ar/arStage';
import type {Found} from './types';

/**
 * Owns the 3D stage. It is created once and runs only while there is a camera
 * to watch or a model to show.
 * The renderer loads on demand, only when first needed.
 */
export function useArStage(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  active: boolean,
  found: Found | null,
  highlight: ScanHighlight,
) {
  const stageRef = useRef<ARStage | null>(null);
  const [ready, setReady] = useState(false);
  /** True while a camera-found problem is in view (always true for text problems). */
  const [inView, setInView] = useState(false);

  // Load the 3D renderer only once there is a camera to watch or a model to show,
  // so it never weighs on startup.
  const loading = useRef(false);
  useEffect(() => {
    if (!active || stageRef.current || loading.current) return;
    loading.current = true;
    void import('../ar/arStage').then(({ARStage}) => {
      loading.current = false;
      if (!mounted.current || !canvasRef.current || !videoRef.current || stageRef.current) return;
      const stage = new ARStage(canvasRef.current, videoRef.current);
      stage.onTracking = setInView;
      stageRef.current = stage;
      setReady(true);
    });
  }, [active, canvasRef, videoRef]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, []);

  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (active) stage.start();
    else stage.pause();
  }, [active, ready]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stageRef.current?.stop();
      else if (activeRef.current) stageRef.current?.start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    stageRef.current?.setScan(found?.scan ?? null, found?.snapshot ?? null, highlight);
  }, [found, highlight, ready]);

  return {stageRef, inView, setInView};
}
