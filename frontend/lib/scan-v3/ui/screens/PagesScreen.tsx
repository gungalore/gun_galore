import type { ReactElement } from 'react';
import { renderVariant, type ScanPage } from '../../pipeline/process';
import { Icon } from '../icons';
import { PageCanvas } from '../PageCanvas';
import { TopBar } from './TopBar';
import type { ReviewMode } from './ReviewScreen';

export interface PagesScreenProps {
  pages: { page: ScanPage; mode: ReviewMode }[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onAddCamera: () => void;
  onAddPick: () => void;
  cameraAvailable: boolean;
  onSend: () => void;
  onStartOver: () => void;
  onClose: () => void;
}

export function PagesScreen({ pages, onOpen, onDelete, onAddCamera, onAddPick, cameraAvailable, onSend, onStartOver, onClose }: PagesScreenProps): ReactElement {
  const n = pages.length;
  return (
    <>
      <TopBar left={{ icon: 'close', onClick: onClose, aria: 'Close' }} title="Your pages" />
      <div className="aos-content" style={{ gap: 16, padding: '20px 20px 0' }}>
        <p className="aos-lead" style={{ fontSize: 16 }}>
          Tap a page to check it. Add more if there are more pages.
        </p>
        <div className="aos-grid">
          {pages.map(({ page, mode }, i) => (
            <div key={page.id} className="aos-page-tile">
              <button type="button" className="aos-page-frame" onClick={() => onOpen(page.id)} aria-label={`Check page ${i + 1}`}>
                {page.passthrough ? (
                  <span className="aos-pdf-tile">
                    <Icon name="doc" size={40} color="#5B5B62" stroke={1.6} />
                    <span>PDF</span>
                  </span>
                ) : (
                  <PageCanvas image={renderVariant(page, mode)} maxEdge={320} />
                )}
                <span className="aos-page-num">{i + 1}</span>
              </button>
              <button type="button" className="aos-iconbtn aos-page-del" onClick={() => onDelete(page.id)} aria-label={`Remove page ${i + 1}`}>
                <Icon name="trash" size={20} />
              </button>
              <div className="aos-page-label">
                <Icon name={page.quality.level === 'bad' ? 'alert' : 'check'} size={16} color={page.quality.level === 'good' ? '#2ECC71' : page.quality.level === 'warn' ? '#F5B400' : '#E30613'} stroke={3} />
                <span>Page {i + 1}</span>
              </div>
            </div>
          ))}
          <div className="aos-page-tile">
            <button type="button" className="aos-add-tile" onClick={cameraAvailable ? onAddCamera : onAddPick}>
              <span className="aos-add-orb">
                <Icon name="plus" size={26} stroke={2.5} />
              </span>
              <span>Add a page</span>
            </button>
            {cameraAvailable ? (
              <button type="button" className="aos-btn aos-ghost" style={{ height: 36, fontSize: 14 }} onClick={onAddPick}>
                or choose a photo
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="aos-actions">
        <button type="button" className="aos-btn aos-primary" onClick={onSend} disabled={n === 0}>
          <Icon name="upload" size={22} />
          <span>{n === 1 ? 'Send 1 page' : `Send ${n} pages`}</span>
        </button>
        <button type="button" className="aos-btn aos-ghost" onClick={onStartOver}>
          Start over
        </button>
      </div>
    </>
  );
}
