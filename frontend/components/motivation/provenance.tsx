'use client';

// ────────────────────────────────────────────────────────────────────
// WHERE AN ANSWER CAME FROM, IN ONE VOCABULARY.
//
// Lifted out of components/licence-pack/read-result.tsx on 2026-09-06, where
// it was module-private — so the LIVE wizard, which fills far more boxes for
// the member than the pack screen ever does, showed a prefilled value as a
// grey box and a pen and said nothing at all about where it came from. A value
// somebody is about to sign their name under, with no source on it, is the one
// thing this treatment exists to prevent.
//
// ⚠️ THE PILL'S COLOUR MEANS SOMETHING, AND IT IS NEVER RED.
//   green  — we read this off your document and it is unambiguous
//   gold   — we read it but you should check it, or somebody else owes it
//   grey   — the document says nothing here, or only you know it
// A value that needs checking is not an error, and colouring it like one
// trains people to ignore the colour that does mean "stop".
//
// ⚠️ THE CHIP TEXT IS THE SERVER'S. Every provenance entry carries its own
// `from` string, and SOURCE_LABELS lives in the backend precisely so the API,
// the printed pack and the screen cannot drift. Never write a local label
// table against ProvenanceSource — that is the drift it exists to prevent.
// ────────────────────────────────────────────────────────────────────

import type { AnswerProvenance } from '@/lib/motivations-api';

export type Tone = 'read' | 'check' | 'none';

export function toneFor(
  p: AnswerProvenance | undefined,
  filled: boolean,
): Tone {
  if (!filled) return 'none';
  if (!p) return 'none';
  // ⚠️ INFERRED VALUES ARE GOLD, NOT GREEN. The server sets this flag when a
  // value was worked out rather than read — an action split out of "manually
  // operated rifle", say. Presenting a deduction as a reading is how a wrong
  // one reaches a signed form unchallenged.
  if (p.inferred) return 'check';
  if (p.source === 'MEMBER') return 'none';
  return 'read';
}

export function Pill({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  const style =
    tone === 'read'
      ? {
          background: 'var(--success-wash)',
          color: 'var(--success)',
          border: '1px solid var(--success-line)',
        }
      : tone === 'check'
        ? {
            background: 'var(--gold-wash)',
            color: 'var(--gold-strong)',
            border: '1px solid var(--gold-line)',
          }
        : {
            background: 'var(--bg-inset)',
            color: 'var(--text-tertiary)',
            border: '1px solid transparent',
          };
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-medium"
      style={style}
    >
      {children}
    </span>
  );
}

/**
 * The line UNDER a filled-in value: where it came from, and whether to check it.
 *
 * ⚠️ IT RENDERS NOTHING WITHOUT PROVENANCE, rather than guessing. "We filled
 * this in" with no source named is the claim that started this: the member
 * cannot tell an ID read off their own card from something carried across from
 * a profile they last touched two years ago.
 */
export function ProvenanceNote({
  provenance,
  className = '',
}: {
  provenance: AnswerProvenance | undefined;
  className?: string;
}) {
  if (!provenance) return null;
  const tone = toneFor(provenance, true);
  return (
    <p className={`mt-1 flex flex-wrap items-center gap-1.5 ${className}`}>
      <span className="text-xs text-[var(--text-tertiary-on-card)]">
        from {provenance.from}
      </span>
      {/* ⚠️ THE MARKER IS WORDS, NOT A COLOUR. "check this" beside an inferred
          value is the whole instruction; an amber dot on its own is invisible
          to a colour-blind reader and silent to a screen reader. */}
      {tone === 'check' && <Pill tone="check">check this</Pill>}
    </p>
  );
}
