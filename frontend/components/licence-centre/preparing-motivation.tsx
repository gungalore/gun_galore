'use client';

import Image from 'next/image';
import { av } from '@/lib/asset-version';
import { BRAND_NAME } from '@/lib/brand';

// ────────────────────────────────────────────────────────────────────
// THE WAIT, WITH OUR NAME ON IT.
//
// Operator, 2026-09-20: "we need to hide all the download and print options...
// and show a big preparing you motivation" and "make sure the preparing
// motivation notification message has a All outdoor logo in it."
//
// ⚠️ IT IS A PANEL, NOT A TOAST, AND THAT IS THE POINT. A motivation takes
// about a minute and a half to write (see motivation-generation.service.ts),
// and while it runs there is nothing to download — the PDF endpoint refuses
// with a 409 until the gate passes. A member who is shown a Download button
// that 409s learns the product is broken. This says what is happening, that it
// is normal, and that they can leave the page open.
//
// ⚠️ THE LOGO IS THE BRAND ASSET, NOT AN EMOJI OR A SPINNER ALONE. `role`
// status plus the word "Preparing" carries the state for a screen reader; the
// logo carries who is doing the preparing for everyone else.
// ────────────────────────────────────────────────────────────────────

export default function PreparingMotivation() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-[var(--r-lg)] border border-[var(--border)] bg-[var(--bg-card)] px-5 py-8 text-center"
    >
      <Image
        src={av('/logo-nav-dark.svg')}
        alt={BRAND_NAME}
        width={177}
        height={30}
        priority
        className="mx-auto h-auto w-[177px]"
      />
      <p className="m-0 mt-5 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.25] text-[var(--text-primary)]">
        Preparing your motivation
      </p>
      <p className="mx-auto mt-2 max-w-[420px] text-[13.5px] leading-[1.5] text-[var(--text-secondary)]">
        We are writing it from your answers now. This usually takes a minute or
        two — you can leave this page open, and your pack will appear here the
        moment it is ready.
      </p>
      <div
        aria-hidden="true"
        className="mx-auto mt-5 h-[6px] w-[160px] overflow-hidden rounded-full bg-[var(--bg-inset)]"
      >
        <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--red)]" />
      </div>
    </div>
  );
}
