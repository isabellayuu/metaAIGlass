import {useState} from 'react';
import {
  Button,
  ButtonRail,
  Page,
  Panel,
  ScrollView,
  TextColor,
  TextStyle,
  TextView,
} from '@wearables-ui-toolkit/mrbd';
import {DiagramCanvas} from './DiagramCanvas';
import {PALETTE} from './diagram';
import {FLAT_STEPS, type TextRun} from './problems';

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
  const [index, setIndex] = useState(0);
  const [hintsShown, setHintsShown] = useState(0);

  const current = FLAT_STEPS[index];
  const {problem, step, stepIndex} = current;
  const isLast = index === FLAT_STEPS.length - 1;
  const endsProblem = stepIndex === problem.steps.length - 1;
  const allHintsShown = hintsShown >= step.hints.length;

  const goTo = (next: number) => {
    setIndex(next);
    setHintsShown(0);
  };

  const total = FLAT_STEPS.length;
  // Both directions wrap so neither button ever becomes a dead end.
  const handlePrevious = () => goTo((index - 1 + total) % total);
  const handleNext = () => goTo((index + 1) % total);

  const handleHint = () => {
    setHintsShown(allHintsShown ? 0 : hintsShown + 1);
  };

  const hintTitle = allHintsShown ? 'Hide hints' : hintsShown === 0 ? 'Hint' : 'More';
  const nextTitle = isLast ? 'Restart' : endsProblem ? 'New problem' : 'Next';

  return (
    <Page
      headerText={problem.title}
      headerMetadata={`${step.label} ${stepIndex + 1}/${problem.steps.length}`}
      enableSystemBarInset={false}>
      <div className="action-page-shell">
        <ScrollView insetForHeader tabIndex={0} ariaLabel={`${step.label} step`}>
          <Panel width="100%">
            <div className="content-inset">
              <StepText runs={step.text} />
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
              <DiagramCanvas diagram={step.diagram} label={step.diagramLabel} />
            </div>
          </Panel>
        </ScrollView>
        <div className="action-dock">
          <ButtonRail>
            <Button title="Previous" onClick={handlePrevious} />
            <Button title={hintTitle} onClick={handleHint} />
            <Button title={nextTitle} onClick={handleNext} />
          </ButtonRail>
        </div>
      </div>
    </Page>
  );
}
