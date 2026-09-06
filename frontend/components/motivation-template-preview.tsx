'use client';

import type {
  TemplateColourOption,
  TemplateFormatOption,
  TemplateLayoutOption,
} from '@/lib/motivations-api';

// ────────────────────────────────────────────────────────────────────
// A MOCK PAGE, DRAWN IN THE DOM. NOT A PDF, AND THAT IS THE POINT.
//
// Operator, 2026-08-19: "we must never open it in a window with a print option
// to prevent them printing to pdf."
//
// So there is no document here to open. No <iframe>, no <embed>, no blob URL,
// no pdf.js canvas — nothing that carries a viewer toolbar with a print or a
// download button, and nothing on the wire that could be saved and passed on.
// What the member sees is a few dozen divs coloured with tokens the server
// sent. Right-click gives them a screenshot of a mock-up at 200px wide.
//
// ⚠️ THE TOKENS COME FROM THE RENDERER, VIA THE SERVER. `ink`, `tint`, `rule`
// and the feature flags are read out of motivation-pdf.service.ts by
// motivation-templates.ts. Nothing here invents a colour or decides which
// blocks a format shows — if this file held its own copy of "#2A4A32" it would
// be right until somebody adjusted the ink, and then a member would pick a
// colour, pay, and get a PDF in a different one.
//
// ⚠️ IT IS A LIKENESS, NOT A RENDER. The proportions are real (A4, 72pt
// margins, an 11pt body) but the text is grey bars. Setting real prose at
// tile size would be unreadable and at full size would be a second, drifting
// implementation of the layout. Bars say "this is what the shape looks like",
// which is the honest claim and the useful one.
// ────────────────────────────────────────────────────────────────────

/** Which page of the pack this mock stands for. */
export type PreviewPage = 'cover' | 'contents' | 'body' | 'spec';

/**
 * A4 at 595.28 x 841.89pt, the same geometry the renderer uses.
 *
 * Everything below is sized in `em` against a root that makes 1em = 10pt, so
 * one set of numbers serves the 150px tile and the 420px enlargement. A tile
 * built from px would need a second set, and the two would drift.
 */
const PT_PER_EM = 10;
const PAGE_PT_W = 595.28;
const ASPECT = 841.89 / PAGE_PT_W;

function Bars({
  lines,
  width = 100,
  gap = 1.05,
  height = 0.55,
  tone = 'rgba(0,0,0,0.28)',
  last = 70,
}: {
  lines: number;
  /** Percentage of the column. */
  width?: number;
  gap?: number;
  height?: number;
  tone?: string;
  /** The last line of a paragraph is short, as justified prose is. */
  last?: number;
}) {
  return (
    <div aria-hidden style={{ display: 'grid', gap: `${gap - height}em` }}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          style={{
            height: `${height}em`,
            width: `${i === lines - 1 ? last : width}%`,
            background: tone,
            borderRadius: '0.1em',
          }}
        />
      ))}
    </div>
  );
}

/** A heading band — the single most recognisable thing about the document. */
/** The four headings that are not the band — mirrors alternateHeader. */
function AltHeading({
  colour,
  width,
  heading,
}: {
  colour: TemplateColourOption;
  width: number;
  heading: string;
}) {
  if (heading === 'underline') {
    return (
      <div aria-hidden style={{ marginBottom: '1em', textAlign: 'center' }}>
        <div
          style={{
            height: '0.62em',
            width: `${Math.min(width, 58)}%`,
            background: colour.ink,
            margin: '0 auto 0.7em',
          }}
        />
        <div style={{ height: 1, background: colour.hair }} />
      </div>
    );
  }
  if (heading === 'numeral') {
    return (
      <div
        aria-hidden
        style={{ marginBottom: '1em', display: 'flex', alignItems: 'flex-end', gap: '0.6em' }}
      >
        <div style={{ height: '1.9em', width: '1.5em', background: colour.band }} />
        <div style={{ height: '0.62em', width: `${width}%`, background: colour.ink }} />
      </div>
    );
  }
  if (heading === 'bar') {
    return (
      <div
        aria-hidden
        style={{ marginBottom: '1em', display: 'flex', alignItems: 'center', gap: '0.5em' }}
      >
        <div style={{ height: '0.9em', width: '1.1em', background: colour.ink }} />
        <div style={{ height: '0.62em', width: `${width}%`, background: colour.ink }} />
      </div>
    );
  }
  // 'caps' — nothing but type, and more air than the others.
  return (
    <div aria-hidden style={{ marginBottom: '1.5em', marginTop: '0.4em' }}>
      <div
        style={{
          height: '0.55em',
          width: `${Math.min(width, 52)}%`,
          background: colour.mut,
          opacity: 0.85,
        }}
      />
    </div>
  );
}

function Band({
  colour,
  width = 62,
  heading,
}: {
  colour: TemplateColourOption;
  width?: number;
  /**
   * How this layout announces a section.
   *
   * ⚠️ THE HEADING IS WHAT A MEMBER ACTUALLY COMPARES, because it repeats down
   * every page while the cover is seen once. A preview whose body page looked
   * identical across all five would be showing them a difference that is not
   * where the difference is.
   */
  heading?: string;
}) {
  if (heading && heading !== 'band') {
    return <AltHeading colour={colour} width={width} heading={heading} />;
  }
  return (
    <div aria-hidden style={{ marginBottom: '1em' }}>
      {/* ⚠️ 1px, NOT 0.12em. At tile scale 1em is about 2px, so an em-sized
          hairline computes to a quarter of a pixel and the browser drops it —
          which took the heading band, the one thing that makes this document
          recognisable, out of every thumbnail. Hairlines are the one thing
          here that must not scale. */}
      <div style={{ height: 1, background: colour.ink }} />
      <div
        style={{
          background: colour.band,
          height: '2.2em',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            height: '0.62em',
            width: `${width}%`,
            background: colour.ink,
            opacity: 0.75,
            borderRadius: '0.1em',
          }}
        />
      </div>
    </div>
  );
}

export default function TemplatePreview({
  page,
  colour,
  format,
  layout,
  width,
  watermarked,
}: {
  page: PreviewPage;
  colour: TemplateColourOption;
  format: TemplateFormatOption;
  /**
   * How the document is SET. Optional so every existing caller keeps working
   * and renders the Banner layout, which is what it drew before this existed.
   *
   * ⚠️ THE MOCK HAS TO DIFFER OR THE PICKER IS A LIE. Five cards showing the
   * same picture would tell a member the layouts are interchangeable, and they
   * would pick one, pay, and download something else.
   */
  layout?: TemplateLayoutOption;
  /** Rendered width in px. Everything else scales off it. */
  width: number;
  /** Draw the PREVIEW mark, as the PDF does until the pack is settled. */
  watermarked?: boolean;
}) {
  const fontSize = width / (PAGE_PT_W / PT_PER_EM);
  const margin = 7.2; // 72pt

  return (
    <div
      aria-hidden
      className="gg-tile"
      style={{
        width,
        height: width * ASPECT,
        fontSize,
        position: 'relative',
        overflow: 'hidden',
        background: '#ffffff',
        // A hairline and a shade, so a white page reads as a sheet of paper
        // against a white card rather than dissolving into it.
        //
        // ⚠️ THE DROP SHADOW HERE COULD NEVER RENDER. globals.css opens with
        // `* { box-shadow: none !important }`, unscoped — so every raw
        // box-shadow in this app is dead unless the element carries .gg-tile.
        // The keyline was doing the whole job on its own and the "soft drop"
        // was a comment describing something nobody has ever seen. .gg-tile is
        // the house elevation and its --elev tokens are warm-tinted from the
        // ink, which is what stops a black drop going visibly grey over these
        // neutrals.
        border: '0.5px solid rgba(0,0,0,0.16)',
      }}
    >
      {page === 'cover' && (
        <>
          {/* ⚠️ THE HEAD OF THE COVER IS THE LAYOUT'S SIGNATURE, and it is the
              first thing a member compares. Banner and Ledger carry colour;
              Plate tints a field behind the title; Report draws one heavy
              rule; Classic puts nothing there at all. */}
          {(!layout || layout.cover === 'banner') && (
            <div style={{ height: '1.6em', background: colour.ink }} />
          )}
          {layout?.cover === 'plate' && (
            <div style={{ height: '4.2em', background: colour.wash }} />
          )}
          {layout?.cover === 'ledger' && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: '0.9em',
                background: colour.ink,
              }}
            />
          )}
          {layout?.cover === 'rule' && (
            <div
              style={{
                height: '0.45em',
                background: colour.ink,
                margin: `2.4em ${margin}em 0`,
              }}
            />
          )}
          <div style={{ padding: `${margin - 1.6}em ${margin}em 0` }}>
            <div style={{ height: '2.6em' }} />
            <div
              style={{
                height: '0.5em',
                width: '30%',
                background: colour.ink,
                opacity: 0.85,
                marginBottom: '1.4em',
              }}
            />
            {/* The 34pt three-line title. */}
            <div style={{ display: 'grid', gap: '0.5em' }}>
              {[62, 74, 40].map((w) => (
                <div
                  key={w}
                  style={{ height: '2.4em', width: `${w}%`, background: 'rgba(0,0,0,0.82)' }}
                />
              ))}
            </div>
            <div
              style={{
                height: '0.8em',
                width: '54%',
                background: 'rgba(0,0,0,0.4)',
                marginTop: '1.4em',
              }}
            />
            <div
              style={{
                height: '0.24em',
                width: '16%',
                background: colour.ink,
                margin: '1.9em 0 2.4em',
              }}
            />
            {/* The identification rows. */}
            <div style={{ display: 'grid', gap: '0.75em' }}>
              {[52, 74, 46, 88, 40].map((w, i) => (
                <div key={i} style={{ display: 'flex', gap: '1em' }}>
                  <div
                    style={{
                      height: '0.5em',
                      width: '22%',
                      background: 'rgba(0,0,0,0.26)',
                    }}
                  />
                  <div
                    style={{
                      height: '0.5em',
                      width: `${w * 0.62}%`,
                      background: 'rgba(0,0,0,0.55)',
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {page === 'contents' && (
        <div style={{ padding: `${margin}em ${margin}em 0` }}>
          <div style={{ height: '1.5em', width: '34%', background: colour.ink }} />
          <div
            style={{
              height: '0.2em',
              width: '13%',
              background: colour.ink,
              margin: '0.8em 0 2.2em',
            }}
          />
          {/* Entries with dot leaders and a page number, as the PDF sets them. */}
          <div style={{ display: 'grid', gap: '1.1em' }}>
            {[58, 72, 66, 50, 78, 62, 55, 70, 46].map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5em' }}>
                <div
                  style={{ height: '0.55em', width: `${w * 0.55}%`, background: 'rgba(0,0,0,0.5)' }}
                />
                <div
                  style={{
                    flex: 1,
                    height: '0.1em',
                    backgroundImage:
                      'repeating-linear-gradient(to right, rgba(0,0,0,0.32) 0 0.12em, transparent 0.12em 0.34em)',
                  }}
                />
                <div style={{ height: '0.55em', width: '0.6em', background: 'rgba(0,0,0,0.5)' }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ⚠️ A BODY PAGE IS FULL, TOP TO BOTTOM. The first version ran out of
          content a third of the way down and the mock read as a half-written
          document — the opposite of the impression the real pages give. Set
          to fill the column, because that is what the renderer produces. */}
      {page === 'body' && (
        <div style={{ padding: `${margin}em ${margin}em 0` }}>
          <Band colour={colour} width={48} heading={layout?.heading} />
          <Bars lines={4} />
          <div style={{ height: '1.2em' }} />
          <Bars lines={4} last={54} />
          <div style={{ height: '2.8em' }} />
          <Band colour={colour} width={66} heading={layout?.heading} />
          <Bars lines={5} />
          <div style={{ height: '1.2em' }} />
          <Bars lines={4} last={44} />
          <div style={{ height: '2.8em' }} />
          <Band colour={colour} width={54} heading={layout?.heading} />
          <Bars lines={5} />
          <div style={{ height: '1.2em' }} />
          <Bars lines={4} last={62} />
          <div style={{ height: '2.8em' }} />
          <Band colour={colour} width={72} heading={layout?.heading} />
          <Bars lines={5} />
          <div style={{ height: '1.2em' }} />
          <Bars lines={5} last={38} />
        </div>
      )}

      {page === 'spec' && (
        <div style={{ padding: `${margin}em ${margin}em 0` }}>
          <Band colour={colour} width={70} />
          {/* The specification sheet: label / value rows on hairlines. */}
          <div style={{ marginBottom: '2.4em' }}>
            {[70, 42, 62, 84, 38, 56, 48].map((w, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: '1em',
                  alignItems: 'center',
                  padding: '0.55em 0',
                  borderBottom: `1px solid ${colour.hair}`,
                }}
              >
                <div
                  style={{ height: '0.55em', width: '34%', background: 'rgba(0,0,0,0.62)' }}
                />
                <div
                  style={{ height: '0.55em', width: `${w * 0.6}%`, background: 'rgba(0,0,0,0.38)' }}
                />
              </div>
            ))}
          </div>

          {format.features.ownedTable && (
            <>
              <Band colour={colour} width={74} />
              {/* The owned-firearms table: a tinted header, then rows. */}
              <div style={{ background: colour.band, display: 'flex', gap: '1em', padding: '0.5em 0.6em' }}>
                {[30, 18, 22, 22].map((w, i) => (
                  <div
                    key={i}
                    style={{ height: '0.5em', width: `${w}%`, background: colour.ink, opacity: 0.7 }}
                  />
                ))}
              </div>
              {[0, 1, 2].map((r) => (
                <div
                  key={r}
                  style={{
                    display: 'flex',
                    gap: '1em',
                    padding: '0.62em 0.6em',
                    borderBottom: `1px solid ${colour.hair}`,
                  }}
                >
                  {[30, 18, 22, 22].map((w, i) => (
                    <div
                      key={i}
                      style={{ height: '0.5em', width: `${w}%`, background: 'rgba(0,0,0,0.42)' }}
                    />
                  ))}
                </div>
              ))}
              <div style={{ height: '3.4em' }} />
              {/* The signature rule and the two lines under it. */}
              <div style={{ height: 1, width: '52%', background: 'rgba(0,0,0,0.45)' }} />
              <div style={{ marginTop: '0.6em', display: 'grid', gap: '0.5em' }}>
                <div style={{ height: '0.55em', width: '30%', background: 'rgba(0,0,0,0.5)' }} />
                <div style={{ height: '0.5em', width: '24%', background: 'rgba(0,0,0,0.3)' }} />
              </div>
              {/* The disclaimer, set small and grey under a rule, as it is on
                  the real page. Without it this mock stopped halfway down and
                  read as an unfinished sheet. */}
              <div style={{ height: '2.2em' }} />
              <div style={{ height: 1, background: 'rgba(0,0,0,0.2)', marginBottom: '0.8em' }} />
              <Bars lines={4} height={0.4} gap={0.78} tone="rgba(0,0,0,0.2)" last={46} />
            </>
          )}
        </div>
      )}

      {/* ⚠️ THE MARK IS PART OF THE PREVIEW BECAUSE IT IS PART OF THE PDF.
          Showing a clean mock-up of a document that will arrive stamped is
          selling something we do not hand over. Same angle and same weight as
          the renderer's, so what they see is what they get. */}
      {watermarked && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              transform: 'rotate(-55deg)',
              fontSize: '3.4em',
              // 500 is the heaviest weight the house type scale carries.
              fontWeight: 500,
              letterSpacing: '0.18em',
              color: 'rgba(0,0,0,0.09)',
              whiteSpace: 'nowrap',
            }}
          >
            PREVIEW
          </span>
        </div>
      )}
    </div>
  );
}
