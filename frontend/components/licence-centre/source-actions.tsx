'use client';

import { useState } from 'react';
import ConsentCard from './consent-card';
import ConsentLetterModal from './consent-letter-modal';

// ────────────────────────────────────────────────────────────────────
// THE APPLIED-FOR FIREARM'S PAPERWORK, AND THE OWNER'S CONSENT.
//
// ⚠️ ONE ROW, TWO ACTIONS, AND THE CONSENT HIDDEN BEHIND A BUTTON
// (2026-10-13). The member uploads whatever names the firearm they are buying
// — a dealer's invoice, the current owner's licence (front and back) or a
// signed consent letter — and, when it is a private transfer, may instead ask
// the owner to consent from their own phone. The consent sits under "Ask the
// current owner for consent", collapsed, because it is a large form on a row
// that most members never need.
//
// ⚠️ ONCE THE MOTIVATION IS FINALISED THIS RENDERS NOTHING. Operator: "after
// generation there won't be access to the fields again." The whole row
// disappears, and the finished pack is the artifact.
//
// ⚠️ A DEALER SALE HIDES THE CONSENT, NOT THE UPLOAD. A dealer's invoice is
// still the paperwork we read the firearm from; it is only the consent — a
// private individual's permission — that does not apply.
// ────────────────────────────────────────────────────────────────────

/** Who we are buying from, as the member's own answer reads. */
const SOURCE_DEALER = 'From a dealer';

/** What the picker will take. Matches the shelf's accepted upload types. */
const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

export interface SourceActionsProps {
  motivationId: string;
  applicantName: string;
  firearm: Record<string, string | undefined>;
  /** From the sheet. Used only to hide the consent on a known dealer sale. */
  sourceValue: string;
  /** A consent is filled out (the owner has signed). Drives the subscript. */
  signed: boolean;
  /** The motivation is finalised; nothing here is editable. */
  generated: boolean;
  /** Files chosen from this device, filed as the source proof. */
  onUpload?: (files: File[]) => void | Promise<void>;
  /**
   * A batch is in flight — naming, straightening, pairing and filing.
   *
   * ⚠️ THE BUTTON MUST SAY SO (2026-10-14). The treatment is a scanner pipeline
   * (a model call per image, then warp, then upload), so it takes tens of
   * seconds for two photographs. A button that looks idle through all of it is
   * a member pressing it again.
   */
  busy?: boolean;
  onAdopt?: (fields: Record<string, string>) => void;
  onArrived?: (status: 'COMPLETED' | 'DECLINED') => void;
}

export default function SourceActions({
  motivationId,
  applicantName,
  firearm,
  sourceValue,
  signed,
  generated,
  onUpload,
  busy = false,
  onAdopt,
  onArrived,
}: SourceActionsProps) {
  const [consentOpen, setConsentOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  // No field access once the motivation is finalised.
  if (generated) return null;

  const showConsent = sourceValue !== SOURCE_DEALER;
  const button =
    'min-h-[40px] rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-3 text-[13px] font-medium text-[var(--text-primary)]';

  return (
    <div className="border-b border-[var(--border-divider)] py-3">
      <p className="m-0 mb-2 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        The applied-for firearm
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <label
          className={`${button} cursor-pointer ${busy ? 'opacity-60' : ''}`}
        >
          {busy
            ? 'Reading your pictures…'
            : 'Upload the applied-for firearm\u2019s paperwork'}
          <input
            type="file"
            accept={ACCEPT}
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Reset first, so picking the same file twice fires again.
              e.target.value = '';
              if (!busy && files.length) void onUpload?.(files);
            }}
          />
        </label>

        {showConsent ? (
          <button
            type="button"
            aria-expanded={consentOpen}
            disabled={busy}
            onClick={() => setConsentOpen((v) => !v)}
            className={button}
          >
            Ask the current owner for consent
          </button>
        ) : null}
      </div>

      {/*
        ⚠️ THE SUBSCRIPT IS THE STATE, THE VIEW IS THE CONVENIENCE. A filled-out
        consent shows "Consent filled out" and, while the motivation is still
        editable, a View that opens the letter. Both are hidden once finalised.
      */}
      {showConsent && signed ? (
        <div className="mt-1 flex items-center gap-3">
          <span className="text-[12px] font-medium text-[var(--success)]">
            Consent filled out
          </span>
          <button
            type="button"
            onClick={() => setViewOpen(true)}
            className="text-[12px] text-[var(--red)] underline"
          >
            View
          </button>
        </div>
      ) : null}

      {showConsent && consentOpen ? (
        <div className="mt-2">
          <ConsentCard
            motivationId={motivationId}
            applicantName={applicantName}
            firearm={firearm}
            signed={signed}
            onAdopt={onAdopt}
            onArrived={onArrived}
          />
        </div>
      ) : null}

      <ConsentLetterModal
        motivationId={motivationId}
        open={viewOpen}
        onClose={() => setViewOpen(false)}
      />
    </div>
  );
}
