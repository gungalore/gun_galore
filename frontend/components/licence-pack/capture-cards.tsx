'use client';

// ────────────────────────────────────────────────────────────────────
// THE TWO DOORS, AS THE MOCKUP DRAWS THEM.
//
// Not buttons at the bottom of a panel — two large cards side by side at the
// TOP of the step, because capture is the first thing a member should do and
// the design puts it first. The red one is primary and carries the QR glyph;
// the white one is the file they already have.
//
// Measurements read off the artboard: cards sit in a 2-column grid capped at
// 800px, ~15px/17px padding, 8px radius, the red one filled --red with white
// ink, the white one --bg-card with a --border keyline. Title 15px/600,
// subtitle 12.5px at 80% opacity on the red and --text-tertiary on the white.
//
// ⚠️ TWO DOORS, NEVER A THIRD. The server's CaptureRoute is 'qr' | 'upload'.
// No webcam, on any surface.
//
// ⚠️ AND THE DOORS SAY WHICH DOCUMENT THEY ARE FOR. Every visible word below
// was a hard-coded literal — "Open the scanner on your phone", "Upload a
// file" — and the `title`/`subtitle` this component is handed went only to the
// scanner's own header and to an aria-label. The page mounts one of these PER
// DOCUMENT a step asks for, so the competency step drew two pixel-identical
// pairs and the dedicated step drew three, with nothing on screen saying which
// was the certificate and which the statement of results. The operator
// photographed exactly that on a live section 13 application, 2026-09-07:
// "multiple upload areas on one page".
//
// The name goes ABOVE the pair rather than inside either card, because it
// belongs to both equally — one document, two ways in.
// ────────────────────────────────────────────────────────────────────

// ⚠️ ONE GLYPH, IMPORTED. It was drawn here and again in capture-routes.tsx —
// same viewBox, same six shapes, same 1.7 stroke — on two screens meant to read
// as the same product. Two copies of an icon are two icons the moment one of
// them is nudged. See components/motivation/qr-icon.tsx.
import QrIcon from '@/components/motivation/qr-icon';
import FilePickerButton from '@/components/file-picker-button';
import ScanButton from '@/components/scan/scan-button';
import { shapeForKind } from '@/lib/scan/shapes';

function UploadIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

export default function CaptureCards({
  motivationId,
  kind,
  title,
  subtitle,
  busy = false,
  onFiles,
  onArrived,
}: {
  motivationId: string;
  kind: string;
  /** What the scanner tells the member they are photographing. */
  title: string;
  subtitle?: string;
  busy?: boolean;
  onFiles: (files: File[]) => void;
  onArrived?: (count: number) => void;
}) {
  return (
    <div className="max-w-[800px]">
      {/* The document's own name, in the checklist's words. `title` is
          required, so a pair of doors can never render unlabelled. */}
      <h3 className="text-[13.5px] font-medium leading-snug text-[var(--text-primary)]">
        {title}
      </h3>
      {subtitle && (
        <p className="mt-0.5 max-w-[70ch] text-[12.5px] leading-snug text-[var(--text-secondary)]">
          {subtitle}
        </p>
      )}

      <div className="mt-2.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {/* ⚠️ THE SCAN BUTTON IS WRAPPED, NOT RESTYLED. Its own chrome carries
            the hand-off logic, the device probe and the fallback picker; forking
            it to get the mockup's red fill would fork that behaviour too. The
            card is the surface, the component stays the control. */}
        <div className="gg-tile flex flex-col justify-between rounded-[var(--r-md)] bg-[var(--red)] px-[17px] py-[15px] text-white">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0">
              <QrIcon />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-medium leading-tight">
                Open the scanner on your phone
              </div>
              <div className="mt-1 text-[12.5px] leading-snug text-white/80">
                Scan the code — the better camera, and it lands here
              </div>
            </div>
          </div>

          <div className="mt-3 [&_button]:!border-white/40 [&_button]:!bg-white/10 [&_button]:!text-white">
            <ScanButton
              kind={kind}
              shape={shapeForKind(kind)}
              title={title}
              subtitle={subtitle}
              handoff={{ dest: 'motivation', motivationId }}
              onHandoffArrived={onArrived}
              onFiles={onFiles}
              disabled={busy}
              label="Show me the code"
              // ⚠️ NOT `null`, AND THE REASON GIVEN FOR null WAS WRONG.
              // scan-button.tsx states the invariant: "THE FILE PICKER IS
              // NEVER REPLACED, ONLY JOINED … there is no configuration of
              // this component in which the picker is absent" — because every
              // way the camera can fail (permission refused, an in-app browser
              // that denies getUserMedia silently, a desktop, a PDF from an
              // association) is a way somebody still needs to upload. It was
              // briefly passed `null` on the belief that the `sr-only`
              // sentence "was rendering as body text on every upload step".
              // It was not: `sr-only` is a Tailwind core utility, this file is
              // inside the `content` globs, and globals.css carries
              // @tailwind utilities — so it is generated and it clips. The
              // repetition the operator photographed was the two capture cards
              // themselves being unlabelled, which the heading above now fixes.
              //
              // Here the picker genuinely IS beside this control — the second
              // card — so the honest fallback is the pointer to it rather than
              // a duplicate button. It stays out of the visual design and
              // stays in the accessibility tree, which is the one place a
              // member who cannot see the card beside this one is looking.
              fallback={
                <span className="sr-only">
                  If the camera will not open, use “Choose a file” beside this.
                </span>
              }
            />
          </div>
        </div>

        <div className="gg-tile flex flex-col justify-between rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--bg-card)] px-[17px] py-[15px]">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 shrink-0 text-[var(--text-secondary)]">
              <UploadIcon />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-medium leading-tight text-[var(--text-primary)]">
                Upload a file
              </div>
              <div className="mt-1 text-[12.5px] leading-snug text-[var(--text-tertiary)]">
                A photo or a PDF you already have
              </div>
            </div>
          </div>

          <div className="mt-3">
            <FilePickerButton
              onFiles={onFiles}
              multiple
              disabled={busy}
              accept="image/jpeg,image/png,image/webp,application/pdf"
              aria-label={`Upload ${title}`}
            >
              Choose a file
            </FilePickerButton>
          </div>
        </div>
      </div>
    </div>
  );
}
