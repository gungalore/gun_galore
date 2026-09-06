import type { ReactElement } from 'react';
import { Logo } from '../brand';
import { Icon } from '../icons';
import { TopBar } from './TopBar';

export function PermissionBlockedScreen({ reason, onPick, onRetry, onClose }: { reason: 'denied' | 'none' | 'busy' | 'unknown'; onPick: () => void; onRetry: () => void; onClose: () => void }): ReactElement {
  const copy = {
    denied: {
      h: 'Camera is switched off for this site',
      p: 'Open your browser settings, allow the camera for this website, then come back and try again. Or choose a photo you already took.',
    },
    none: { h: 'No camera found', p: 'This device has no rear camera we can use. You can still choose a photo you already took.' },
    busy: { h: 'The camera is busy', p: 'Another app is using the camera. Close it and try again.' },
    unknown: { h: 'The camera would not open', p: 'Try again, or choose a photo you already took.' },
  }[reason];
  return (
    <>
      <TopBar left={{ icon: 'close', onClick: onClose, aria: 'Close' }} title={<Logo className="aos-logo" />} />
      <div className="aos-center">
        <div className="aos-orb aos-red">
          <Icon name="cameraOff" size={60} color="#E30613" stroke={1.8} />
        </div>
        <h1 className="aos-display" style={{ fontSize: 30 }}>
          {copy.h}
        </h1>
        <p className="aos-lead">{copy.p}</p>
      </div>
      <div className="aos-actions">
        {reason !== 'none' ? (
          <button type="button" className="aos-btn aos-primary" onClick={onRetry}>
            Try again
          </button>
        ) : null}
        <button type="button" className={`aos-btn ${reason === 'none' ? 'aos-primary' : 'aos-secondary'}`} onClick={onPick}>
          <Icon name="photos" size={22} />
          <span>Choose from photos</span>
        </button>
      </div>
    </>
  );
}

export function ProcessingScreen({ label = 'Cleaning up your scan' }: { label?: string }): ReactElement {
  return (
    <>
      <TopBar title={<Logo className="aos-logo" />} />
      <div className="aos-center">
        <div className="aos-spinner" />
        <h1 className="aos-display" style={{ fontSize: 28 }}>
          {label}
        </h1>
        <p className="aos-lead">Straightening the page and fixing the light.</p>
      </div>
    </>
  );
}

export function PreparingScreen({ count }: { count: number }): ReactElement {
  return (
    <>
      <TopBar title={<Logo className="aos-logo" />} />
      <div className="aos-center">
        <div className="aos-spinner" />
        <h1 className="aos-display" style={{ fontSize: 28 }}>
          Preparing {count === 1 ? 'your page' : `your ${count} pages`}
        </h1>
        <p className="aos-lead">Keep this page open. It only takes a moment.</p>
      </div>
    </>
  );
}

export function UnsupportedScreen({ onPick, onClose }: { onPick: () => void; onClose: () => void }): ReactElement {
  return (
    <>
      <TopBar left={{ icon: 'close', onClick: onClose, aria: 'Close' }} title={<Logo className="aos-logo" />} />
      <div className="aos-center">
        <div className="aos-orb aos-red">
          <Icon name="alert" size={56} color="#E30613" stroke={1.8} />
        </div>
        <h1 className="aos-display" style={{ fontSize: 30 }}>
          We could not open that file
        </h1>
        <p className="aos-lead">Choose a photo (JPEG or PNG) or a PDF. Some phones save photos in a format the browser cannot read; taking the photo again with the scanner fixes that.</p>
      </div>
      <div className="aos-actions">
        <button type="button" className="aos-btn aos-primary" onClick={onPick}>
          Choose another
        </button>
      </div>
    </>
  );
}
