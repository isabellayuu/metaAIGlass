import {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import type {Scan, ScanHighlight} from '../server/schema';
import type {ARStage} from './ar/arStage';
import type {GrayFrame} from './ar/tracker';

export interface CameraStageHandle {
  video: HTMLVideoElement | null;
  /** Grey copy of the frame being sent for recognition, used to start tracking. */
  snapshot(): GrayFrame | null;
}

interface Props {
  stream: MediaStream;
  scan: Scan | null;
  snapshot: GrayFrame | null;
  highlight: ScanHighlight;
  label: string;
}

/** Live webcam view with the tethered 3D model drawn on top. */
export const CameraStage = forwardRef<CameraStageHandle, Props>(function CameraStage(
  {stream, scan, snapshot, highlight, label},
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<ARStage | null>(null);
  const latest = useRef({scan, snapshot, highlight});
  latest.current = {scan, snapshot, highlight};

  useImperativeHandle(ref, () => ({
    get video() {
      return videoRef.current;
    },
    snapshot: () => stageRef.current?.snapshot() ?? null,
  }));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [stream]);

  // Three.js loads only once the camera is on.
  useEffect(() => {
    let cancelled = false;
    let stage: ARStage | null = null;
    const onVisibility = () => (document.hidden ? stage?.stop() : stage?.start());
    void import('./ar/arStage').then(({ARStage}) => {
      if (cancelled || !canvasRef.current || !videoRef.current) return;
      stage = new ARStage(canvasRef.current, videoRef.current);
      stageRef.current = stage;
      const {scan: s, snapshot: snap, highlight: h} = latest.current;
      stage.setScan(s, snap, h);
      stage.start();
      document.addEventListener('visibilitychange', onVisibility);
    });
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      stage?.dispose();
      stageRef.current = null;
    };
  }, []);

  useEffect(() => {
    stageRef.current?.setScan(scan, snapshot, highlight);
  }, [scan, snapshot, highlight]);

  return (
    <div className="stage">
      <video ref={videoRef} className="stage-layer" muted playsInline aria-hidden="true" />
      <canvas ref={canvasRef} className="stage-layer" role="img" aria-label={label} />
    </div>
  );
});
