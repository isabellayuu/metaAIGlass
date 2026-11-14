import {useCallback, useEffect, useRef, useState} from 'react';
import switchIcon from '@wearables-ui-toolkit/icons/svg/switchright__filled.svg';
import {Button, type ButtonHandle, Toast} from '@wearables-ui-toolkit/mrbd';
import {requestScan, useCamera} from './camera';
import {IdleView} from './lens/IdleView';
import {StepPage} from './lens/StepPage';
import type {Found, TextStatus} from './lens/types';
import {useArStage} from './lens/useArStage';
import {useProblemWatcher} from './lens/useProblemWatcher';
import {useMathLensTools} from './webmcp';

/** Forget a camera-found problem that has been out of view this long. */
const FORGET_AFTER_MS = 8000;

/**
 * The camera feed is shown full screen, like looking through the glasses, with
 * the visualizer drawn on top. On real see-through glasses the world is already
 * visible, so ?glasses=1 hides the feed and draws only the overlay.
 */
const SHOW_VIDEO = !new URLSearchParams(location.search).has('glasses');

/**
 * Shows nothing until a math problem is found. Where a camera is available it
 * watches for one and tethers a 3D model above it. On the glasses (web apps
 * get no camera) the problem comes from Meta AI via WebMCP, or is dictated or
 * handwritten into the field, and the model sits mid-screen.
 */
export function LensApp() {
  const camera = useCamera();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const toggleRef = useRef<ButtonHandle>(null);

  /** Camera watching; the wearer can switch it off. */
  const [enabled, setEnabled] = useState(true);
  const [found, setFound] = useState<Found | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);
  const [textStatus, setTextStatus] = useState<TextStatus>({kind: 'idle'});
  const [draft, setDraft] = useState('');
  const textAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (enabled) void camera.start();
    else camera.stop();
  }, [enabled, camera.start, camera.stop]);

  // If the camera can't start (as on the glasses), show watching as off.
  // Explain why only when the wearer asked for it, not at launch.
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

  const steps = found?.scan.steps ?? [];
  const step = found ? steps[stepIndex] : undefined;

  const {stageRef, inView, setInView} = useArStage(
    canvasRef,
    videoRef,
    Boolean(stream) || found !== null,
    found,
    step?.highlight ?? 'none',
  );

  const show = useCallback((next: Found) => {
    setStepIndex(0);
    setHintsShown(0);
    setFound(next);
  }, []);
  useProblemWatcher(stream, found, stageRef, videoRef, show);

  // Forget a camera-found problem once it has been out of view for a while.
  useEffect(() => {
    if (!found || found.source !== 'camera' || inView) return;
    const timer = window.setTimeout(() => setFound(null), FORGET_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [found, inView]);

  const showUi = found !== null && step !== undefined && (found.source === 'text' || inView);

  // Keep focus on the always-present control when the step controls come and go.
  useEffect(() => {
    toggleRef.current?.getElement()?.focus({preventScroll: true});
  }, [showUi]);

  /** Build the steps for a problem given as text (Meta AI, dictation or handwriting). */
  const submitText = async (text: string) => {
    textAbort.current?.abort();
    const controller = new AbortController();
    textAbort.current = controller;
    setTextStatus({kind: 'working'});
    try {
      const scan = await requestScan({text}, controller.signal);
      if (!scan.found || scan.steps.length === 0) {
        setTextStatus({kind: 'error', message: 'That doesn’t look like a math problem. Try again.'});
        return;
      }
      show({scan, snapshot: null, source: 'text'});
      setTextStatus({kind: 'idle'});
      setDraft('');
    } catch (error) {
      if (controller.signal.aborted) return;
      setTextStatus({kind: 'error', message: error instanceof Error ? error.message : 'Something went wrong.'});
    }
  };

  const clearProblem = () => {
    textAbort.current?.abort();
    setFound(null);
    setInView(false);
    setTextStatus({kind: 'idle'});
  };

  /** Show step i (wrapping) and return its index. */
  const goTo = (i: number) => {
    if (steps.length === 0) return 0;
    const next = (i + steps.length) % steps.length;
    setStepIndex(next);
    setHintsShown(0);
    return next;
  };

  const describeStep = (i: number) => {
    const s = steps[i];
    return s && {number: i + 1, total: steps.length, label: s.label, text: s.text.map(r => r.t).join('')};
  };

  const handleToggle = () => {
    if (enabled) clearProblem();
    userStarted.current = !enabled;
    setEnabled(!enabled);
  };

  useMathLensTools({
    state: () => ({
      status: textStatus.kind === 'working' ? 'working' : showUi ? 'showing' : 'idle',
      problem: found?.scan.problem_text,
      step: describeStep(stepIndex),
      hintsShown: step ? step.hints.slice(0, hintsShown) : [],
      hintsLeft: step ? Math.max(0, step.hints.length - hintsShown) : 0,
      lastError: textStatus.kind === 'error' ? textStatus.message : undefined,
    }),
    showProblem: text => void submitText(text),
    step: direction =>
      describeStep(direction === 'first' ? goTo(0) : goTo(stepIndex + (direction === 'next' ? 1 : -1))),
    hint: () => {
      if (!step || hintsShown >= step.hints.length) return null;
      setHintsShown(hintsShown + 1);
      return step.hints[hintsShown];
    },
    clear: clearProblem,
  });

  // A typed or spoken problem has no camera to watch, so the always-present
  // control clears it instead; otherwise it switches camera watching on/off.
  const lead =
    found?.source === 'text' ? (
      <Button ref={toggleRef} title="New problem" onClick={clearProblem} />
    ) : (
      <Button
        ref={toggleRef}
        icon={switchIcon}
        title={enabled ? 'Turn off' : 'Turn on'}
        showIconActiveIndicator={enabled}
        onClick={handleToggle}
      />
    );

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
          <StepPage
            step={step}
            index={stepIndex}
            total={steps.length}
            hintsShown={hintsShown}
            lead={lead}
            onPrevious={() => goTo(stepIndex - 1)}
            onHint={() => setHintsShown(hintsShown >= step.hints.length ? 0 : hintsShown + 1)}
            onNext={() => goTo(stepIndex + 1)}
          />
        ) : (
          <IdleView
            lead={lead}
            showComposer={!stream}
            draft={draft}
            status={textStatus}
            onDraftChange={setDraft}
            onSubmit={text => void submitText(text)}
          />
        )}
      </div>
    </div>
  );
}
