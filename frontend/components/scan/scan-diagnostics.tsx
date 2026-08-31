'use client';

// ────────────────────────────────────────────────────────────────────
// THE SCANNER, SAYING WHAT IT SEES.
//
// Operator, 2026-08-30: "is there anyway we can track whats happening on the
// phone when testing this? like a log we can send or something to troubleshoot
// this not firing?"
//
// ⚠️ THE PROBLEM IS NOT MISSING LOGS, IT IS A MISSING WITNESS. Four separate
// faults stopped auto-capture on a phone, all four invisible to every desktop
// run, and they were found by reading code and reasoning about aspect ratios.
// That worked, and it cost a fan-out of ten agents. Every one of them would
// have been a glance if the phone could say which gate was shut and what
// number shut it.
//
// So this is not a console. It is the three gates, their live values, and what
// each one had to beat — on screen, big enough to photograph, because a
// screenshot is the one thing that reliably gets off a phone and into a chat.
//
// ⚠️ NUMBERS ONLY, AND THAT IS A RULE NOT A PREFERENCE. This is one import
// away from rasters of somebody's ID document. Everything shown is a scalar
// measured FROM an image and none of it can be turned back INTO one — which is
// the same line scripts/autocapture-calib.cjs already draws: "prints
// STATISTICS ONLY: it never writes an image out and never reports anything
// that could identify a document."
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import {
  gates,
  report,
  summarise,
  type DeviceContext,
  type FrameSnapshot,
  type ScanReport,
} from '@/lib/scan/diagnostics';
import { clearDiagnostics } from '@/lib/scan/diag-flag';
import { HOLD_MS } from '@/lib/scan/autocapture';
import { aimBox } from '@/lib/scan/aim';
import {
  type CameraFacts,
  framingPlan,
  shortfall,
} from '@/lib/scan/framing';
import { type DocShape, guideAspect } from '@/lib/scan/shapes';

const OK = '#3ddc84';
const BAD = '#ff6b6b';

function Row({
  label,
  value,
  pass,
  detail,
}: {
  label: string;
  value: string;
  pass: boolean;
  detail: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', lineHeight: 1.35 }}>
      <span style={{ color: pass ? OK : BAD, width: 14, flexShrink: 0 }}>
        {pass ? '✓' : '✗'}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontWeight: 700 }}>{label}</span>{' '}
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        <span style={{ display: 'block', opacity: 0.75, fontSize: 10 }}>{detail}</span>
      </span>
    </div>
  );
}

export default function ScanDiagnostics({
  reading,
  held,
  frameMs,
  frameMotion,
  rawMotion,
  shape,
  detectorOff,
  device,
  camera,
  trail,
  lastCapture,
}: {
  reading: { ink: number; motion: number; glare: number; luma: number };
  held: number;
  frameMs: number;
  /** Whole-frame movement, for comparison against the boxed reading. */
  frameMotion?: number;
  /** The boxed measure before coarsening — the previous method. */
  rawMotion?: number;
  /** Which document shape the aim box is drawn for. */
  shape: DocShape;
  detectorOff: boolean;
  device: DeviceContext | null;
  camera: CameraFacts | null;
  trail: readonly FrameSnapshot[];
  lastCapture?: ScanReport['lastCapture'];
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const [open, setOpen] = useState(true);

  const g = gates(reading);
  const s = summarise(trail);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 40,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid rgba(255,255,255,0.35)',
          background: 'rgba(0,0,0,0.65)',
          color: '#fff',
          font: '600 11px ui-monospace, monospace',
        }}
      >
        diag
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        right: 8,
        zIndex: 40,
        padding: '9px 11px',
        borderRadius: 10,
        background: 'rgba(0,0,0,0.78)',
        color: '#fff',
        font: '400 11.5px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace',
        maxHeight: '46vh',
        overflowY: 'auto',
        // ⚠️ The member must still be able to aim. Never intercept the frame
        // itself — only the panel's own controls take taps.
        pointerEvents: 'auto',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>scanner diagnostics</strong>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button
            type="button"
            onClick={() => setOpen(false)}
            style={btn}
          >
            hide
          </button>
          <button
            type="button"
            onClick={() => {
              clearDiagnostics();
              setOpen(false);
            }}
            style={btn}
          >
            off
          </button>
        </span>
      </div>

      {/* The three gates, in the order autoBlocker checks them. */}
      {g.map((x) => (
        <Row
          key={x.key}
          label={x.label}
          value=""
          pass={x.pass}
          detail={x.detail}
        />
      ))}

      <Row
        label="Held still"
        value={`${Math.round(held)}ms`}
        pass={held >= HOLD_MS}
        detail={`needs ≥ ${HOLD_MS}ms unbroken · best so far ${s.longestHoldMs}ms`}
      />

      <hr style={{ border: 0, borderTop: '1px solid rgba(255,255,255,0.18)', margin: '7px 0' }} />

      {/* ⚠️ THE ANSWER TO "WHY DOES IT NOT FIRE", IN ONE LINE. A share of 1.00
          against `empty` is a completely different bug from 1.00 against
          `steady`, and from the outside both are a camera doing nothing. */}
      <div style={{ opacity: 0.9 }}>
        blocked by:{' '}
        {Object.entries(s.blockedBy)
          .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
          .map(([k, v]) => `${k} ${Math.round((v ?? 0) * 100)}%`)
          .join(' · ') || '—'}
      </div>
      <div style={{ opacity: 0.9 }}>
        ready at least once: {s.everReady ? 'yes' : 'NO'} · frames {s.frames} ·{' '}
        {s.medianFrameMs}ms/frame
        {detectorOff ? ' · DETECTOR DROPPED (slow device)' : ''}
      </div>
      {/* ⚠️ THE COMPARISON THAT SETTLES IT. The left number is what the
          shutter gates on, scoped to the aim box like every other reading.
          The right is the same measure over the whole frame — what it used to
          be. A big gap means the background was the problem; both high means
          the downscale under it still is. */}
      <div style={{ opacity: 0.9 }}>
        motion {Math.round(reading.motion * 100) / 100} · before coarsening{' '}
        {rawMotion === undefined ? '—' : Math.round(rawMotion * 100) / 100} ·
        whole frame{' '}
        {frameMotion === undefined ? '—' : Math.round(frameMotion * 100) / 100}
      </div>
      {/* ⚠️ THE NUMBER NOTHING HAS EVER READ. We ask for 3840x2160 `ideal`
          and take whatever arrives. This line is the difference between "the
          device caps here" and "the browser refused a 4K request the hardware
          could have met", and it decides whether an A4 page is scannable at
          all: a page is 210mm across against a card's 85.6mm, so it needs
          2.45x the pixels for the same legibility. */}
      {camera && (() => {
        const d = camera.delivered;
        const plan = d ? framingPlan(d, shape, 0.82) : null;
        const short = shortfall(camera);
        const tone =
          plan?.verdict === 'good' ? OK : plan?.verdict === 'relaxed' ? undefined : BAD;
        return (
          <div style={{ marginTop: 6, opacity: 0.9 }}>
            <span style={{ fontWeight: 700 }}>camera</span>{' '}
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              {d ? `${d.width}×${d.height}` : 'unreported'}
              {camera.frameRate ? ` @${Math.round(camera.frameRate)}fps` : ''}
            </span>
            <span style={{ display: 'block', fontSize: 10, opacity: 0.8 }}>
              asked {camera.requested.width}×{camera.requested.height}
              {camera.capable
                ? ` · max ${camera.capable.width}×${camera.capable.height}`
                : ' · max unknown'}
              {camera.focusModes.length
                ? ` · focus ${camera.focusModes.join('/')}`
                : ' · no focus control'}
            </span>
            {plan && (
              <span style={{ display: 'block', fontSize: 10, color: tone }}>
                {shape}: box {Math.round(plan.fill * 100)}% ·{' '}
                {Math.round(plan.dpi)}dpi · hold ~{Math.round(plan.distanceMm)}mm
                {' · '}
                {plan.verdict}
              </span>
            )}
            {short && (
              <span style={{ display: 'block', fontSize: 10, color: BAD }}>{short}</span>
            )}
          </div>
        );
      })()}

      {device && (
        <div style={{ opacity: 0.9 }}>
          video {device.video.w}×{device.video.h} · el {Math.round(device.element.w)}×
          {Math.round(device.element.h)} · buf {device.buffer.w}×{device.buffer.h} ·{' '}
          {/* ⚠️ 1.000 means the buffer and the CSS box still agree. Anything
              else is the aspect drift that made `ink` read zero for ever. */}
          <span style={{ color: Math.abs(device.aspectDrift - 1) < 0.02 ? OK : BAD }}>
            drift {device.aspectDrift}
          </span>
        </div>
      )}
      {/* ⚠️ THE AIM BOX, SAID OUT LOUD. The operator's A4 certificate kept
          coming back with its top and bottom cut off on one phone and not the
          other, and reading box dimensions off a scaled screenshot cannot tell
          "the fix is not in your browser yet" from "the fix does not work".
          The box's own aspect against the document's settles both at a glance:
          if they match, the box can hold the page and the fault is elsewhere;
          if the box is wider than the document, it will cut it. */}
      {device && device.element.w > 0 && (() => {
        const b = aimBox(shape, { width: device.element.w, height: device.element.h });
        const boxA = b.height ? b.width / b.height : 0;
        const docA = guideAspect(shape);
        const cuts = docA !== null && boxA > docA + 0.01;
        return (
          <div style={{ opacity: 0.9 }}>
            shape <strong>{shape}</strong> · box {Math.round(b.width)}×
            {Math.round(b.height)} · aspect{' '}
            <span style={{ color: cuts ? BAD : OK }}>{boxA.toFixed(3)}</span> ·
            doc {docA === null ? 'unknown' : docA.toFixed(3)}
            {cuts && <span style={{ color: BAD }}> — BOX CUTS THIS DOC</span>}
          </div>
        );
      })()}
      {lastCapture && (
        <div style={{ opacity: 0.9 }}>
          last crop: <strong>{lastCapture.source}</strong>
          {lastCapture.source === 'aim' && (
            <span style={{ color: BAD }}> (corners never moved — no dewarp)</span>
          )}
          {/* ⚠️ WHY IT DECLINED, NOT JUST THAT IT DID. Both phones reported
              "aim" every time, and a refusal with no numbers beside it cannot
              be told apart from a detector that never ran. hits is the share
              of scanlines that found an edge, per side — a single low one
              names which edge of the document the search could not see. */}
          {lastCapture.seed && (
            <span style={{ display: 'block', opacity: 0.85 }}>
              seed conf {lastCapture.seed.confidence} · hits{' '}
              {lastCapture.seed.hits.join('/')} · resid{' '}
              {lastCapture.seed.residuals.join('/')}
            </span>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={async () => {
          const json = JSON.stringify(
            report(
              device ??
                ({
                  ua: '',
                  dpr: 0,
                  video: { w: 0, h: 0 },
                  element: { w: 0, h: 0 },
                  buffer: { w: 0, h: 0 },
                  aspectDrift: 0,
                } as DeviceContext),
              trail,
              new Date().toISOString(),
              lastCapture,
            ),
            null,
            1,
          );
          try {
            await navigator.clipboard.writeText(json);
            setCopied('copied');
          } catch {
            // ⚠️ SAY SO RATHER THAN FAIL SILENTLY. Clipboard writes need a
            // secure context and a user gesture, and Safari refuses them
            // often enough that a dead button would be the normal case. The
            // readout above is still photographable, which is the fallback.
            setCopied('clipboard refused — screenshot this panel instead');
          }
        }}
        style={{ ...btn, marginTop: 8, width: '100%', padding: '8px 10px' }}
      >
        {copied ?? 'copy full report'}
      </button>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.35)',
  background: 'transparent',
  color: '#fff',
  font: '600 11px ui-monospace, monospace',
};
