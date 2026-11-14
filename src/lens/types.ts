import type {Scan} from '../../server/schema';
import type {GrayFrame} from '../ar/tracker';

/** A recognized problem and where it came from. */
export interface Found {
  scan: Scan;
  /** Camera frame the problem was found in; null when it came as text. */
  snapshot: GrayFrame | null;
  source: 'camera' | 'text';
}

/** Progress of a problem given as text (Meta AI, dictation or handwriting). */
export type TextStatus = {kind: 'idle'} | {kind: 'working'} | {kind: 'error'; message: string};

export type ScanStep = Scan['steps'][number];
