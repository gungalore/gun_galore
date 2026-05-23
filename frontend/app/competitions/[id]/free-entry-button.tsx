'use client';

import { useState } from 'react';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// Free postal-entry route per CPA Section 36. Clicking the button
// downloads a pre-filled PDF form for this specific raffle and opens
// an instructions modal so the user knows what to do with the printed
// form. The PDF is generated server-side and stamped with the raffle's
// RAxxxxxx reference number so the operator can match envelopes back
// to the right raffle.
export default function FreeEntryButton({
  raffleId,
  raffleTitle,
}: {
  raffleId: string;
  raffleTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  async function handleClick() {
    setOpen(true);
    setDownloading(true);
    setDownloadError(null);

    try {
      // Trigger the download via a fetch + blob so we can show the
      // user a clear "downloaded" state in the modal — anchor-tag
      // downloads are silent and easy to miss.
      const res = await fetch(`${API_URL}/raffles/${raffleId}/postal-entry.pdf`);
      if (!res.ok) {
        throw new Error(`Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `postal-entry-${raffleId.slice(0, 8)}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a short delay so the browser has time to start
      // the download — revoking too soon cancels the save dialog on
      // some Chromium versions.
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <>
      <div style={{ lineHeight: 1.5 }}>
        <button
          type="button"
          onClick={handleClick}
          className="text-xs underline"
          style={{
            color: 'var(--red)',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Download free postal entry form
        </button>
        {/* Inline guidance so the buyer sees the address + deadline
            constraint BEFORE downloading — not just after, buried in
            the post-download modal. CPA Section 36 free-entry route. */}
        <p
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            marginTop: 4,
          }}
        >
          No purchase necessary. Mail the printed form to Gun Galore,
          PO Box 4568, Durbanville, 7550. Must arrive before tickets
          sell out — post at least a week early.
        </p>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="rounded-[8px] p-6 max-w-md w-full"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              className="text-lg mb-3"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              {downloading ? 'Preparing your form…' : 'Form downloaded'}
            </h3>

            <p
              className="text-sm mb-3"
              style={{ color: 'var(--text-secondary)' }}
            >
              For: <span style={{ color: 'var(--text-primary)' }}>{raffleTitle}</span>
            </p>

            {downloadError ? (
              <p className="text-sm" style={{ color: 'var(--red)' }}>
                {downloadError}
              </p>
            ) : (
              <ol
                className="text-sm space-y-2 mb-4 list-decimal pl-5"
                style={{ color: 'var(--text-secondary)' }}
              >
                <li>Print the PDF on a single A4 page.</li>
                <li>Fill in every field by hand — entries with missing details cannot be processed.</li>
                <li>Do not alter the raffle reference printed at the top of the form.</li>
                <li>
                  Post the completed form to:
                  <div
                    className="mt-1 p-3 rounded-[6px] text-xs font-mono"
                    style={{
                      background: 'var(--bg-inset)',
                      border: '0.5px solid var(--border)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    Gun Galore<br />
                    PO Box 4568<br />
                    Durbanville<br />
                    Cape Town<br />
                    7550
                  </div>
                </li>
                <li>Each posted form earns ONE free ticket. You may post multiple forms.</li>
                <li>Entries must arrive before tickets sell out.</li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setOpen(false)}
              className="w-full py-2.5 rounded-[6px] text-sm font-medium mt-2"
              style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
