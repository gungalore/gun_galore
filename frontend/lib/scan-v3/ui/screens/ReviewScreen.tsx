import { useMemo, type ReactElement } from 'react';
import type { EnhanceMode } from '../../types';
import { renderVariant, type ScanPage } from '../../pipeline/process';
import { Icon } from '../icons';
import { ZoomView } from '../ZoomView';
import { TopBar } from './TopBar';

export type ReviewMode = EnhanceMode | 'original';

export interface ReviewScreenProps {
  page: ScanPage;
  mode: ReviewMode;
  onMode: (m: ReviewMode) => void;
  onUse: () => void;
  onRetake: () => void;
  onDiscard: () => void;
  /** The page was taken with the camera (so "Retake") rather than picked ("Choose another"). */
  fromCamera: boolean;
  /** For a page that was already kept: the decoded sealed image to show instead of a live render. */
  sealedImage?: ImageData | null;
  /** Opens the corner editor. Absent when the page cannot be re-cropped (kept or pass-through). */
  onFixCorners?: () => void;
  /** Turns the page a quarter turn. Absent when the page cannot be changed. */
  onRotate?: () => void;
}

const LOOKS: [ReviewMode, string][] = [
  ['auto', 'Auto'],
  ['original', 'Original'],
  ['bw', 'Black & white'],
];

function lookName(mode: string | undefined): string {
  return mode === 'bw' ? 'black & white' : mode === 'grey' ? 'grey' : mode === 'original' ? 'the original' : 'colour';
}

export function ReviewScreen({ page, mode, onMode, onUse, onRetake, onDiscard, fromCamera, sealedImage, onFixCorners, onRotate }: ReviewScreenProps): ReactElement {
  const image = useMemo(() => sealedImage ?? renderVariant(page, mode), [page, mode, sealedImage]);
  const kept = !!page.sealed;
  const q = page.quality;
  const primaryIsRetake = q.level === 'bad';
  const badgeClass = q.level === 'good' ? '' : q.level === 'warn' ? 'aos-warn' : 'aos-bad';
  const backLabel = fromCamera ? 'Retake' : 'Back';
  const tools =
    onFixCorners || onRotate ? (
      <div className="aos-row">
        {onFixCorners ? (
          <button type="button" className="aos-btn aos-ghost" onClick={onFixCorners}>
            <Icon name="corners" size={20} />
            <span>Fix corners</span>
          </button>
        ) : null}
        {onRotate ? (
          <button type="button" className="aos-btn aos-ghost" onClick={onRotate}>
            <Icon name="rotate" size={20} />
            <span>Rotate</span>
          </button>
        ) : null}
      </div>
    ) : null;
  return (
    <>
      <TopBar
        // When the scan is poor the big button already says "Scan it again"; the arrow alone does up here.
        left={{ icon: 'back', label: primaryIsRetake ? undefined : backLabel, onClick: onRetake, aria: backLabel }}
        title="Check your scan"
        right={{ icon: 'trash', onClick: onDiscard, aria: 'Discard this page' }}
      />
      <div className="aos-preview">
        <div className="aos-quality">
          <span className={`aos-quality-badge ${badgeClass}`}>
            <Icon name={q.level === 'good' ? 'check' : 'alert'} size={18} stroke={2.5} />
            <span>{q.label}</span>
          </span>
        </div>
        <ZoomView image={image} />
      </div>
      {kept ? (
        <div className="aos-enhance">
          <div className="aos-enhance-note">
            <Icon name="check" size={16} color="#8E8E96" />
            <span>Kept as {lookName(page.sealed?.mode)}. Scan it again to change the look.</span>
          </div>
        </div>
      ) : (
        <div className="aos-enhance">
          <div className="aos-chips" role="radiogroup" aria-label="Look">
            {LOOKS.map(([m, label]) => (
              <button key={m} type="button" role="radio" aria-checked={mode === m} className={`aos-chip ${mode === m ? 'aos-on' : ''}`} onClick={() => onMode(m)}>
                {label}
              </button>
            ))}
          </div>
          <div className="aos-enhance-note">
            <Icon name="spark" size={16} color="#8E8E96" />
            <span>{mode === 'auto' ? `Auto picked ${lookName(page.autoMode)} for you` : 'Auto picks the clearest look for you'}</span>
          </div>
        </div>
      )}
      <div className="aos-actions">
        {primaryIsRetake ? (
          <>
            <button type="button" className="aos-btn aos-primary" onClick={onRetake}>
              <Icon name={fromCamera ? 'camera' : 'photos'} size={22} />
              <span>{fromCamera ? 'Scan it again' : 'Choose another'}</span>
            </button>
            {tools}
            <button type="button" className="aos-btn aos-ghost" onClick={onUse}>
              Use it anyway
            </button>
          </>
        ) : kept ? (
          <button type="button" className="aos-btn aos-primary" onClick={onUse}>
            <Icon name="check" size={22} />
            <span>Keep it</span>
          </button>
        ) : (
          <>
            <button type="button" className="aos-btn aos-primary" onClick={onUse}>
              <Icon name="check" size={22} />
              <span>Use this page</span>
            </button>
            {tools}
          </>
        )}
      </div>
    </>
  );
}
