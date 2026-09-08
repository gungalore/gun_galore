'use client';

import type { PreviewSection } from './contract';

// ────────────────────────────────────────────────────────────────────
// "WHAT YOUR MOTIVATION WILL SAY".
//
// ⚠️ IT IS ALSO A MAP OF WHAT THE DOCUMENT WILL CONTAIN, which is why an empty
// section is KEPT rather than dropped. A member scrolling this can see that
// "The calibre" is a section they will never have to write. Hiding empties
// would make headings appear as they answered, which reads as the document
// being invented around them.
//
// ⚠️ THE MARKED SENTENCES ARE THE WHOLE FEATURE. A member taps a tile and
// watches that exact sentence land here, highlighted. Without the marking this
// is a wall of text that happens to change, and the tap teaches them nothing.
// ────────────────────────────────────────────────────────────────────

/** A paragraph, with the card-derived sentences inside it marked. */
function Paragraph({
  text,
  fromCards,
}: {
  text: string;
  fromCards: string[];
}) {
  // ⚠️ EXACT MATCH ON THE WHOLE PARAGRAPH, NOT A SUBSTRING SEARCH. A card
  // sentence IS a paragraph in the preview — the server emits it as one — so
  // there is nothing to split, and a substring highlighter would eventually
  // mark a fragment of somebody's own prose that happened to overlap.
  const marked = fromCards.includes(text);
  if (!marked) {
    return (
      <p className="m-0 mb-2 text-[13.5px] leading-[1.5] text-[var(--text-secondary)]">
        {text}
      </p>
    );
  }
  return (
    <p className="m-0 mb-2 text-[13.5px] leading-[1.5] text-[var(--text-secondary)]">
      <mark className="bg-[var(--red-wash)] text-[var(--text-primary)]">
        {text}
      </mark>
    </p>
  );
}

export interface PreviewPanelProps {
  preview: PreviewSection[];
}

export default function PreviewPanel({ preview }: PreviewPanelProps) {
  return (
    <div className="px-4 py-3">
      <p className="m-0 mb-3 text-[11px] font-medium uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        What your motivation will say
      </p>
      {preview.map((s) => (
        <section key={`${s.id}-${s.heading}`} className="mb-4">
          <h3 className="m-0 mb-1 font-[family-name:var(--font-head)] text-[13.5px] font-medium text-[var(--text-primary)]">
            {s.heading}
          </h3>
          {s.paragraphs.length ? (
            s.paragraphs.map((p, i) => (
              <Paragraph key={i} text={p} fromCards={s.fromCards} />
            ))
          ) : (
            // ⚠️ FAINT AND ITALIC, AND NEVER BLANK. A section we hold nothing
            // for says what it will say once it has something — which is how a
            // member can tell "not written yet" from "nothing to write".
            <p className="m-0 text-[13px] italic leading-[1.5] text-[var(--text-faint)]">
              {s.placeholder}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
