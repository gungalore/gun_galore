/** The shapes the scanner recognises. Decided from the rectified proportions, never asked. */
export type DocShape = 'a4' | 'card' | 'other';

export interface DocumentScannerProps {
  /** Shown in the top bar and used to name the files. */
  title: string;
  subtitle?: string;
  /** Receives the finished JPEG (or pass-through PDF) files. The caller uploads. */
  onDone: (files: File[]) => void | Promise<void>;
  onClose: () => void;
  /** Optional hint from the caller. The scanner still works the shape out itself. */
  shape?: DocShape;
  /** Offer "Add a page" by default (multi-page document). */
  multiDefault?: boolean;
  /** Skip the start screen and go straight to the camera or the picker. */
  autoStart?: 'camera' | 'pick';
  /** Base name for the produced files. Defaults to `title`. */
  documentName?: string;
}

/** One enhancement look. `auto` picks one of the other three. */
export type EnhanceMode = 'auto' | 'color' | 'grey' | 'bw';

export type QualityLevel = 'good' | 'warn' | 'bad';

export interface QualityVerdict {
  level: QualityLevel;
  /** Plain words for the badge. */
  label: string;
  sharpness: number;
  brightness: number;
  glare: number;
}
