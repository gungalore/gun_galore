'use client';

// ────────────────────────────────────────────────────────────────────
// "WE FILLED IN 23 THINGS BEFORE YOU TYPED ANYTHING."
//
// ⚠️ THE COUNT IS THE SERVER'S AND IS NEVER RECOMPUTED HERE. It is counted
// against the ANSWERS, not against the provenance map: a field we filled and
// the member then cleared is not something we filled for them, and a banner
// claiming credit for work that is not on the screen is worse than no banner.
//
// ⚠️ AND THE SOURCE NAMES ARE THE SERVER'S TOO. Every provenance entry carries
// its own `from` string, and SOURCE_LABELS lives in the backend precisely so
// the API, the printed pack and this banner cannot drift — the same words
// appear in all three. A label table in the frontend would be that drift.
// ────────────────────────────────────────────────────────────────────

import type { MotivationPack } from '@/lib/motivations-api';

export default function PrefillBanner({
  prefill,
  provenance,
}: {
  prefill: MotivationPack['prefill'];
  provenance: MotivationPack['provenance'];
}) {
  // Nothing filled is not a banner saying zero — it is no banner.
  if (prefill.filled <= 0) return null;

  // One label per source, in the server's own words, taken from the first
  // entry that carries each source. Falls back to nothing rather than to a
  // guess: an unrecognised source is a deploy skew, not a thing to invent copy
  // for, and the count above is true either way.
  const seen = new Map<string, string>();
  for (const entry of Object.values(provenance)) {
    if (entry?.source && entry.from && !seen.has(entry.source)) {
      seen.set(entry.source, entry.from);
    }
  }
  const names = prefill.sources
    .map((s) => seen.get(s))
    .filter((v): v is string => Boolean(v));

  return (
    <div
      className="rounded-[var(--r-md)] border px-3 py-2.5"
      style={{
        borderColor: 'var(--success-line)',
        background: 'var(--success-wash)',
      }}
    >
      <p className="text-[14px] text-[var(--text-primary)]">
        We filled in{' '}
        <span className="font-medium">{prefill.filled}</span>{' '}
        {prefill.filled === 1 ? 'answer' : 'answers'} before you typed
        anything.
      </p>

      {names.length > 0 && (
        <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
          {names.join(' · ')}
        </p>
      )}

      {/* ⚠️ SAY THEY CAN CHANGE IT, EVERY TIME. Values we filled are the
          member's to correct, and a member who believes an answer is locked
          signs a form carrying something they would have fixed. */}
      <p className="mt-1 text-[12px] text-[var(--text-tertiary)]">
        Everything here is yours to change.
      </p>
    </div>
  );
}
