'use client';

// ────────────────────────────────────────────────────────────────────
// "ARE THESE THE SAFE AT THIS ADDRESS?" — the one question only the member
// can answer, and until now the one nothing on screen asked.
//
// The server holds photographs of a safe back from the automatic attach and
// reports `needsPlaceConfirm`. A safe photograph does not go stale with time —
// it goes WRONG when somebody moves house, and nothing on the file says so, so
// reusing last year's shots ships a pack showing the wrong premises. That is
// not a question we can answer for them, which is why it is asked rather than
// assumed.
//
// ⚠️ THIS EXISTED ONLY INSIDE `suggested-documents.tsx`, WHICH IS MOUNTED BY
// NOBODY. It belonged to the wizard Phase 4 deleted, so the tick shipped, the
// server waited for it, and no screen ever put it in front of anybody — the
// same way the pre-filled SAPS 271 and the delete button were lost. Lifted out
// here so the review sheet can mount it, and so there is one wording rather
// than two.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';

export default function PlaceConfirm({
  onConfirm,
}: {
  /** Re-run the automatic attach, this time with the place confirmed. */
  onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="mt-3 rounded-[var(--r-sm)] border p-3"
      style={{
        borderColor: 'var(--gold-line)',
        background: 'var(--gold-wash)',
      }}
    >
      <p className="m-0 text-[14px] font-medium text-[var(--text-primary)]">
        One more thing before we add your safe photographs
      </p>
      {/* ⚠️ SAY WHY, NOT JUST WHAT. A tick with no reason reads as a formality
          and gets tapped without thought — and the whole point of the question
          is that somebody who has moved house should stop and think. */}
      <p className="m-0 mt-1 text-[12.5px] leading-[1.45] text-[var(--text-secondary)]">
        Your Document Centre has photographs of a safe. We will only put them
        on this application if they are the safe at this address — if you have
        moved since, they show the wrong premises.
      </p>
      <label className="mt-2 flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          className="mt-0.5 h-5 w-5"
          disabled={busy}
          onChange={async (e) => {
            // ⚠️ ONE WAY ONLY. Unticking cannot un-attach what the server has
            // already copied, so offering it would be a control that lies.
            // The member removes a document the way they remove any other.
            if (!e.target.checked || busy) return;
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        />
        <span>
          {busy
            ? 'Adding your safe photographs…'
            : 'These are the safe at the address on this application.'}
        </span>
      </label>
    </div>
  );
}
