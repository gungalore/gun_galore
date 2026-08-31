'use client';

import { useRef } from 'react';
import { av } from '@/lib/asset-version';
import { T, primaryBtn } from '../scan-theme';

// ────────────────────────────────────────────────────────────────────
// THE ENTRY SCREEN. Two ways in, and a promise about where it goes.
//
// ⚠️ "CHOOSE A PHOTO" IS A NEW ROUTE, NOT A RESKIN. The scanner has only ever
// been able to photograph something live. A member who already has a picture of
// their licence — taken last week, sent by their dealer, saved from an email —
// had no way to put it through the straightening and the quality check, and
// ended up uploading a raw phone photo that nothing could read.
//
// Same pipeline either way. The only difference is where the pixels came from.
// ────────────────────────────────────────────────────────────────────

const CAMERA_ICON = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 8.5A1.5 1.5 0 014.5 7h2.2l1.2-2h6.2l1.2 2h2.2A1.5 1.5 0 0119 8.5v8A1.5 1.5 0 0117.5 18h-13A1.5 1.5 0 013 16.5v-8z" />
    <circle cx="11" cy="12" r="3.2" />
  </svg>
);

const FOLDER_ICON = (
  <svg
    width="24"
    height="24"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M3 7.5A1.5 1.5 0 014.5 6h4l2 2.5h9A1.5 1.5 0 0121 10v7.5A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-10z" />
    <path d="M12 12v4M10 14h4" />
  </svg>
);

function Card({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        textAlign: 'left',
        padding: 16,
        minHeight: T.tap,
        border: `1px solid ${T.border}`,
        borderRadius: T.r.md,
        background: T.card,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <span
        style={{
          width: T.tap,
          height: T.tap,
          flex: 'none',
          borderRadius: T.r.md,
          background: T.inset,
          color: T.red,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: 'block',
            fontFamily: T.head,
            fontSize: 16,
            fontWeight: 600,
            color: T.ink,
          }}
        >
          {title}
        </span>
        <span
          style={{
            display: 'block',
            fontSize: 13,
            lineHeight: 1.4,
            marginTop: 3,
            color: T.ink2,
          }}
        >
          {desc}
        </span>
      </span>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={T.red}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ flex: 'none' }}
        aria-hidden="true"
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

export default function AddDocument({
  onCamera,
  onFiles,
  onClose,
  existing,
  onUseExisting,
}: {
  onCamera: () => void;
  /** Pictures the member already had. Runs the same pipeline. */
  onFiles: (files: File[]) => void;
  onClose: () => void;
  /** Pages already captured this session, if they came back here. */
  existing?: number;
  onUseExisting?: () => void;
}) {
  const picker = useRef<HTMLInputElement | null>(null);

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
          gap: 10,
          padding: '14px 16px',
          borderBottom: `1px solid ${T.divider}`,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={av('/logo-mark-dark.svg')}
          alt=""
          aria-hidden="true"
          style={{ height: 26, width: 'auto' }}
        />
        <span
          style={{
            flex: 1,
            fontFamily: T.head,
            fontSize: 15,
            fontWeight: 600,
            color: T.ink,
          }}
        >
          Document Centre
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            width: T.tap,
            height: T.tap,
            border: 'none',
            background: 'none',
            color: T.ink2,
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
          >
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 16px' }}>
        <h1
          style={{
            margin: 0,
            fontFamily: T.head,
            fontSize: 27,
            lineHeight: 1.15,
            fontWeight: 700,
            textWrap: 'balance',
          }}
        >
          Add a document
        </h1>
        <p
          style={{
            margin: '8px 0 20px',
            fontSize: 14,
            lineHeight: 1.5,
            color: T.ink2,
          }}
        >
          It goes straight to your documents, ready at your computer.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Card
            icon={CAMERA_ICON}
            title="Photograph it"
            desc="We find the edges, straighten the page and take the shadow off."
            onClick={onCamera}
          />
          <Card
            icon={FOLDER_ICON}
            title="Choose a photo"
            desc="Pictures already on your phone. Up to 20 pages at a time."
            onClick={() => picker.current?.click()}
          />
        </div>

        {/* ⚠️ NO `capture` ATTRIBUTE. Adding it forces the camera on Android and
            defeats the entire point of this second route. Its absence is what
            makes the picker offer the gallery. */}
        <input
          ref={picker}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []).slice(0, 20);
            // Reset so choosing the same file twice still fires.
            e.target.value = '';
            if (files.length) onFiles(files);
          }}
        />

        <div
          style={{
            marginTop: 22,
            padding: '14px 16px',
            borderRadius: T.r.md,
            background: T.inset,
          }}
        >
          <div
            style={{
              fontFamily: T.head,
              fontSize: 13,
              fontWeight: 600,
              color: T.ink,
            }}
          >
            Nothing here is public
          </div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.45,
              marginTop: 3,
              color: T.ink2,
            }}
          >
            Your documents are yours. Nothing is shown on a listing or shared
            with a buyer.
          </div>
        </div>
      </div>

      {existing && existing > 0 && onUseExisting ? (
        <div
          style={{
            flex: 'none',
            padding: '0 16px max(16px, env(safe-area-inset-bottom))',
          }}
        >
          <button type="button" onClick={onUseExisting} style={{ ...primaryBtn, width: '100%' }}>
            Save the {existing} {existing === 1 ? 'page' : 'pages'} I have
          </button>
        </div>
      ) : null}
    </div>
  );
}
