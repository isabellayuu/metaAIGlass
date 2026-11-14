import {useEffect, useRef, useState} from 'react';
import switchIcon from '@wearables-ui-toolkit/icons/svg/switchright__filled.svg';
import {
  Button,
  type ButtonHandle,
  ButtonRail,
  Page,
  Panel,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
  Toast,
} from '@wearables-ui-toolkit/mrbd';
import type {Scan} from '../server/schema';
import type {ARStage} from './ar/arStage';
import {edgeDensity, frameDifference, type GrayFrame} from './ar/tracker';
import {captureFrame, requestScan, ScanError, useCamera} from './camera';
import {PALETTE, type TextRun} from './palette';

/** How often the camera view is checked for a new problem. */
const WATCH_MS = 700;
/** Never send frames for recognition more often than this. */
const MIN_REQUEST_GAP_MS = 6000;
/** Wait this long after a failed request before trying again. */
const ERROR_BACKOFF_MS = 15000;
/** Forget a problem that has been out of view this long. */
const FORGET_AFTER_MS = 8000;

/**
 * The camera feed is shown full screen, like looking through the glasses, with
 * the visualizer drawn on top. On real see-through glasses the world is already
 * visible, so ?glasses=1 hides the feed and draws only the overlay.
 */
const SHOW_VIDEO = !new URLSearchParams(location.search).has('glasses');

interface Found {
  scan: Scan;
  snapshot: GrayFrame;
}

function toRuns(text: Scan['steps'][number]['text']): TextRun[] {
  return text.map(r => (r.color === 'none' ? r.t : ([r.t, r.color] as const)));
}

function StepText({runs}: {runs: readonly TextRun[]}) {
  return (
    <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
      {runs.map((run, i) =>
        typeof run === 'string' ? (
          <span key={i}>{run}</span>
        ) : (
          <span key={i} style={{color: PALETTE[run[1]]}}>
            {run[0]}
          </span>
        ),
      )}
    </TextView>
  );
}

/**
 * Shows nothing until the camera sees a math problem. Then it tethers a 3D
 * model above the problem and offers the solution steps; when the problem
 * leaves the view, everything disappears again.
 */
export function LensApp() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<ARStage | null>(null);
  const toggleRef = useRef<ButtonHandle>(null);
  /** The wearer can switch the visualizer off; it starts on. */
  const [enabled, setEnabled] = useState(true);

  const [found, setFound] = useState<Found | null>(null);
  const [inView, setInView] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);

  // Watch whenever the visualizer is on; release the camera when it is off.
  useEffect(() => {
    if (enabled) void camera.start();
    else camera.stop();
  }, [enabled, camera.start, camera.stop]);

  // If the camera can't start, show the visualizer as off. Explain why only
  // when the wearer asked for it, not unprompted at launch.
  const userStarted = useRef(false);
  useEffect(() => {
    if (camera.state.status !== 'error') return;
    if (userStarted.current) Toast.show(camera.state.message);
    setEnabled(false);
  }, [camera.state]);

  const stream = camera.state.status === 'on' ? camera.state.stream : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
  }, [stream]);

  // Three.js loads with the camera and renders nothing until a problem is
  // found. The stage is created once (a WebGL canvas can't host a second
  // renderer); turning the visualizer off pauses and clears it.
  useEffect(() => {
    if (!stream) {
      stageRef.current?.pause();
      return;
    }
    if (stageRef.current) {
      stageRef.current.start();
      return;
    }
    let cancelled = false;
    void import('./ar/arStage').then(({ARStage}) => {
      if (cancelled || !canvasRef.current || !videoRef.current || stageRef.current) return;
      const stage = new ARStage(canvasRef.current, videoRef.current);
      stage.onTracking = setInView;
      stageRef.current = stage;
      stage.start();
    });
    return () => {
      cancelled = true;
    };
  }, [stream]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) stageRef.current?.stop();
      else if (videoRef.current?.srcObject) stageRef.current?.start();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, []);

  const step = found?.scan.steps[stepIndex];

  useEffect(() => {
    stageRef.current?.setScan(found?.scan ?? null, found?.snapshot ?? null, step?.highlight ?? 'none');
  }, [found, step]);

  // Forget the problem once it has been out of view for a while, and go back
  // to watching for a new one.
  useEffect(() => {
    if (!found || inView) return;
    const timer = window.setTimeout(() => setFound(null), FORGET_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [found, inView]);

  // Watch the camera for a steady, text-like view and only then ask Claude.
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
        const scan = await requestScan(image, controller.signal);
        if (scan.found && scan.steps.length > 0) {
          setStepIndex(0);
          setHintsShown(0);
          setFound({scan, snapshot: frame});
        } else {
          rejected = frame;
        }
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
  }, [stream, found]);

  const steps = found?.scan.steps ?? [];
  const allHintsShown = !step || hintsShown >= step.hints.length;
  const showUi = found !== null && inView && step !== undefined;

  // The toggle is the one control that is always present; keep focus on it
  // when the step controls appear or disappear.
  useEffect(() => {
    toggleRef.current?.getElement()?.focus({preventScroll: true});
  }, [showUi]);

  const handleToggle = () => {
    if (enabled) {
      setFound(null);
      setInView(false);
    }
    userStarted.current = !enabled;
    setEnabled(!enabled);
  };

  const toggle = (
    <Button
      ref={toggleRef}
      icon={switchIcon}
      title={enabled ? 'Turn off' : 'Turn on'}
      showIconActiveIndicator={enabled}
      onClick={handleToggle}
    />
  );

  const goTo = (i: number) => {
    setStepIndex((i + steps.length) % steps.length);
    setHintsShown(0);
  };
  const hintTitle = allHintsShown && hintsShown > 0 ? 'Hide hints' : hintsShown === 0 ? 'Hint' : 'More';

  return (
    <div className="lens">
      <video
        ref={videoRef}
        className={SHOW_VIDEO ? 'ar-layer' : 'ar-layer ar-video-hidden'}
        muted
        playsInline
        aria-hidden="true"
      />
      <canvas
        ref={canvasRef}
        className="ar-layer"
        role="img"
        aria-label={found ? `3D model of the problem: ${found.scan.problem_text}` : 'Camera view'}
      />
      <div className="lens-ui">
        {showUi && step ? (
          <Page
            headerText={step.label}
            headerMetadata={`${stepIndex + 1}/${steps.length}`}
            enableSystemBarInset={false}>
            <div className="action-page-shell">
              <ScrollView insetForHeader tabIndex={0} ariaLabel={`${step.label} step`}>
                <Panel width="100%">
                  <div className="content-inset">
                    <StepText runs={toRuns(step.text)} />
                    {hintsShown > 0 && (
                      <div className="hints" aria-live="polite">
                        <TextView as="p" textStyle={TextStyle.LABEL} textColor={TextColor.SECONDARY}>
                          THINK ABOUT IT
                        </TextView>
                        {step.hints.slice(0, hintsShown).map(hint => (
                          <TextView key={hint} as="p" textStyle={TextStyle.BODY2}>
                            {hint}
                          </TextView>
                        ))}
                      </div>
                    )}
                  </div>
                </Panel>
              </ScrollView>
              <div className="action-dock">
                <ButtonRail>
                  {toggle}
                  <Button title="Previous" onClick={() => goTo(stepIndex - 1)} />
                  <Button
                    title={hintTitle}
                    onClick={() => setHintsShown(allHintsShown ? 0 : hintsShown + 1)}
                  />
                  <Button title="Next" onClick={() => goTo(stepIndex + 1)} />
                </ButtonRail>
              </div>
            </div>
          </Page>
        ) : (
          <div className="action-page-shell">
            <div />
            <div className="action-dock">
              <ButtonRail>{toggle}</ButtonRail>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
