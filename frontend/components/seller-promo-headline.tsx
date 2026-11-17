'use client';

// The seller headline, animated once on launch.
//
// WHY THIS IS A CLIENT ISLAND. The band around it stays a server component;
// only the h2 needs JavaScript, and only for one thing: deciding whether this
// launch has already played the intro. Everything visual is CSS.
//
// HOW "ONCE" IS DECIDED. A module-level flag, not storage. The server always
// renders the animated markup (its module state is never set, because effects
// do not run on the server), so the first paint already has the words in their
// from-state and there is no flash of finished text. On the client the first
// mount in this JS session animates; a client-side return to "/" mounts again
// with the flag set and renders the headline at rest. A hard reload starts a
// new session, which is a new launch and plays again.
//
// REDUCED MOTION WINS. The keyframes are unscheduled under
// prefers-reduced-motion, so the words and the pop simply are not there. There
// is no JS gate for it: a media query is the correct switch, and the copy must
// stay readable either way.

import { Fragment, useEffect, useState, type CSSProperties } from 'react';

let introPlayed = false;

const WORD_STAGGER_MS = 80;
const WORD_DURATION_MS = 460;
const POP_GAP_MS = 120;
const POP_DURATION_MS = 380;

// The copy, split into the two display lines. `red` marks the words that carry
// the brand accent; the whole phrase "100% payout" stays red, the qualifier
// after it stays ink.
const WORD_ROWS: { text: string; red?: boolean }[][] = [
  [{ text: 'Sellers' }, { text: 'list' }, { text: 'for' }, { text: 'free.' }],
  [
    { text: '100%', red: true },
    { text: 'payout', red: true },
    { text: 'on' },
    { text: 'Buy' },
    { text: 'Now.' },
  ],
];

const WORD_COUNT = WORD_ROWS.reduce((count, row) => count + row.length, 0);

// The pop starts once the last word has landed, not when the last word starts.
const POP_DELAY_MS =
  (WORD_COUNT - 1) * WORD_STAGGER_MS + WORD_DURATION_MS + POP_GAP_MS;

export function SellerPromoHeadline() {
  const [animate] = useState(
    // Server: always draw the from-state (there is no session to consult yet).
    // Client: only if this session has not played it.
    () => typeof window === 'undefined' || !introPlayed,
  );

  useEffect(() => {
    introPlayed = true;
  }, []);

  let wordIndex = 0;

  return (
    <>
      <style>{`
        .gg-seller-headline .gg-word {
          /* Transforms need a box; inline-block is what gives each word one.
             It wraps at the spaces between the spans exactly like normal text. */
          display: inline-block;
        }
        .gg-seller-headline[data-intro='play'] .gg-word {
          animation: gg-seller-word-in ${WORD_DURATION_MS}ms var(--ease-out) both;
          animation-delay: calc(var(--i, 0) * ${WORD_STAGGER_MS}ms);
        }
        .gg-seller-headline[data-intro='play'] {
          animation: gg-seller-pop ${POP_DURATION_MS}ms var(--ease-spring) both;
          animation-delay: ${POP_DELAY_MS}ms;
          /* Centre origin, not left: the 4% growth then stays inside the band's
             padding on both sides instead of pushing the page wider on a phone.
             1.04 is the largest peak that cannot reach the viewport edge at the
             container's own max width, where the side padding is thinnest. */
          transform-origin: center center;
        }
        @keyframes gg-seller-word-in {
          0% {
            opacity: 0;
            transform: translateY(0.4em) scale(0.97);
            filter: blur(3px);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
            filter: blur(0);
          }
        }
        @keyframes gg-seller-pop {
          0% { transform: scale(1); }
          45% { transform: scale(1.04); }
          100% { transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .gg-seller-headline[data-intro='play'],
          .gg-seller-headline[data-intro='play'] .gg-word {
            animation: none;
          }
        }
      `}</style>

      {/* Red stays on the display line only: at 27px+/800 it clears the 3:1
          large-text threshold in both themes, and must not drop to small ink. */}
      <h2
        id="seller-promo-heading"
        className="gg-seller-headline m-0"
        data-intro={animate ? 'play' : 'off'}
        style={{
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 'clamp(1.7rem, 7vw, 4.75rem)',
          lineHeight: 1.02,
          letterSpacing: '-0.03em',
        }}
      >
        {WORD_ROWS.map((row, rowIndex) => (
          <Fragment key={rowIndex}>
            <span className="block" style={{ textWrap: 'balance' }}>
              {row.map((word, indexInRow) => {
                const index = wordIndex++;
                return (
                  <Fragment key={`${rowIndex}-${indexInRow}`}>
                    <span
                      className="gg-word"
                      style={
                        {
                          ...(word.red ? { color: 'var(--red)' } : null),
                          '--i': index,
                        } as CSSProperties
                      }
                    >
                      {word.text}
                    </span>
                    {/* A real space, not a margin: it is what lets the line wrap
                        and what a screen reader hears between words. */}
                    {indexInRow < row.length - 1 ? ' ' : null}
                  </Fragment>
                );
              })}
            </span>
            {/* The line break is a block span, so the accessible name needs an
                explicit space between the two sentences. */}
            {rowIndex < WORD_ROWS.length - 1 ? ' ' : null}
          </Fragment>
        ))}
      </h2>
    </>
  );
}
