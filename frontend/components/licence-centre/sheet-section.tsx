'use client';

// ────────────────────────────────────────────────────────────────────
// ONE SECTION OF THE SHEET: a heading, one sentence, and a list of rows.
//
// ⚠️ `scroll-margin-top` IS THE WHOLE REASON THIS IS A COMPONENT. The section
// chips in the strip are anchor links, and the strip is sticky — so without a
// scroll margin every tap lands the heading BEHIND the strip and the member
// sees the second row of the section they asked for. 120px clears the shell
// header and the strip together.
//
// ⚠️ THE BLURB IS ONE SENTENCE. The copy rules say so and it is worth
// enforcing by shape: the screen this replaces repeated a four-line footnote
// about how sections are counted on all eleven steps, above the fold.
// ────────────────────────────────────────────────────────────────────

export interface SheetSectionProps {
  id: string;
  title: string;
  blurb: string;
  children: React.ReactNode;
}

export default function SheetSection({
  id,
  title,
  blurb,
  children,
}: SheetSectionProps) {
  return (
    <section
      id={id}
      className="scroll-mt-[120px] px-4 pb-2 pt-5"
      aria-labelledby={`${id}-h`}
    >
      <h2
        id={`${id}-h`}
        className="m-0 font-[family-name:var(--font-head)] text-[18px] font-medium leading-[1.2] tracking-[-0.01em] text-[var(--text-primary)]"
      >
        {title}
      </h2>
      {blurb ? (
        <p className="mb-0 mt-1 text-[13.5px] leading-[1.4] text-[var(--text-tertiary)]">
          {blurb}
        </p>
      ) : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}
