// Public listing Q&A — cleaned, anonymised answers the seller has already given
// to other buyers through the private "Contact seller" thread.
//
// NO 'use client' AND NO COLLAPSE, deliberately. Every answer is always visible,
// so a #faq-<id> anchor always reveals something useful: the "Already answered
// in the Q&A" card in the private composer links straight here, and a closed
// accordion would have shown the buyer an empty box. Opening a targeted entry
// would need client JS; the API caps the list at 20 entries, so there is
// nothing to collapse away anyway.
//
// ⚠️ SELLERS CANNOT HIDE OR DELETE AN ANSWERED QUESTION. That is a product rule,
// not an omission: there is no hide/show/delete/report control here, and none
// may be added. Platform moderation sets ListingFaq.hiddenAt server-side; the
// API only ever returns entries that are already public.

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

export function ListingFaq({ entries, sellerReply }: ListingFaqProps) {
  return (
    <section
      id="questions"
      aria-labelledby="questions-heading"
      className="rounded-[6px] p-3 mb-4 text-sm"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <h2
        id="questions-heading"
        className="text-sm"
        style={{ color: 'var(--text-primary)', fontWeight: 500 }}
      >
        Questions &amp; answers
      </h2>
      <p
        className="text-xs mt-1 mb-3"
        style={{ color: 'var(--text-tertiary)', lineHeight: 1.5 }}
      >
        Answers this seller has given to other buyers. Personal details removed.
      </p>

      <ReplyBadge sellerReply={sellerReply} />

      {entries.length === 0 ? (
        // REQUIRED empty state, never hidden: a buyer who scrolls this far needs
        // to know the section was checked and found empty, and the copy points
        // them at the private composer directly below it.
        <p
          className="text-xs mt-3"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
        >
          No public questions yet — ask the seller below.
        </p>
      ) : (
        <div className="flex flex-col mt-2">
          {entries.map((entry, index) => (
            <article
              key={entry.id}
              // The composer's "See the full answer" link targets this id. It
              // must always reveal the answer — see the header comment.
              id={`faq-${entry.id}`}
              className="py-3"
              style={{
                // Hairline between entries, none above the first: the section
                // card already supplies that edge.
                borderTop:
                  index === 0
                    ? undefined
                    : '0.5px solid var(--border-divider)',
                // Clear the sticky header when the anchor scrolls here on a
                // phone; harmless inside the independently scrolling pane at
                // lg (same offset .gg-anchor-buy uses).
                scrollMarginTop: 'calc(var(--nav-h) + 8px)',
              }}
            >
              <h3
                className="text-sm"
                style={{
                  color: 'var(--text-primary)',
                  fontWeight: 600,
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
    </section>
  );
}
