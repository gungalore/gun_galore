'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

/**
 * Desktop QR panel. The desktop mints a capture session and shows a QR code
 * linking to /v/{token}; the phone opens it, adds photos, and they appear on
 * the desktop. The token expires after ~15 minutes and a new code closes the
 * old session.
 */
export function QrCapturePanel({
  url,
  expiresAt,
  onRefresh,
  onClose,
}: {
  url: string;
  expiresAt: string;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [origin, setOrigin] = useState('');
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(expiresAt).getTime() - Date.now()),
  );

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      setRemainingMs(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const expired = remainingMs <= 0;
  const minutes = Math.floor(remainingMs / 60000);
  const seconds = Math.floor((remainingMs % 60000) / 1000);
  const absolute = origin ? `${origin}${url}` : url;

  return (
    <div
      className="rounded-[10px] p-4 text-center"
      style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)' }}
    >
      <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
        Scan with your phone to add photos
      </p>
      {expired ? (
        <div className="py-6">
          <p className="text-sm mb-3" style={{ color: 'var(--text-tertiary)' }}>
            This code has expired.
          </p>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-[6px] px-3 py-1.5 text-xs font-medium"
            style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            Show a new code
          </button>
        </div>
      ) : (
        <>
          <div
            className="inline-block p-3 rounded-[8px]"
            style={{ background: '#fff' }}
          >
            <QRCodeSVG value={absolute} size={148} level="M" />
          </div>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Expires in {minutes}:{seconds.toString().padStart(2, '0')}
          </p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={onRefresh}
              className="text-xs"
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              New code
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs"
              style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              Done
            </button>
          </div>
        </>
      )}
    </div>
  );
}
