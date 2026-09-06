import type { ReactElement } from 'react';
import { Logo } from '../brand';
import { Icon } from '../icons';
import { TopBar } from './TopBar';

export interface StartScreenProps {
  title: string;
  subtitle?: string;
  cameraAvailable: boolean;
  onCamera: () => void;
  onPick: () => void;
  onClose: () => void;
}

export function StartScreen({ title, subtitle, cameraAvailable, onCamera, onPick, onClose }: StartScreenProps): ReactElement {
  return (
    <>
      <TopBar left={{ icon: 'close', onClick: onClose, aria: 'Close' }} title={<Logo className="aos-logo" title={title} />} />
      <div className="aos-content">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 className="aos-display" style={{ fontSize: 34 }}>
            Scan your documents
          </h1>
          <p className="aos-lead">{subtitle ?? 'Takes about a minute. Works on any phone, nothing to install.'}</p>
        </div>
        {cameraAvailable ? (
          <button type="button" className="aos-start-tile aos-primary" onClick={onCamera}>
            <span className="aos-tile-icon">
              <Icon name="camera" size={30} />
            </span>
            <span className="aos-tile-text">
              <span className="aos-tile-title">Scan with camera</span>
              <span className="aos-tile-sub">Point at the page and we do the rest</span>
            </span>
            <Icon name="forward" size={24} />
          </button>
        ) : null}
        <button type="button" className={`aos-start-tile ${cameraAvailable ? 'aos-secondary' : 'aos-primary'}`} onClick={onPick}>
          <span className="aos-tile-icon">
            <Icon name="photos" size={30} />
          </span>
          <span className="aos-tile-text">
            <span className="aos-tile-title">Choose from photos</span>
            <span className="aos-tile-sub">A photo you already took, or a PDF you were sent</span>
          </span>
          <Icon name="forward" size={24} color={cameraAvailable ? '#8E8E96' : undefined} />
        </button>
        <div className="aos-info">
          <div className="aos-overline">You can scan</div>
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
        <span>Your scans go straight to ALL Outdoor, nowhere else.</span>
      </div>
    </>
  );
}
