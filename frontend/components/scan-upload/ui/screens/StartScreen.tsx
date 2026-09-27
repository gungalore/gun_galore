import type { ReactElement } from 'react';
import { Logo } from '../brand';
import { Icon } from '../icons';
import { TopBar } from './TopBar';

// ────────────────────────────────────────────────────────────────────
// The upload's landing screen, trimmed of everything camera.
//
// The vendored StartScreen offers "Scan with camera" beside "Choose
// from photos"; the upload only ever runs on files the member already
// picked, so this copy has the single picker tile. It is reached when
// a member backs out of the last page, not on the normal path.
// ────────────────────────────────────────────────────────────────────

export interface StartScreenProps {
  title: string;
  subtitle?: string;
  onPick: () => void;
  onClose: () => void;
}

export function StartScreen({ title, subtitle, onPick, onClose }: StartScreenProps): ReactElement {
  return (
    <>
      <TopBar left={{ icon: 'close', onClick: onClose, aria: 'Close' }} title={<Logo className="aos-logo" title={title} />} />
      <div className="aos-content">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 className="aos-display" style={{ fontSize: 34 }}>
            Choose your documents
          </h1>
          <p className="aos-lead">{subtitle ?? 'Pick the photos or PDFs you want to add. We straighten and clean them for you.'}</p>
        </div>
        <button type="button" className="aos-start-tile aos-primary" onClick={onPick}>
          <span className="aos-tile-icon">
            <Icon name="photos" size={30} />
          </span>
          <span className="aos-tile-text">
            <span className="aos-tile-title">Choose from photos</span>
            <span className="aos-tile-sub">A photo you already took, or a PDF you were sent</span>
          </span>
          <Icon name="forward" size={24} />
        </button>
        <div className="aos-info">
          <div className="aos-overline">You can add</div>
          <div className="aos-info-row">
            <Icon name="doc" size={22} color="#E30613" />
            <span>A4 pages, forms and certificates</span>
          </div>
          <div className="aos-info-row">
            <Icon name="card" size={22} color="#E30613" />
            <span>Licence cards and ID cards</span>
          </div>
          <div className="aos-info-row">
            <Icon name="pages" size={22} color="#E30613" />
            <span>Several pages in one go</span>
          </div>
        </div>
      </div>
      <div className="aos-footnote">
        <Icon name="lock" size={16} color="#8E8E96" />
        <span>Your documents go straight to ALL Outdoor, nowhere else.</span>
      </div>
    </>
  );
}
