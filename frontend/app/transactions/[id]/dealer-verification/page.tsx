'use client';

// Dealer stock-in verification — seller-facing upload page.
//
// Flow:
//   1. Seller drops the firearm at the chosen SAPS-licensed dealer.
//   2. Dealer fills out SAPS 534 (BLOCK LETTERS, stamp/signature).
//   3. Seller takes 3 photos with their phone's NATIVE camera
//      (we deliberately don't open the in-app camera — close the app,
//      use the camera, come back to upload).
//   4. Seller uploads the 3 photos here (gallery picker).
//   5. Claude scans them against a rubric (see backend service).
//   6. Status: APPROVED (payout fires) / PENDING_ADMIN_REVIEW (human
//      checks within 48h) / REJECTED (seller reshoots).
//
// Client-side: HEIF→JPEG conversion + downscale to 1920px before
// upload. Phone cameras produce 5-12MB images; we ship 200-500KB.

import { useState, useEffect, FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { DownloadSaps534Button } from '../download-saps534-button';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface SlotConfig {
  key: 'saps534' | 'stockRegister' | 'firearmSerial';
  title: string;
  what: string;
  tips: string[];
}

const SLOTS: SlotConfig[] = [
  {
    key: 'saps534',
    title: 'SAP 534 form',
    what: "The completed SAP 534 (Transfer of Firearm Ownership) form, stamped by the dealer. Upload a clear photo or a PDF scan.",
    tips: [
      'BLOCK LETTERS only — cursive or mixed-case slows the process down.',
      'The dealer stamp OR a clear signature + printed dealer name must be visible.',
      'A PDF scan of the stamped form works too — or a clear photo.',
      'Capture the full page edge-to-edge with all fields readable.',
    ],
  },
  {
    key: 'stockRegister',
    title: 'Last line of the dealer\'s stock register',
    what: "Only the dealer's most recent entry — yours. No other customer details should be visible.",
    tips: [
      'Ask the dealer to flip to the page showing your entry as the last line.',
      'Cover the lines ABOVE your entry with a piece of paper if needed — privacy of other customers matters.',
      "Your entry's row number, date, firearm make/model and serial must all be readable.",
      'A photo of just one line is perfect — no need to capture the whole page.',
    ],
  },
  {
    key: 'firearmSerial',
    title: 'Firearm with serial number visible',
    what: 'The firearm next to a small piece of paper showing the order reference below.',
    tips: [
      'Write the order reference (shown above) clearly on a piece of paper.',
      'Place it next to the firearm so both the serial AND the reference appear in one photo.',
      'This proves the photo was taken FOR THIS order — recycled photos will be rejected.',
      'The serial number must be in focus and readable.',
    ],
  },
];

interface VerificationResult {
  status:
    | 'PENDING_UPLOAD'
    | 'PENDING_CLAUDE'
    | 'PENDING_ADMIN_REVIEW'
    | 'APPROVED'
    | 'REJECTED';
  score: number;
  findings: VerificationFindings | null;
}

interface VerificationFindings {
  saps534: {
    all_fields_filled: number;
    dealer_stamp_or_signature: number;
    block_letters: number;
    dealer_licence_visible: number;
    extracted_dealer_licence: string | null;
    issues: string[];
  };
  stockRegister: {
    last_line_only: number;
    extracted_serial: string | null;
    serial_matches_listing: number;
    extracted_entry_number: string | null;
    issues: string[];
  };
  firearm: {
    serial_legible: number;
    extracted_serial: string | null;
    serial_matches_listing: number;
    order_reference_visible: number;
    issues: string[];
  };
  serial_consistency_across_photos: number;
  overall_confidence: number;
  recommendation: 'APPROVE' | 'ADMIN_REVIEW' | 'REJECT';
  recommendation_reason: string;
}

type FileState = {
  file: File;
  previewUrl: string;
  processing: boolean;
  error: string | null;
  // True when the SAP 534 was uploaded as a PDF (skips image processing
  // and the thumbnail; the server reads the PDF directly).
  isPdf?: boolean;
};

export default function DealerVerificationPage() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const router = useRouter();

  const orderRef = id ? id.slice(-8).toUpperCase() : '';
  const [files, setFiles] = useState<Record<string, FileState | null>>({
    saps534: null,
    stockRegister: null,
    firearmSerial: null,
  });
  const [registerRef, setRegisterRef] = useState('');
  // Required: where the firearm has been booked into stock. Gets sent
  // to the buyer alongside the payout-released notification — that's
  // the moment they find out where the firearm is sitting. Three
  // fields kept simple: name, address (single multi-line input), phone.
  const [dealerName, setDealerName] = useState('');
  const [dealerAddress, setDealerAddress] = useState('');
  const [dealerPhone, setDealerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Revoke object URLs when the file is replaced — otherwise we leak
  // memory + the GC won't release the blob.
  useEffect(() => {
    return () => {
      Object.values(files).forEach((f) => {
        if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFile(slot: SlotConfig['key'], rawFile: File) {
    // PDFs (only offered for the SAP 534 slot) bypass the image
    // pipeline — they're uploaded as-is and read directly by the server.
    const isPdf =
      rawFile.type === 'application/pdf' ||
      rawFile.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      setFiles((prev) => {
        const prevSlot = prev[slot];
        if (prevSlot?.previewUrl) URL.revokeObjectURL(prevSlot.previewUrl);
        return {
          ...prev,
          [slot]: {
            file: rawFile,
            previewUrl: '',
            processing: false,
            error: null,
            isPdf: true,
          },
        };
      });
      return;
    }
    // Show an immediate "processing" state — HEIF conversion +
    // canvas resize can take 1-2s on older phones.
    setFiles((prev) => ({
      ...prev,
      [slot]: {
        file: rawFile,
        previewUrl: '',
        processing: true,
        error: null,
      },
    }));
    try {
      const processed = await processImage(rawFile);
      const previewUrl = URL.createObjectURL(processed);
      setFiles((prev) => {
        // Revoke the previous previewUrl for this slot if it existed.
        const prevSlot = prev[slot];
        if (prevSlot?.previewUrl) URL.revokeObjectURL(prevSlot.previewUrl);
        return {
          ...prev,
          [slot]: {
            file: processed,
            previewUrl,
            processing: false,
            error: null,
          },
        };
      });
    } catch (err) {
      setFiles((prev) => ({
        ...prev,
        [slot]: {
          file: rawFile,
          previewUrl: '',
          processing: false,
          error: err instanceof Error ? err.message : 'Could not process this photo',
        },
      }));
    }
  }

  function removeFile(slot: SlotConfig['key']) {
    setFiles((prev) => {
      const prevSlot = prev[slot];
      if (prevSlot?.previewUrl) URL.revokeObjectURL(prevSlot.previewUrl);
      return { ...prev, [slot]: null };
    });
  }

  const allReady =
    files.saps534?.file &&
    files.stockRegister?.file &&
    files.firearmSerial?.file &&
    !files.saps534?.processing &&
    !files.stockRegister?.processing &&
    !files.firearmSerial?.processing &&
    dealerName.trim().length >= 2 &&
    dealerAddress.trim().length >= 5 &&
    /^\+?[\d\s()-]{7,20}$/.test(dealerPhone.trim());

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!allReady) return;
    setSubmitting(true);
    setError(null);
    try {
      const token = await getToken();
      const formData = new FormData();
      formData.append('saps534', files.saps534!.file);
      formData.append('stockRegister', files.stockRegister!.file);
      formData.append('firearmSerial', files.firearmSerial!.file);
      if (registerRef.trim()) {
        formData.append('dealerStockRegisterRef', registerRef.trim());
      }
      formData.append('stockedAtDealerName', dealerName.trim());
      formData.append('stockedAtDealerAddress', dealerAddress.trim());
      formData.append('stockedAtDealerPhone', dealerPhone.trim());

      const res = await fetch(
        `${API_URL}/transactions/${id}/dealer-verification`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        },
      );
      const body = (await res.json().catch(() => ({}))) as
        | VerificationResult
        | { message?: string };
      if (!res.ok) {
        throw new Error((body as { message?: string }).message ?? `Error ${res.status}`);
      }
      setResult(body as VerificationResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Result view (after successful submit) ────────────────────
  if (result) {
    return (
      <main className="max-w-[720px] mx-auto px-4 py-6">
        <h1
          className="text-xl font-medium mb-4"
          style={{ color: 'var(--text-primary)' }}
        >
          Dealer verification
        </h1>
        <VerificationResultPanel
          result={result}
          onReshoot={() => {
            setResult(null);
            setFiles({ saps534: null, stockRegister: null, firearmSerial: null });
            setRegisterRef('');
            // Dealer contact fields are kept — the seller didn't
            // change dealer, just needs to reshoot the photos.
          }}
          onBack={() => router.push(`/transactions/${id}`)}
        />
      </main>
    );
  }

  // ─── Upload form ──────────────────────────────────────────────
  return (
    <main className="max-w-[720px] mx-auto px-4 py-6">
      <p
        className="text-xs mb-2"
        style={{ color: 'var(--text-tertiary)' }}
      >
        Order reference: <code style={{ fontFamily: 'monospace' }}>{orderRef}</code>
      </p>
      <h1
        className="text-xl font-medium mb-3"
        style={{ color: 'var(--text-primary)' }}
      >
        Confirm firearm received by dealer
      </h1>

      {/* Workflow callout — tells seller to leave the app, use the
          native camera, then come back. */}
      <div
        className="rounded-[8px] p-4 mb-5"
        style={{
          background: 'rgba(245,158,11,0.08)',
          border: '0.5px solid #f59e0b',
        }}
      >
        <p
          className="text-sm mb-2"
          style={{ color: 'var(--text-primary)', fontWeight: 500 }}
        >
          Before you upload
        </p>
        <ol
          className="text-sm space-y-1"
          style={{ color: 'var(--text-secondary)', paddingLeft: 18 }}
        >
          <li>Close this page and open your phone&apos;s camera.</li>
          <li>Take the 3 photos described below.</li>
          <li>Come back here and tap each <strong>Upload from gallery</strong> button.</li>
        </ol>
      </div>

      {/* Block-letters callout — the single most common cause of
          delay, so it needs maximum prominence. */}
      <div
        className="rounded-[8px] p-4 mb-5"
        style={{
          background: 'rgba(200,16,46,0.06)',
          border: '0.5px solid var(--red)',
        }}
      >
        <p
          className="text-sm"
          style={{ color: 'var(--text-primary)' }}
        >
          <strong style={{ color: 'var(--red)' }}>BLOCK LETTERS REQUIRED.</strong>{' '}
          Our verification bot (Claude) reads the SAPS 534 automatically. Unclear,
          cursive, or mixed-case handwriting will be queued for human review,
          adding up to 48 hours before your payout is released. Ask the dealer
          to fill the form in capital letters.
        </p>
      </div>

      {/* Grab the pre-filled SAPS 534 here — same form we emailed at sale
          time, rebuilt on demand in case that email bounced or was lost. */}
      {id && (
        <div
          className="rounded-[8px] p-4 mb-5"
          style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
        >
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            Need the pre-filled form?
          </p>
          <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
            Download the SAPS 534 we pre-filled with your particulars and the firearm details. Complete anything blank in BLOCK LETTERS, have the dealer stamp it, then upload the stamped copy below.
          </p>
          <DownloadSaps534Button transactionId={id} />
        </div>
      )}

      {/* Rubric — what Claude is going to check. Set the seller's
          expectations BEFORE they upload so there are no surprises. */}
      <details
        className="rounded-[8px] p-3 mb-5"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <summary
          className="text-sm cursor-pointer"
          style={{ color: 'var(--text-secondary)' }}
        >
          What our verification bot checks ↓
        </summary>
        <ul
          className="text-xs mt-3 space-y-1"
          style={{ color: 'var(--text-tertiary)', paddingLeft: 18 }}
        >
          <li>SAPS 534 — all fields filled, block letters, dealer stamp/signature, dealer licence visible and matches our record</li>
          <li>Stock register — last line only (no other customers), serial matches the listing, entry number readable</li>
          <li>Firearm — serial in focus and matches, order reference visible in the same photo</li>
          <li>Cross-check — the serial number is consistent across all three photos</li>
        </ul>
      </details>

      <form onSubmit={handleSubmit} className="space-y-4">
        {SLOTS.map((slot) => (
          <Slot
            key={slot.key}
            config={slot}
            state={files[slot.key]}
            onPick={(f) => pickFile(slot.key, f)}
            onRemove={() => removeFile(slot.key)}
          />
        ))}

        {/* Required: where the firearm has been stocked.
            These are sent to the buyer once the verification
            approves — that's the moment they find out where the
            firearm is and contact you to arrange the rest. */}
        <div
          className="rounded-[8px] p-4 space-y-3"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
          }}
        >
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Where the firearm is now booked in
          </p>
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            We send these to the buyer as soon as verification approves
            — they need to know where to contact you to arrange the
            inter-dealer transfer onwards. All three are required.
          </p>

          <div>
            <label
              className="text-xs uppercase tracking-wider mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Dealer name *
            </label>
            <input
              type="text"
              value={dealerName}
              onChange={(e) => setDealerName(e.target.value)}
              placeholder="e.g. Safari & Outdoor Centurion"
              maxLength={120}
              style={{
                width: '100%',
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label
              className="text-xs uppercase tracking-wider mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Dealer address *
            </label>
            <textarea
              value={dealerAddress}
              onChange={(e) => setDealerAddress(e.target.value)}
              placeholder="Street, suburb, city, postal code"
              maxLength={300}
              rows={2}
              style={{
                width: '100%',
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 14,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit',
              }}
            />
          </div>

          <div>
            <label
              className="text-xs uppercase tracking-wider mb-1 block"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Dealer phone *
            </label>
            <input
              type="tel"
              inputMode="tel"
              value={dealerPhone}
              onChange={(e) => setDealerPhone(e.target.value)}
              placeholder="012 345 6789"
              maxLength={40}
              style={{
                width: '100%',
                background: 'var(--bg-inset)',
                border: '0.5px solid var(--border)',
                color: 'var(--text-primary)',
                borderRadius: 6,
                padding: '8px 12px',
                fontSize: 14,
                outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Optional: stock-register entry number — saves Claude one
            inference if the seller types it in. */}
        <div>
          <label
            className="text-xs uppercase tracking-wider mb-1 block"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Stock register entry number (optional)
          </label>
          <input
            type="text"
            value={registerRef}
            onChange={(e) => setRegisterRef(e.target.value)}
            placeholder="e.g. 2024-03-127"
            maxLength={40}
            style={{
              width: '100%',
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
              borderRadius: 6,
              padding: '8px 12px',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            The row number from the dealer&apos;s stock register. Helps cross-check.
          </p>
        </div>

        {error && (
          <div
            className="rounded-[6px] px-3 py-2 text-sm"
            style={{
              background: 'rgba(200,16,46,0.08)',
              border: '0.5px solid var(--red)',
              color: 'var(--red)',
            }}
          >
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => router.push(`/transactions/${id}`)}
            disabled={submitting}
            className="px-4 py-2.5 rounded-[6px] text-sm"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-secondary)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!allReady || submitting}
            className="flex-1 py-2.5 rounded-[6px] text-sm font-medium"
            style={{
              background: allReady && !submitting ? 'var(--red)' : 'var(--bg-inset)',
              color: allReady && !submitting ? '#fff' : 'var(--text-tertiary)',
              border: 'none',
              cursor: allReady && !submitting ? 'pointer' : 'not-allowed',
            }}
          >
            {submitting ? 'Uploading + scanning…' : 'Submit for verification'}
          </button>
        </div>
      </form>
    </main>
  );
}

// ─── Slot component ────────────────────────────────────────────────

function Slot({
  config,
  state,
  onPick,
  onRemove,
}: {
  config: SlotConfig;
  state: FileState | null;
  onPick: (f: File) => void;
  onRemove: () => void;
}) {
  return (
    <div
      className="rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${state ? '#22c55e' : 'var(--border)'}`,
      }}
    >
      <p
        className="text-sm font-medium mb-1"
        style={{ color: 'var(--text-primary)' }}
      >
        {config.title}
      </p>
      <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
        {config.what}
      </p>
      <ul
        className="text-xs mb-3 space-y-0.5"
        style={{ color: 'var(--text-tertiary)', paddingLeft: 16 }}
      >
        {config.tips.map((t, i) => (
          <li key={i}>· {t}</li>
        ))}
      </ul>

      {state?.file && !state.processing && !state.error ? (
        <div className="flex items-center gap-3">
          {state.isPdf ? (
            <div
              className="flex items-center justify-center text-xs font-medium"
              style={{
                width: 72,
                height: 72,
                borderRadius: 6,
                border: '0.5px solid var(--border)',
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
              }}
            >
              PDF
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={state.previewUrl}
              alt={config.title}
              style={{
                width: 72,
                height: 72,
                objectFit: 'cover',
                borderRadius: 6,
                border: '0.5px solid var(--border)',
              }}
            />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
              {state.file.name} · {(state.file.size / 1024).toFixed(0)} KB
            </p>
            <p className="text-xs" style={{ color: '#22c55e' }}>
              ✓ ready
            </p>
          </div>
          <button
            type="button"
            onClick={onRemove}
            className="text-xs px-2 py-1 rounded"
            style={{
              background: 'transparent',
              color: 'var(--text-tertiary)',
              border: '0.5px solid var(--border)',
              cursor: 'pointer',
            }}
          >
            Replace
          </button>
        </div>
      ) : state?.processing ? (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Processing photo (compressing + converting)…
        </p>
      ) : (
        <>
          <label
            className="inline-block px-3 py-2 rounded-[6px] text-sm cursor-pointer"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-primary)',
              border: '0.5px solid var(--border)',
            }}
          >
            Upload from gallery
            <input
              type="file"
              accept={config.key === 'saps534' ? 'image/*,application/pdf' : 'image/*'}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
              }}
            />
          </label>
          {state?.error && (
            <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
              {state.error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ─── Result panel ─────────────────────────────────────────────────

function VerificationResultPanel({
  result,
  onReshoot,
  onBack,
}: {
  result: VerificationResult;
  onReshoot: () => void;
  onBack: () => void;
}) {
  const headerColour =
    result.status === 'APPROVED'
      ? '#22c55e'
      : result.status === 'REJECTED'
        ? 'var(--red)'
        : '#f59e0b';
  const headerLabel =
    result.status === 'APPROVED'
      ? '✓ Verified — payout will be released'
      : result.status === 'REJECTED'
        ? '✕ Photos rejected — please reshoot'
        : '⏳ Sent for human review';

  return (
    <div
      className="rounded-[8px] p-5"
      style={{
        background: 'var(--bg-card)',
        border: `0.5px solid ${headerColour}`,
      }}
    >
      <p
        className="text-base mb-3"
        style={{ color: headerColour, fontWeight: 500 }}
      >
        {headerLabel}
      </p>

      {result.findings && (
        <>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            Overall confidence:{' '}
            <strong style={{ color: 'var(--text-primary)' }}>
              {result.findings.overall_confidence}%
            </strong>
          </p>

          <FindingsBreakdown findings={result.findings} />

          {result.findings.recommendation_reason && (
            <p
              className="text-xs mt-4 p-3 rounded"
              style={{
                background: 'var(--bg-inset)',
                color: 'var(--text-secondary)',
              }}
            >
              <strong>Bot summary:</strong> {result.findings.recommendation_reason}
            </p>
          )}
        </>
      )}

      {result.status === 'PENDING_ADMIN_REVIEW' && (
        <p
          className="text-sm mt-4"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
        >
          Your submission is being reviewed by our team. We aim to confirm
          within <strong>48 hours</strong>. You will receive an email and SMS
          once the verification completes.
        </p>
      )}

      <div className="flex gap-2 mt-5">
        <button
          type="button"
          onClick={onBack}
          className="flex-1 py-2 rounded text-sm"
          style={{
            background: 'var(--bg-inset)',
            color: 'var(--text-secondary)',
            border: '0.5px solid var(--border)',
            cursor: 'pointer',
          }}
        >
          Back to order
        </button>
        {result.status === 'REJECTED' && (
          <button
            type="button"
            onClick={onReshoot}
            className="flex-1 py-2 rounded text-sm font-medium"
            style={{
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reshoot and try again
          </button>
        )}
      </div>
    </div>
  );
}

function FindingsBreakdown({ findings }: { findings: VerificationFindings }) {
  const groups: { title: string; rows: { label: string; score: number }[] }[] = [
    {
      title: 'SAPS 534 form',
      rows: [
        { label: 'All fields filled', score: findings.saps534.all_fields_filled },
        { label: 'Dealer stamp / signature', score: findings.saps534.dealer_stamp_or_signature },
        { label: 'Block letters', score: findings.saps534.block_letters },
        { label: 'Dealer licence matches our record', score: findings.saps534.dealer_licence_visible },
      ],
    },
    {
      title: 'Stock register',
      rows: [
        { label: 'Only your line visible', score: findings.stockRegister.last_line_only },
        { label: 'Serial matches listing', score: findings.stockRegister.serial_matches_listing },
      ],
    },
    {
      title: 'Firearm',
      rows: [
        { label: 'Serial legible', score: findings.firearm.serial_legible },
        { label: 'Matches listing', score: findings.firearm.serial_matches_listing },
        { label: 'Order reference visible', score: findings.firearm.order_reference_visible },
      ],
    },
    {
      title: 'Cross-check',
      rows: [
        { label: 'Serial consistent across all 3 photos', score: findings.serial_consistency_across_photos },
      ],
    },
  ];

  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <div key={g.title}>
          <p
            className="text-xs uppercase tracking-wider mb-1.5"
            style={{ color: 'var(--text-tertiary)' }}
          >
            {g.title}
          </p>
          {g.rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2 text-sm mb-1">
              <span
                className="inline-block w-4 text-center"
                style={{
                  color:
                    r.score >= 80
                      ? '#22c55e'
                      : r.score >= 50
                        ? '#f59e0b'
                        : 'var(--red)',
                }}
              >
                {r.score >= 80 ? '✓' : r.score >= 50 ? '⚠' : '✕'}
              </span>
              <span style={{ color: 'var(--text-secondary)', flex: 1 }}>
                {r.label}
              </span>
              <span
                className="text-xs"
                style={{ color: 'var(--text-tertiary)' }}
              >
                {r.score}%
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Client-side image processing ─────────────────────────────────

// Decode → downscale → re-encode as JPEG. Handles HEIF/HEIC from
// iPhones automatically because <img>/createImageBitmap on iOS Safari
// natively decodes HEIF. On Android the camera already shoots JPEG.
// On desktop the same path works for whatever the user uploads.
async function processImage(file: File): Promise<File> {
  // Bail fast for files under 1MB and known JPEG — no need to round-trip
  // through canvas; just send as-is.
  if (
    file.size < 1024 * 1024 &&
    (file.type === 'image/jpeg' || file.type === 'image/jpg')
  ) {
    return file;
  }

  const bitmap = await createImageBitmap(file).catch(async () => {
    // Fallback for browsers that don't support createImageBitmap on
    // arbitrary blobs (older Safari, some Android variants). Use an
    // Image element via a blob URL.
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = () => reject(new Error('Could not decode image'));
        i.src = url;
      });
      return img as unknown as ImageBitmap;
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // Downscale to max 1920px on the longest edge. Phone photos are
  // ~4032×3024; this gets us to ~1920×1440 with no visible quality loss.
  const MAX_EDGE = 1920;
  const ratio = Math.min(
    1,
    MAX_EDGE / Math.max(bitmap.width, bitmap.height),
  );
  const targetW = Math.round(bitmap.width * ratio);
  const targetH = Math.round(bitmap.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D not supported');
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0, targetW, targetH);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  );
  if (!blob) throw new Error('Could not encode as JPEG');

  // Preserve the original filename but force a .jpg extension so the
  // server-side multer + Cloudinary don't get confused.
  const baseName = file.name.replace(/\.[^.]+$/, '');
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' });
}
