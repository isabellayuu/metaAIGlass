import type {ReactNode} from 'react';
import {ButtonRail, InputTextView, TextStyle, TextView} from '@wearables-ui-toolkit/mrbd';
import type {TextStatus} from './types';

interface Props {
  /** The always-present control (on/off). */
  lead: ReactNode;
  /** Show the field for a dictated or handwritten problem (no camera here). */
  showComposer: boolean;
  draft: string;
  status: TextStatus;
  onDraftChange(text: string): void;
  onSubmit(text: string): void;
}

/** Before a problem is found: an otherwise empty view with the on/off control. */
export function IdleView({lead, showComposer, draft, status, onDraftChange, onSubmit}: Props) {
  return (
    <div className="action-page-shell">
      <div className="composer">
        {showComposer && (
          <>
            {status.kind === 'error' && (
              <TextView as="p" textStyle={TextStyle.BODY2} aria-live="polite">
                {status.message}
              </TextView>
            )}
            <InputTextView
              text={draft}
              hint="Say or write a math problem"
              actionLabel="Show steps"
              loadingLabel="Building the steps"
              showLoader={status.kind === 'working'}
              onTextChange={onDraftChange}
              onSend={onSubmit}
              inputProps={{'aria-label': 'Math problem', maxLength: 2000}}
            />
          </>
        )}
      </div>
      <div className="action-dock">
        <ButtonRail>{lead}</ButtonRail>
      </div>
    </div>
  );
}
