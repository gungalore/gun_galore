'use client';

// Public listing Q&A — cleaned, anonymised answers the seller has already given
// to other buyers through the private "Contact seller" thread.
//
// 2026-11-26 operator: "The questions and answers should be grouped in one box
// that is expandable. then the question in bold with the answer below it. Then
// the next question below in bold and the answer below it and so on."
//
// So the whole section is ONE card with a native <details> disclosure. Closed,
// the buyer sees the heading and how many questions are answered; opening it
// reveals the reply badge, every answered question (bold) with its answer
// underneath, and the private "Ask the seller a question" composer. The
// composer stays inside this card because the answers and the ask belong
// together (operator, 2026-11-23).
//
// ⚠️ ANCHORS STILL WORK. The private composer's "See the full answer" link
// targets `#faq-<id>`; a closed <details> would hide it. A hashchange/mount
// listener opens the disclosure whenever the URL targets the section or one
// of its answers, so the deep link always reveals content.
//
// ⚠️ SELLERS CANNOT HIDE OR DELETE AN ANSWERED QUESTION. That is a product rule,
// not an omission: there is no hide/show/delete/report control here, and none
// may be added. Platform moderation sets ListingFaq.hiddenAt server-side; the
// API only ever returns entries that are already public.

import { useEffect, useRef, type ReactNode } from 'react';

export interface ListingFaqEntry {
  id: string;
  question: string;
  answer: string;
}

export interface ListingFaqSellerReply {
  label: string;
  sampleSize: number;
}

export interface ListingFaqProps {
  entries: ListingFaqEntry[];
  sellerReply: ListingFaqSellerReply | null;
  /**
   * The private ask-the-seller thread, rendered INSIDE this card.
   *
   * The public answers and the composer that produces the next one are one
   * section to a buyer: read what the seller has already answered, then ask if
   * it is not covered. Two stacked cards made them look unrelated and buried
   * the composer (operator, 2026-11-23: "consolidate into one neat section as
   * they are directly correlated").
   */
  children?: ReactNode;
}

/**
 * Reply-time badge. Rendered in both the populated and the empty state — an
 * empty Q&A on a fast-replying seller is still useful information for the
 * buyer, and hiding the badge would make "no questions" read like "no seller".
 *
 * The label itself is authored backend-side ("Usually replies within 3 hours");
 * this component never composes or invents a reply-time claim. The sample size
 * is intentionally not printed: the subtext explains the basis in plain words
 * and a raw count invites the reader to do statistics the number cannot support.
 *
 * ⚠️ TWO SHAPES HAVE TO WORK. The documented contract is
 * `sellerReply: { label, sampleSize } | null`, but the backend's
 * seller-reply-time helper returns a non-null object even when the sample is
 * too small, with the label "New seller — reply time not yet known" and a
 * sampleSize below its 3-reply floor. Attaching "Based on this seller's recent
 * replies" to that label would contradict it, so the subtext only appears once
 * there is a real sample. Keep MIN_REPLY_SAMPLES in step with
 * backend/src/listings/seller-reply-time.ts.
 */
const MIN_REPLY_SAMPLES = 3;

function ReplyBadge({
  sellerReply,
}: {
  sellerReply: ListingFaqSellerReply | null;
}) {
  return (
    <div
      data-listing-faq-reply="true"
      className="rounded-[6px] px-3 py-2"
      style={{
        background: 'var(--bg-inset)',
        border: '0.5px solid var(--border)',
      }}
    >
      {sellerReply ? (
        <>
          <p
            className="text-xs"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            {sellerReply.label}
          </p>
          {sellerReply.sampleSize >= MIN_REPLY_SAMPLES && (
            <p
              className="text-[11px] mt-0.5"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Based on this seller&apos;s recent replies.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          New seller — reply time not yet known
        </p>
      )}
    </div>
  );
}

export function ListingFaq({
  entries,
  sellerReply,
  children,
}: ListingFaqProps) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  useEffect(() => {
    function openForHash() {
      const hash = window.location.hash;
      if (hash === '#questions' || hash.startsWith('#faq-')) {
        if (detailsRef.current) detailsRef.current.open = true;
      }
    }
    openForHash();
    window.addEventListener('hashchange', openForHash);
    return () => window.removeEventListener('hashchange', openForHash);
  }, []);

  const answeredLabel =
    entries.length === 0
      ? 'No questions answered yet'
      : `${entries.length} answered question${entries.length === 1 ? '' : 's'}`;

  return (
    <section
      id="questions"
      aria-labelledby="questions-heading"
      className="rounded-[6px] text-sm"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <details ref={detailsRef} className="group">
        <summary
          className="flex cursor-pointer items-center justify-between gap-3 px-3 py-3"
          style={{ listStylePosition: 'inside' }}
        >
          <span className="min-w-0">
            <h2
              id="questions-heading"
              className="m-0 text-sm"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Questions &amp; answers
            </h2>
            <span
              className="mt-0.5 block text-xs"
              style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
            >
              {answeredLabel} — answers this seller has given to other buyers.
            </span>
          </span>
          <svg
            aria-hidden
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
            style={{ color: 'var(--text-tertiary)' }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>

        <div
          className="px-3 pb-3"
          style={{ borderTop: '0.5px solid var(--border-divider)' }}
        >
          <div className="pt-3">
            <ReplyBadge sellerReply={sellerReply} />
          </div>

          {entries.length === 0 ? (
            // REQUIRED empty state, never hidden: a buyer who opens this
            // section needs to know it was checked and found empty, and the
            // copy points them at the private composer directly below it.
            <p
              className="text-xs mt-3 mb-0"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
            >
              No public questions yet — ask the seller below.
            </p>
          ) : (
            <div className="flex flex-col mt-2">
              {entries.map((entry, index) => (
                <article
                  key={entry.id}
                  // The composer's "See the full answer" link targets this id.
                  id={`faq-${entry.id}`}
                  className="py-3"
                  style={{
                    borderTop:
                      index === 0
                        ? undefined
                        : '0.5px solid var(--border-divider)',
                    // Clear the sticky header when the anchor scrolls here on
                    // a phone; harmless inside the independently scrolling
                    // pane at lg (same offset .gg-anchor-buy uses).
                    scrollMarginTop: 'calc(var(--nav-h) + 8px)',
                  }}
                >
                  <h3
                    className="text-sm"
                    style={{
                      color: 'var(--text-primary)',
                      fontWeight: 700,
                      lineHeight: 1.5,
                      margin: 0,
                    }}
                  >
                    {entry.question}
                  </h3>
                  <p
                    className="text-sm mt-1.5 whitespace-pre-wrap"
                    style={{
                      color: 'var(--text-secondary)',
                      lineHeight: 1.6,
                      margin: 0,
                    }}
                  >
                    {entry.answer}
                  </p>
                </article>
              ))}
            </div>
          )}

          {/* The private ask-the-seller composer, behind its own disclosure so
              the textarea does not occupy space before the seller card on a
              phone. Collapsed content stays in the DOM, so anchors into it
              keep working. */}
          {children ? (
            <details
              className="mt-3 pt-3"
              style={{ borderTop: '0.5px solid var(--border-divider)' }}
            >
              <summary
                className="text-xs cursor-pointer"
                style={{ color: 'var(--text-secondary)', fontWeight: 500 }}
              >
                Ask the seller a question
              </summary>
              <div className="mt-3">{children}</div>
            </details>
          ) : null}
        </div>
      </details>
    </section>
  );
}
