import type {ReactNode} from 'react';
import {Button, ButtonRail, Page, Panel, ScrollView, TextColor, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import {PALETTE, type TextRun} from '../palette';
import type {ScanStep} from './types';

function toRuns(text: ScanStep['text']): TextRun[] {
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

interface Props {
  step: ScanStep;
  index: number;
  total: number;
  hintsShown: number;
  /** The always-present first control (on/off or new problem). */
  lead: ReactNode;
  onPrevious(): void;
  onHint(): void;
  onNext(): void;
}

/** One solution step: color-coded text, revealed hints, and step controls. */
export function StepPage({step, index, total, hintsShown, lead, onPrevious, onHint, onNext}: Props) {
  const allShown = hintsShown >= step.hints.length;
  const hintTitle = allShown && hintsShown > 0 ? 'Hide hints' : hintsShown === 0 ? 'Hint' : 'More';
  return (
    <Page headerText={step.label} headerMetadata={`${index + 1}/${total}`} enableSystemBarInset={false}>
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
            {lead}
            <Button title="Previous" onClick={onPrevious} />
            <Button title={hintTitle} onClick={onHint} />
            <Button title="Next" onClick={onNext} />
          </ButtonRail>
        </div>
      </div>
    </Page>
  );
}
