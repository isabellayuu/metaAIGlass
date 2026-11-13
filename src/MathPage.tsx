import {useEffect, useRef, useState} from 'react';
import {
  Button,
  ButtonRail,
  Page,
  Panel,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
  Toast,
} from '@wearables-ui-toolkit/mrbd';
import type {Scan, ScanHighlight} from '../server/schema';
import type {GrayFrame} from './ar/tracker';
import {CameraStage, type CameraStageHandle} from './CameraStage';
import {captureFrame, requestScan, useCamera} from './camera';
import {DiagramCanvas} from './DiagramCanvas';
import {PALETTE} from './diagram';
import {FLAT_STEPS, type Diagram, type TextRun} from './problems';

interface ViewStep {
  label: string;
  text: readonly TextRun[];
  hints: readonly string[];
  diagram?: Diagram;
  diagramLabel?: string;
  highlight?: ScanHighlight;
}

type ScanStatus =
  | {kind: 'idle'}
  | {kind: 'scanning'}
  | {kind: 'done'; scan: Scan; snapshot: GrayFrame | null}
  | {kind: 'notfound'}
  | {kind: 'error'; message: string};

function scanSteps(scan: Scan): ViewStep[] {
  return scan.steps.map(s => ({
    label: s.label,
    hints: s.hints,
    highlight: s.highlight,
    text: s.text.map(r => (r.color === 'none' ? r.t : ([r.t, r.color] as const))),
  }));
}

function StepText({runs}: {runs: readonly TextRun[]}) {
  return (
    <TextView as="p" textStyle={TextStyle.BODY2_EMPHASIZED}>
      {runs.map((run, i) =>
        typeof run === 'string' ? (
          <span key={i}>{run}</span>
        ) : (
          <span key={i} className="quantity" style={{color: PALETTE[run[1]]}}>
            {run[0]}
          </span>
        ),
      )}
    </TextView>
  );
}

export function MathPage() {
  const camera = useCamera();
  const cameraOn = camera.state.status === 'on';
  const stageRef = useRef<CameraStageHandle>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [lessonIndex, setLessonIndex] = useState(0);
  const [scanIndex, setScanIndex] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);
  const [scanStatus, setScanStatus] = useState<ScanStatus>({kind: 'idle'});

  useEffect(() => () => abortRef.current?.abort(), []);

  const scanned = scanStatus.kind === 'done' ? scanStatus.scan : null;
  const steps: readonly ViewStep[] = scanned ? scanSteps(scanned) : [];
  const step: ViewStep | undefined = cameraOn ? steps[scanIndex] : FLAT_STEPS[lessonIndex].step;
  const lesson = FLAT_STEPS[lessonIndex];
  const hasSteps = step !== undefined;
  const allHintsShown = !step || hintsShown >= step.hints.length;

  const resetHints = () => setHintsShown(0);

  const handlePrevious = () => {
    resetHints();
    if (cameraOn) setScanIndex(i => (i - 1 + steps.length) % steps.length);
    else setLessonIndex(i => (i - 1 + FLAT_STEPS.length) % FLAT_STEPS.length);
  };
  const handleNext = () => {
    resetHints();
    if (cameraOn) setScanIndex(i => (i + 1) % steps.length);
    else setLessonIndex(i => (i + 1) % FLAT_STEPS.length);
  };
  const handleHint = () => setHintsShown(allHintsShown ? 0 : hintsShown + 1);

  const leaveCamera = () => {
    abortRef.current?.abort();
    setScanStatus({kind: 'idle'});
    camera.stop();
    resetHints();
  };

  // Camera mode is a history entry, so the system Back (Esc in the simulator)
  // returns to the lessons instead of leaving the app.
  useEffect(() => {
    if (camera.state.status !== 'on') return;
    if ((history.state as {mode?: string} | null)?.mode !== 'camera') {
      history.pushState({mode: 'camera'}, '');
    }
    const onPop = () => leaveCamera();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') history.back();
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('keydown', onKey);
    };
  }, [camera.state.status]);

  const handleLens = () => {
    if (cameraOn) void handleScan();
    else if (camera.state.status !== 'starting') void camera.start();
  };

  const handleScan = async () => {
    if (scanStatus.kind === 'scanning') return;
    const video = stageRef.current?.video;
    const image = video ? captureFrame(video) : null;
    if (!image) {
      setScanStatus({kind: 'error', message: 'The camera has no picture yet.'});
      return;
    }
    const snapshot = stageRef.current?.snapshot() ?? null;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setScanStatus({kind: 'scanning'});
    try {
      const scan = await requestScan(image, controller.signal);
      if (!scan.found || scan.steps.length === 0) {
        setScanStatus({kind: 'notfound'});
        return;
      }
      setScanIndex(0);
      resetHints();
      setScanStatus({kind: 'done', scan, snapshot});
      Toast.show('Problem found');
    } catch (error) {
      if (controller.signal.aborted) return;
      setScanStatus({kind: 'error', message: error instanceof Error ? error.message : 'Scan failed.'});
    }
  };

  const status = (() => {
    if (camera.state.status === 'starting') return 'Starting the camera…';
    if (camera.state.status === 'error') return camera.state.message;
    if (!cameraOn) return null;
    switch (scanStatus.kind) {
      case 'idle':
        return 'Hold a math problem in view, then scan it. Press Back to return to the lessons.';
      case 'scanning':
        return 'Reading the problem…';
      case 'notfound':
        return 'No math problem found. Move closer and try again.';
      case 'error':
        return scanStatus.message;
      default:
        return null;
    }
  })();

  const headerText = cameraOn ? 'Math lens' : lesson.problem.title;
  const headerMetadata = cameraOn
    ? step
      ? `${step.label} ${scanIndex + 1}/${steps.length}`
      : scanStatus.kind === 'scanning'
        ? 'Reading'
        : 'Live'
    : `${lesson.step.label} ${lesson.stepIndex + 1}/${lesson.problem.steps.length}`;

  const lessonIsLast = lessonIndex === FLAT_STEPS.length - 1;
  const lessonEndsProblem = lesson.stepIndex === lesson.problem.steps.length - 1;
  const nextTitle = cameraOn
    ? 'Next'
    : lessonIsLast
      ? 'Restart'
      : lessonEndsProblem
        ? 'New problem'
        : 'Next';
  const hintTitle = allHintsShown && hintsShown > 0 ? 'Hide hints' : hintsShown === 0 ? 'Hint' : 'More';
  const lensTitle = !cameraOn
    ? camera.state.status === 'starting'
      ? 'Starting'
      : 'Camera'
    : scanStatus.kind === 'scanning'
      ? 'Reading'
      : scanned
        ? 'Rescan'
        : 'Scan';

  return (
    <Page headerText={headerText} headerMetadata={headerMetadata} enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader tabIndex={0} ariaLabel={step ? `${step.label} step` : 'Camera view'}>
          <Panel width="100%">
            <div className="content-inset">
              {cameraOn && camera.state.status === 'on' && (
                <CameraStage
                  ref={stageRef}
                  stream={camera.state.stream}
                  scan={scanned}
                  snapshot={scanStatus.kind === 'done' ? scanStatus.snapshot : null}
                  highlight={step?.highlight ?? 'none'}
                  label={
                    scanned
                      ? `3D model of the problem: ${scanned.problem_text}`
                      : 'Live camera view'
                  }
                />
              )}
              {status && (
                <TextView as="p" textStyle={TextStyle.BODY2} aria-live="polite">
                  {status}
                </TextView>
              )}
              {step && <StepText runs={step.text} />}
              {step && hintsShown > 0 && (
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
              {!cameraOn && step?.diagram && (
                <DiagramCanvas diagram={step.diagram} label={step.diagramLabel ?? ''} />
              )}
            </div>
          </Panel>
        </ScrollView>
        <div className="action-dock">
          <ButtonRail>
            <Button title={lensTitle} onClick={handleLens} />
            <Button title="Previous" onClick={handlePrevious} disabled={!hasSteps} />
            <Button title={hintTitle} onClick={handleHint} disabled={!hasSteps} />
            <Button title={nextTitle} onClick={handleNext} disabled={!hasSteps} />
          </ButtonRail>
        </div>
      </div>
    </Page>
  );
}
