'use client';

import { type DocShape, SHAPES, SHAPE_ORDER, guideAspect, holdHint } from '@/lib/scan/shapes';
import { T, primaryBtn, quietBtn } from '../scan-theme';

// ────────────────────────────────────────────────────────────────────
// WHAT ARE YOU PHOTOGRAPHING.
//
// ⚠️ THE ANSWER IS LOAD-BEARING, WHICH IS WHY THIS CANNOT BE SKIPPED. It is
// not a convenience: the document's known millimetres are what make dpi
// measurable, what set the output's true proportions when perspective has
// destroyed them, and what size the aim box. 'Something else' used to exist
// and silently switched all three off.
//
// The glyph is drawn at each document's REAL aspect. A member recognises the
// shape of their own licence faster than they read its name, and a glyph at
// the wrong proportions teaches them to hold the phone wrong.
// ────────────────────────────────────────────────────────────────────

const TICK = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke={T.red}
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flex: 'none' }}
    aria-hidden="true"
  >
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

/** The document at its true proportions, sized to fit a 44px slot. */
function Glyph({ shape, on }: { shape: DocShape; on: boolean }) {
  const a = guideAspect(shape) ?? 0.7;
  const box = 38;
  const w = a >= 1 ? box : box * a;
  const h = a >= 1 ? box / a : box;
  return (
    <span
      style={{
        width: T.tap,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <span
        style={{
          width: Math.round(w),
          height: Math.round(h),
          border: `2px solid ${on ? T.red : T.ink3}`,
          borderRadius: 2,
          display: 'block',
        }}
      />
    </span>
  );
}

export default function DocumentType({
  shape,
  picked,
  onShape,
  multi,
  onMulti,
  onStart,
  onBack,
}: {
  shape: DocShape;
  /** Has anyone actually chosen, or is this just the default? */
  picked: boolean;
  onShape: (s: DocShape) => void;
  multi: boolean;
  onMulti: (v: boolean) => void;
  onStart: () => void;
  onBack: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: T.bg,
        color: T.ink,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: T.font,
      }}
    >
      <div
        style={{
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 8px',
          borderBottom: `1px solid ${T.divider}`,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          style={{
            width: T.tap,
            height: T.tap,
            border: 'none',
            background: 'none',
            color: T.ink,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M11 18l-6-6 6-6" />
          </svg>
        </button>
        <span style={{ fontFamily: T.head, fontSize: 16, fontWeight: 600 }}>
          Add a document
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 16px' }}>
        <h2
          style={{
            margin: 0,
            fontFamily: T.head,
            fontSize: 20,
            fontWeight: 700,
            textWrap: 'balance',
          }}
        >
          What are you photographing?
        </h2>
        <p
          style={{
            margin: '6px 0 16px',
            fontSize: 13,
            lineHeight: 1.45,
            color: T.ink2,
          }}
        >
          {picked
            ? 'We will check the photo is sharp enough to read.'
            : 'Pick one so we can check the photo is sharp enough to read.'}
        </p>

        <div
          role="radiogroup"
          aria-label="What are you photographing?"
          style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
        >
          {SHAPE_ORDER.map((k) => {
            const spec = SHAPES[k];
            const on = picked && shape === k;
            return (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onShape(k)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  width: '100%',
                  textAlign: 'left',
                  minHeight: 64,
                  padding: '12px 14px',
                  borderRadius: T.r.md,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  border: on ? `2px solid ${T.red}` : `1px solid ${T.border}`,
                  background: on ? T.redWash : T.card,
                }}
              >
                <Glyph shape={k} on={on} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: T.head,
                      fontSize: 15,
                      fontWeight: 600,
                      color: T.ink,
                    }}
                  >
                    {spec.label}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 12.5,
                      lineHeight: 1.35,
                      marginTop: 2,
                      color: T.ink3,
                    }}
                  >
                    {spec.examples}
                  </span>
                  {on && holdHint(k) ? (
                    <span
                      style={{
                        display: 'block',
                        fontSize: 12,
                        marginTop: 4,
                        color: T.red,
                        fontWeight: 600,
                      }}
                    >
                      Hold it {holdHint(k)}
                    </span>
                  ) : null}
                </span>
                {on ? TICK : null}
              </button>
            );
          })}
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 18,
            padding: '12px 14px',
            border: `1px solid ${T.border}`,
            borderRadius: T.r.md,
            minHeight: T.tap,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={multi}
            onChange={(e) => onMulti(e.target.checked)}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }}
          />
          <span
            aria-hidden="true"
            style={{
              width: 42,
              height: 26,
              flex: 'none',
              borderRadius: 999,
              background: multi ? T.red : T.border,
              position: 'relative',
              transition: 'background 140ms ease-out',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 3,
                left: multi ? 19 : 3,
                width: 20,
                height: 20,
                borderRadius: '50%',
                background: '#fff',
                transition: 'left 140ms ease-out',
              }}
            />
          </span>
          <span style={{ flex: 1, fontSize: 13.5, lineHeight: 1.35 }}>
            {SHAPES[shape].multiLabel}
          </span>
        </label>
      </div>

      <div
        style={{
          flex: 'none',
          padding: '0 16px max(16px, env(safe-area-inset-bottom))',
          display: 'flex',
          gap: 10,
        }}
      >
        <button type="button" onClick={onBack} style={{ ...quietBtn, flex: 'none', padding: '0 18px' }}>
          Back
        </button>
        {/* ⚠️ DISABLED UNTIL SOMETHING IS CHOSEN. There is no sizeless shape to
            fall through to any more, so an unanswered chooser would scan
            whatever the default happened to be — and a card measured as an A4
            reports a quarter of its true resolution and passes a floor it
            should have failed. */}
        <button
          type="button"
          onClick={onStart}
          disabled={!picked}
          style={{
            ...primaryBtn,
            flex: 1,
            background: picked ? T.red : 'rgba(26,22,19,0.12)',
            color: picked ? '#fff' : T.ink3,
            cursor: picked ? 'pointer' : 'default',
          }}
        >
          Open the camera
        </button>
      </div>
    </div>
  );
}
