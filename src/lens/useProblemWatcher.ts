import {useEffect, type RefObject} from 'react';
import {Toast} from '@wearables-ui-toolkit/mrbd';
import type {ARStage} from '../ar/arStage';
import {edgeDensity, frameDifference, type GrayFrame} from '../ar/tracker';
import {captureFrame, requestScan, ScanError} from '../camera';
import type {Found} from './types';

/** How often the camera view is checked for a new problem. */
const WATCH_MS = 700;
/** Never send frames for recognition more often than this. */
const MIN_REQUEST_GAP_MS = 6000;
/** Wait this long after a failed request before trying again. */
const ERROR_BACKOFF_MS = 15000;

/**
 * Watches the camera for a steady, text-like view and only then asks for
 * recognition, so the model is called rarely. Runs only while a camera is on
 * and no problem is showing.
 */
export function useProblemWatcher(
  stream: MediaStream | null,
  found: Found | null,
  stageRef: RefObject<ARStage | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  onFound: (found: Found) => void,
) {
  useEffect(() => {
    if (!stream || found) return;
    const controller = new AbortController();
    let previous: GrayFrame | null = null;
    let rejected: GrayFrame | null = null;
    let steady = 0;
    let nextAllowed = 0;
    let busy = false;
    let stopped = false;

    const check = async () => {
      const stage = stageRef.current;
      const video = videoRef.current;
      if (busy || stopped || document.hidden || !stage || !video) return;
      const frame = stage.snapshot();
      if (!frame) return;

      const motion = previous ? frameDifference(previous, frame) : Infinity;
      previous = frame;
      steady = motion < 6 ? steady + 1 : 0;
      if (steady < 2) return;
      if (edgeDensity(frame) < 0.05) return;
      if (rejected && frameDifference(rejected, frame) < 10) return;
      if (Date.now() < nextAllowed) return;

      const image = captureFrame(video);
      if (!image) return;
      busy = true;
      nextAllowed = Date.now() + MIN_REQUEST_GAP_MS;
      try {
        const scan = await requestScan({image}, controller.signal);
        if (scan.found && scan.steps.length > 0) onFound({scan, snapshot: frame, source: 'camera'});
        else rejected = frame;
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ScanError && error.fatal) {
          stopped = true;
          Toast.show(error.message);
        } else {
          nextAllowed = Date.now() + ERROR_BACKOFF_MS;
        }
      } finally {
        busy = false;
      }
    };

    const timer = window.setInterval(() => void check(), WATCH_MS);
    return () => {
      window.clearInterval(timer);
      controller.abort();
    };
  }, [stream, found, stageRef, videoRef, onFound]);
}
