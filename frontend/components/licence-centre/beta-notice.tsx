'use client';

// ────────────────────────────────────────────────────────────────────
// THE BETA NOTICE — once per application, at the start.
//
// Operator, 2026-11-21: "We need to add a small pop up for the users at the
// beginning of the motivation, telling them that this is a beta product. And
// they should immediately report any bugs on the report a bug button on the
// right bottom corner of the screen if they find any glitches so support can
// fix it immediately."
//
// ⚠️ ONCE PER APPLICATION, NOT ONCE PER VISIT. Keyed by the motivation id, so
// a member starting their second application is told again (the product is
// still beta), but opening the sheet five times in an evening is not five
// popups. The dismissal is local; the fact it was shown goes to the support
// timeline.
//
// ⚠️ IT DOES NOT BLOCK THE WORK. One "Got it" button, no form, no checkbox —
// the member reads it and carries on. A modal that demands interaction before
// the product is "a popup" in the bad sense.
// ────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { motivationsApi } from '@/lib/motivations-api';

const seenKey = (motivationId: string) =>
  `gg:motivation-beta-seen:${motivationId}`;

export default function BetaNotice({ motivationId }: { motivationId: string }) {
  const { getToken } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!motivationId) return;
    try {
      if (localStorage.getItem(seenKey(motivationId))) return;
    } catch {
      // Storage blocked: show it. Better one extra popup than nobody told.
    }
    setOpen(true);
  }, [motivationId]);

  if (!open) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(seenKey(motivationId), '1');
    } catch {
      /* private mode: it will show again, which is acceptable */
    }
    void motivationsApi
      .activity(getToken, motivationId, 'client_beta_notice_seen', {
        path: '/licence-centre',
      })
      .catch(() => undefined);
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Beta notice"
      onClick={dismiss}
      className="fixed inset-0 z-[1000] flex items-end justify-center p-4 sm:items-center"
      style={{ background: 'rgba(0,0,0,0.55)' }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[440px] rounded-[10px] p-5"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
          boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
        }}
      >
        <p
          className="m-0 text-[11px] font-medium uppercase tracking-[.09em]"
          style={{ color: 'var(--gold-strong)' }}
        >
          Beta
        </p>
        <h2
          className="m-0 mt-1 font-[family-name:var(--font-head)] text-[20px] font-medium leading-[1.2] text-[var(--text-primary)]"
        >
          This is a beta product
        </h2>
        <p className="m-0 mt-2 text-[13.5px] leading-[1.6] text-[var(--text-secondary)]">
          The Motivation Writer is new, and it is still being hardened. If
          anything glitches — a button that does nothing, an answer that will
          not save, a document that reads wrong — please tell us immediately.
        </p>
        <p className="m-0 mt-2 text-[13.5px] leading-[1.6] text-[var(--text-secondary)]">
          Open <strong>Report a bug</strong> from your account menu (or the
          Report tab in the bottom bar on your phone) straight away. Your report
          reaches support with your username and the exact steps you took, so it
          can be fixed quickly.
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-4 flex min-h-[44px] w-full items-center justify-center rounded-[var(--r-sm)] px-4 text-[14.5px] font-medium text-white"
          style={{ background: 'var(--red)' }}
        >
          Got it — start my application
        </button>
      </div>
    </div>
  );
}
