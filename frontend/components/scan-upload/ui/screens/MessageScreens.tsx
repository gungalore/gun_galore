import type { ReactElement } from 'react';
import { Logo } from '../brand';
import { Icon } from '../icons';
import { TopBar } from './TopBar';

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
