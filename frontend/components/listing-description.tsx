// No 'use client' and no hooks: on the listing page this renders entirely on
// the server and ships no JavaScript. The sell form is a client component and
// imports it too — that just pulls it into that bundle, which is fine.
import { Fragment } from 'react';

/**
 * Renders a listing description with the structure the "Polish + add specs"
 * assistant produces: an opening line, the seller's own points as bullets,
 * then optional "Specs & details" and "From the photos" sections.
 *
 * This is a PLAIN-TEXT renderer — the description column is free text a
 * seller can type by hand, so nothing here interprets HTML or markdown, and
 * every line ends up as a React text node. A hand-typed paragraph with no
 * bullets and no headings still renders correctly: it just falls through to
 * the paragraph branch, which is why this is safe to use for every listing
 * rather than only AI-assisted ones.
 */

// Only these two are treated as headings, matched on the whole line. A
// deliberately closed set: a seller whose description happens to contain the
// line "Extras" should not get it rendered as a section header, and the
// assistant is instructed to emit exactly these.
const SECTION_HEADINGS = ['specs & details', 'from the photos'];

const BULLET_RE = /^\s*[•\-*]\s+/;

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'para'; text: string };

export function parseDescriptionBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');

  let para: string[] = [];
  let bullets: string[] = [];

  function flushPara() {
    const joined = para.join('\n').trim();
    if (joined) blocks.push({ kind: 'para', text: joined });
    para = [];
  }
  function flushBullets() {
    if (bullets.length) blocks.push({ kind: 'bullets', items: bullets });
    bullets = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (SECTION_HEADINGS.includes(trimmed.toLowerCase())) {
      flushPara();
      flushBullets();
      blocks.push({ kind: 'heading', text: trimmed });
      continue;
    }

    if (BULLET_RE.test(line)) {
      flushPara();
      const item = line.replace(BULLET_RE, '').trim();
      if (item) bullets.push(item);
      continue;
    }

    if (!trimmed) {
      // A blank line closes a bullet run but is only a paragraph break if
      // there's already a paragraph open — otherwise leading blank lines
      // would emit empty paragraphs and double the spacing.
      flushBullets();
      if (para.length) flushPara();
      continue;
    }

    flushBullets();
    para.push(line);
  }
  flushPara();
  flushBullets();

  return blocks;
}

export function ListingDescription({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = parseDescriptionBlocks(text);

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      {blocks.map((b, i) => (
        <Fragment key={i}>
          {b.kind === 'heading' && (
            <h3
              className="text-xs uppercase"
              style={{
                color: 'var(--text-tertiary)',
                letterSpacing: '0.08em',
                fontWeight: 600,
                // A hairline above the heading separates the sections
                // without adding a second border colour to the card.
                borderTop: '0.5px solid var(--border)',
                paddingTop: 12,
                marginTop: 4,
                marginBottom: -4,
              }}
            >
              {b.text}
            </h3>
          )}

          {b.kind === 'bullets' && (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {b.items.map((item, j) => (
                <li
                  key={j}
                  style={{
                    // Hanging indent: a wrapped second line lines up with
                    // the text, not under the bullet.
                    paddingLeft: 18,
                    textIndent: -18,
                    lineHeight: 1.55,
                    color: 'var(--text-primary)',
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      color: 'var(--text-tertiary)',
                      marginRight: 8,
                    }}
                  >
                    •
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          )}

          {b.kind === 'para' && (
            <p
              className="whitespace-pre-wrap"
              style={{ lineHeight: 1.6, color: 'var(--text-primary)', margin: 0 }}
            >
              {b.text}
            </p>
          )}
        </Fragment>
      ))}
    </div>
  );
}
