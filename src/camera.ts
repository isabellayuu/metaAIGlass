import {useCallback, useEffect, useRef, useState} from 'react';
import type {Scan} from '../server/schema';

export type CameraState =
  | {status: 'off'}
  | {status: 'starting'}
  | {status: 'on'; stream: MediaStream}
  | {status: 'error'; message: string};

/** Owns the webcam stream. The stream is stopped on turn-off and on unmount. */
export function useCamera() {
  const [state, setState] = useState<CameraState>({status: 'off'});
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setState({status: 'off'});
  }, []);

  const starting = useRef(false);

  const start = useCallback(async () => {
    if (starting.current || streamRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        status: 'error',
        message: 'No camera here. Open the app in Chrome on a laptop or phone.',
      });
      return;
    }
    setState({status: 'starting'});
    starting.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {facingMode: 'environment', width: {ideal: 1280}, height: {ideal: 720}},
        audio: false,
      });
      streamRef.current = stream;
      setState({status: 'on', stream});
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      setState({
        status: 'error',
        message:
          name === 'NotAllowedError'
            ? 'Camera access was blocked. Allow it in the browser, then try again.'
            : name === 'NotFoundError'
              ? 'No camera was found.'
              : 'The camera could not start.',
      });
    } finally {
      starting.current = false;
    }
  }, []);

  useEffect(() => () => streamRef.current?.getTracks().forEach(t => t.stop()), []);

  return {state, start, stop};
}

/** JPEG of the current video frame, longest side at most 1280 px, base64 without prefix. */
export function captureFrame(video: HTMLVideoElement): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, 1280 / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? null;
}

export class ScanError extends Error {
  /** True when retrying cannot help, such as a missing API key. */
  readonly fatal: boolean;
  constructor(message: string, fatal: boolean) {
    super(message);
    this.fatal = fatal;
  }
}

/** Ask the server to recognize a camera frame ({image}) or a typed/dictated problem ({text}). */
export async function requestScan(
  input: {image: string} | {text: string},
  signal: AbortSignal,
): Promise<Scan> {
  const res = await fetch('/api/recognize', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(input),
    signal,
  });
  const body = (await res.json().catch(() => ({}))) as Scan & {error?: string};
  if (!res.ok) {
    throw new ScanError(body.error ?? `Request failed (${res.status})`, res.status === 401 || res.status === 404);
  }
  return body;
}
