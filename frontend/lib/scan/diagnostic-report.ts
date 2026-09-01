import { EDGE_MARGIN, TOO_SMALL } from './guidance';
import { DECODE_MAX_EDGE, FLOOR_DPI, OUTPUT_MAX_EDGE } from './framing';
import { MIN_COVERAGE } from './mask-quad';

// ────────────────────────────────────────────────────────────────────
// THE WHOLE STATE OF THE SCANNER, AS TEXT SOMEBODY CAN PASTE.
//
// ⚠️ THIS EXISTS BECAUSE SCREENSHOTS OF A READOUT COST A DAY. Every hard bug in
// this scanner was diagnosed from the operator photographing their own phone
// and someone reading numbers off the picture — which loses anything below the
// fold, cannot be searched, and turns "what did lock say" into another round
// trip. Twice a wrong conclusion was drawn from a value that was simply not
// visible in the frame.
//
// So the rule for this file is: if a question could reasonably be asked about
// why a scan went wrong, the answer is in here. Camera, lens choice, model
// load, detector, geometry, gates, framing, the crop ladder, enhancement, OCR,
// classification, timings, environment, and a rolling event log. One block of
// text, one tap.
//
// ⚠️ AND IT MUST CARRY NO DOCUMENT CONTENT. This gets pasted into a chat
// window. A scanner's debug output is not a place to leak somebody's identity
// number, so every field is a MEASUREMENT — a count, a timing, a confidence, a
// verdict — and the one place text appears at all goes through redact(), which
// masks any run of digits long enough to be an ID, a licence or a serial.
// Unit-standard codes are deliberately exempt: they are public SAQA
// identifiers, they are the whole point of the OCR, and they are not personal.
// ────────────────────────────────────────────────────────────────────

/** SAQA unit standards, which are public and safe to print. */
const PUBLIC_CODES = /^(117705|119649|119650|119651|119652|243200|1235\d\d)$/;

/**
 * Mask anything that could identify a person.
 *
 * ⚠️ ERR TOWARDS MASKING. A 13-digit run is an SA identity number, a 6-digit
 * run might be a unit standard or might be part of one, and a mixed
 * alphanumeric run is probably a serial. Masking a harmless string costs
 * nothing; printing an identity number into a chat log cannot be undone.
 */
export function redact(text: string): string {
  return text
    // Long digit runs: identity numbers, licence numbers, phone numbers.
    .replace(/\d{7,}/g, (m) => `[${m.length}-digits]`)
    // 6-digit runs, unless they are a registered unit standard.
    .replace(/\b\d{6}\b/g, (m) => (PUBLIC_CODES.test(m) ? m : '[6-digits]'))
    // Serial-like mixed runs.
    .replace(/\b[A-Z]{1,3}\d{5,}\b/g, '[serial]')
    // Email addresses.
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]');
}

export interface ReportInput {
  build?: string;
  shape: string;
  /** Which screen the member was on when they copied. */
  phase?: string;

  camera?: {
    width: number;
    height: number;
    frameRate?: number;
    askedWidth?: number;
    askedHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    focusModes?: string[];
    torch?: boolean;
    label?: string;
    rearCount?: number;
    lenses?: string[];
    permission?: string;
  };

  /** Did the model and its runtime actually arrive? */
  assets?: {
    modelUrl?: string;
    modelBytes?: number;
    wasmBytes?: number;
    loadMs?: number;
    fromCache?: boolean;
    threads?: number;
    simd?: boolean;
    error?: string;
  };

  live?: {
    status: string;
    medianMs?: number;
    lastConfidence?: number;
    minSigma?: number;
    maskCoverage?: number;
    lock?: number;
    guide?: string;
    fpsCap?: number;
    framesSeen?: number;
    framesDropped?: number;
    detectorOff?: boolean;
  };

  frame?: {
    ink?: number;
    motion?: number;
    rawMotion?: number;
    glare?: number;
    luma?: number;
    heldMs?: number;
    blocker?: string | null;
    blockedShare?: Record<string, number>;
    readyEver?: boolean;
  };

  geometry?: {
    occupancy?: number;
    edgeMargin?: number;
    tilt?: number;
    dpi?: number | null;
    /** What this shape will actually be SAVED at, once the output cap applies. */
    savedDpi?: number | null;
    stillMs?: number;
    quadDrift?: number;
  };

  framing?: { fill: number; dpi: number; distanceMm: number; verdict: string };

  capture?: {
    source?: string;
    /** Longest edge of the DECODED photograph — see DECODE_MAX_EDGE. */
    sourceEdge?: number;
    pickedBy?: string;
    arbitration?: { worstSide: number; support: number };
    maskFit?: {
      coverage: number;
      aspect: number;
      residual: number;
      rectangularity: number;
      reject?: string;
    };
    refined?: { moved: number; skipped: number };
    seed?: { confidence: number; hits: number[] };
    detect?: { outcome: string; minConfidence?: number; ms?: number };
    outputWanted?: number;
    outputW?: number;
    outputH?: number;
    snappedTo?: string | null;
    /**
     * ⚠️ THE EVIDENCE THE ASPECT FORCING ERASES. Once a quad is forced to the
     * document's known ratio the output is A4 to four decimals whatever went
     * in, so `output` alone cannot tell a good detection from one clipped by
     * the frame. These three can, and they are the difference between "the
     * detector did well" and "we saved a tidy crop of the wrong region".
     */
    edgeMargin?: number;
    measuredRatio?: number;
    expectedRatio?: number;
    clipped?: boolean;
    filter?: string;
    grade?: string;
    reasons?: string[];
  };

  /** Where the time went, per stage, milliseconds. */
  timings?: Record<string, number>;

  /**
   * OCR, for when it lands.
   *
   * ⚠️ STATISTICS AND STRUCTURE, NEVER THE PAGE. Character counts, confidences
   * and which markers fired say everything needed to debug a classification;
   * the text itself says who the member is. `sample` is redacted and exists
   * only because garbled OCR is sometimes only diagnosable by looking at it.
   */
  ocr?: {
    engine?: string;
    where?: 'device' | 'server';
    modelBytes?: number;
    ms?: number;
    lines?: number;
    chars?: number;
    meanConfidence?: number;
    /** Detector settings, since these decided the licence-card outcome. */
    unclipRatio?: number;
    boxThresh?: number;
    /** Marker classification. */
    kind?: string;
    strength?: string;
    markersMatched?: string[];
    markersVetoed?: string[];
    /** Unit standards are public codes and print in full. */
    unitStandards?: string[];
    endorsements?: string[];
    hasMandatoryKnowledge?: boolean;
    /** Redacted, first ~400 characters. */
    sample?: string;
    error?: string;
  };

  env?: {
    userAgent?: string;
    viewport?: { width: number; height: number };
    dpr?: number;
    standalone?: boolean;
    online?: boolean;
    memoryMb?: number;
    cores?: number;
  };

  /** Rolling trace, oldest first. */
  events?: { t: number; what: string }[];
  errors?: string[];
}

/**
 * ⚠️ EVERY GATE BELOW IS IMPORTED, NEVER TYPED OUT. The old readout printed a
 * hardcoded "want 65-85" next to the fill reading. The bracket had already
 * been removed from the code, so the panel was asserting a rule that no longer
 * existed — and it was used, twice, to reach a confident wrong conclusion
 * about which build a phone was running. A threshold copied into a display is
 * a threshold that will be wrong later.
 */

function line(label: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  return `${label.padEnd(18)} ${value}`;
}
const n = (v?: number, d = 2) =>
  v === undefined || v === null || !Number.isFinite(v) ? undefined : v.toFixed(d);
/** A measured value with the gate it is judged against, so neither travels alone. */
const gated = (shown: string | undefined, gate: string) =>
  shown === undefined ? undefined : `${shown}  (${gate})`;

const pct = (v?: number) =>
  v === undefined || v === null || !Number.isFinite(v) ? undefined : `${Math.round(v * 100)}%`;
const mb = (v?: number) =>
  v === undefined || !Number.isFinite(v) ? undefined : `${(v / 1e6).toFixed(2)} MB`;

export function buildReport(r: ReportInput): string {
  const out: (string | null)[] = [];
  const at = new Date().toISOString().replace('T', ' ').slice(0, 19);

  out.push('ALL OUTDOOR SCANNER — DIAGNOSTIC REPORT');
  out.push(`taken              ${at}`);
  out.push(line('build', r.build));
  out.push(line('document', r.shape));
  out.push(line('screen', r.phase));

  if (r.camera) {
    const c = r.camera;
    out.push('', '── camera ──');
    out.push(line('stream', `${c.width}x${c.height}${c.frameRate ? ` @${Math.round(c.frameRate)}fps` : ''}`));
    out.push(line('asked for', c.askedWidth ? `${c.askedWidth}x${c.askedHeight}` : undefined));
    out.push(line('device max', c.maxWidth ? `${c.maxWidth}x${c.maxHeight}` : undefined));
    out.push(line('focus modes', c.focusModes?.length ? c.focusModes.join(', ') : 'none reported'));
    out.push(line('torch', c.torch === undefined ? undefined : c.torch ? 'available' : 'not available'));
    out.push(line('permission', c.permission));
    out.push(line('lens in use', c.label));
    out.push(line('rear lenses', c.rearCount));
    if (c.lenses?.length) for (const l of c.lenses) out.push(`                   · ${l}`);
  }

  if (r.assets) {
    const a = r.assets;
    out.push('', '── model load ──');
    out.push(line('model', a.modelUrl));
    out.push(line('model size', mb(a.modelBytes)));
    out.push(line('wasm size', mb(a.wasmBytes)));
    out.push(line('load time', a.loadMs !== undefined ? `${a.loadMs}ms` : undefined));
    out.push(line('from cache', a.fromCache === undefined ? undefined : a.fromCache ? 'yes' : 'no'));
    out.push(line('runtime', `${a.threads ?? '?'} thread(s), SIMD ${a.simd ? 'on' : 'off'}`));
    out.push(line('load error', a.error));
  }

  if (r.live) {
    const l = r.live;
    out.push('', '── live detector ──');
    out.push(line('status', l.status));
    out.push(line('median', l.medianMs !== undefined ? `${l.medianMs}ms` : undefined));
    out.push(line('fps cap', l.fpsCap));
    out.push(line('frames', l.framesSeen !== undefined ? `${l.framesSeen} seen, ${l.framesDropped ?? 0} dropped` : undefined));
    out.push(line('confidence', n(l.lastConfidence, 3)));
    out.push(line('min sigma', n(l.minSigma, 2)));
    out.push(
      line(
        'mask coverage',
        gated(pct(l.maskCoverage), 'every cell over 0.5, of the padded model square'),
      ),
    );
    out.push(line('lock', l.lock !== undefined ? `${l.lock}/3` : undefined));
    out.push(line('guidance', l.guide));
    out.push(line('detector off', l.detectorOff ? 'YES (dropped)' : undefined));
  }

  if (r.geometry) {
    const g = r.geometry;
    out.push('', '── geometry ──');
    out.push(line('fills', gated(pct(g.occupancy), `min ${pct(TOO_SMALL)}`)));
    out.push(line('edge margin', gated(pct(g.edgeMargin), `min ${pct(EDGE_MARGIN)}`)));
    out.push(line('tilt', n(g.tilt, 1) ? `${n(g.tilt, 1)}°` : undefined));
    // ⚠️ THE SAVED dpi IS SHOWN BESIDE THE MEASURED ONE, BECAUSE THEY DIFFER
    // AND THE DIFFERENCE IS NOT A FAULT. This is the live optical resolution
    // off the tracked quad; what lands in the file is capped by
    // OUTPUT_MAX_EDGE. Printing only the first made the review badge look
    // like it disagreed with the report.
    out.push(
      line(
        'dpi',
        g.dpi === null
          ? 'no document type chosen'
          : g.dpi
            ? gated(
                String(Math.round(g.dpi)),
                `floor ${FLOOR_DPI}` +
                  (g.savedDpi && Math.round(g.savedDpi) < Math.round(g.dpi)
                    ? `; saved at ${Math.round(g.savedDpi)} — output capped at ${OUTPUT_MAX_EDGE}px`
                    : ''),
              )
            : undefined,
      ),
    );
    out.push(line('held still', g.stillMs !== undefined ? `${Math.round(g.stillMs)}ms` : undefined));
    out.push(line('quad drift', n(g.quadDrift, 2)));
  }

  if (r.frame) {
    const f = r.frame;
    out.push('', '── frame gates ──');
    out.push(line('ink', n(f.ink)));
    out.push(line('motion', n(f.motion)));
    out.push(line('raw motion', n(f.rawMotion)));
    out.push(line('glare', n(f.glare, 3)));
    out.push(line('luma', n(f.luma, 0)));
    out.push(line('held', f.heldMs !== undefined ? `${Math.round(f.heldMs)}ms` : undefined));
    out.push(line('blocked by', f.blocker ?? 'nothing'));
    out.push(line('ready ever', f.readyEver === undefined ? undefined : f.readyEver ? 'yes' : 'NO'));
    if (f.blockedShare) {
      const s = Object.entries(f.blockedShare)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
        .join(' · ');
      out.push(line('time blocked', s));
    }
  }

  if (r.framing) {
    const p = r.framing;
    out.push('', '── framing plan ──');
    out.push(line('box fill', pct(p.fill)));
    out.push(line('achieves', `${p.dpi} dpi`));
    out.push(line('hold about', `${Math.round(p.distanceMm)}mm`));
    out.push(line('verdict', p.verdict));
  }

  if (r.capture) {
    const c = r.capture;
    out.push('', '── last capture ──');
    out.push(line('crop from', c.source));
    out.push(line('chosen by', c.pickedBy));
    if (c.arbitration) {
      out.push(line('worst side', n(c.arbitration.worstSide)));
      out.push(line('edge support', n(c.arbitration.support)));
    }
    if (c.maskFit) {
      const m = c.maskFit;
      // ⚠️ NOT THE SAME MEASUREMENT AS THE LIVE ONE ABOVE, DESPITE THE LABEL.
      // Live counts every above-threshold cell; this counts only the largest
      // connected blob, so this one is always the smaller of the two even at
      // identical framing. Both are fractions of the PADDED model square, not
      // of the picture — on a tall phone frame the padding alone is ~40%, so
      // a document filling the whole screen still cannot reach 60% here.
      out.push(
        line(
          'mask coverage',
          gated(pct(m.coverage), `largest blob only; min ${pct(MIN_COVERAGE)}`),
        ),
      );
      out.push(line('mask aspect', n(m.aspect)));
      out.push(line('mask residual', n(m.residual, 1)));
      out.push(line('mask rect', n(m.rectangularity)));
      out.push(line('mask verdict', m.reject ?? 'accepted'));
    }
    if (c.refined) out.push(line('refined', `${c.refined.moved}px moved, ${c.refined.skipped} side(s) skipped`));
    if (c.seed) {
      out.push(line('seed conf', n(c.seed.confidence)));
      out.push(line('seed hits', c.seed.hits.join(' / ')));
    }
    if (c.detect) {
      out.push(line('model', `${c.detect.outcome}${c.detect.minConfidence !== undefined ? ` at ${n(c.detect.minConfidence, 3)}` : ''}${c.detect.ms ? ` · ${c.detect.ms}ms` : ''}`));
    }
    // ⚠️ THE SOURCE SIZE COMES FIRST, BECAUSE IT BOUNDS EVERYTHING BELOW IT.
    // A capture that decoded at the cap threw away resolution before a single
    // measurement was taken, and every dpi printed after this line inherits
    // that loss without mentioning it.
    out.push(
      line(
        'source raster',
        c.sourceEdge
          ? `${c.sourceEdge}px long edge` +
            (c.sourceEdge >= DECODE_MAX_EDGE
              ? `  (AT THE DECODE CAP of ${DECODE_MAX_EDGE}px — the photograph was downscaled before anything was measured)`
              : '')
          : undefined,
      ),
    );
    out.push(
      line(
        'output',
        c.outputW
          ? `${c.outputW}x${c.outputH}` +
            (c.outputWanted && c.outputWanted > Math.max(c.outputW, c.outputH ?? 0)
              ? `  (WANTED ${c.outputWanted}px — TRUNCATED by the ${OUTPUT_MAX_EDGE}px output cap)`
              : `  (wanted ${c.outputWanted ?? '?'}px — cap ${OUTPUT_MAX_EDGE}px did not bind)`)
          : undefined,
      ),
    );
    out.push(line('aspect snap', c.snappedTo ?? undefined));
    out.push(line('crop edge margin', pct(c.edgeMargin)));
    out.push(
      line(
        'ratio',
        c.measuredRatio
          ? `measured ${n(c.measuredRatio)}${c.expectedRatio ? ` vs ${n(c.expectedRatio)} expected` : ''}`
          : undefined,
      ),
    );
    out.push(line('clipped', c.clipped === undefined ? undefined : c.clipped ? 'YES — page ran off the frame' : 'no'));
    out.push(line('filter', c.filter));
    out.push(line('grade', c.grade));
    if (c.reasons?.length) for (const x of c.reasons) out.push(`                   · ${x}`);
  }

  if (r.ocr) {
    const o = r.ocr;
    out.push('', '── OCR ──');
    out.push(line('engine', o.engine));
    out.push(line('ran on', o.where));
    out.push(line('model size', mb(o.modelBytes)));
    out.push(line('time', o.ms !== undefined ? `${o.ms}ms` : undefined));
    out.push(line('det unclip', n(o.unclipRatio, 2)));
    out.push(line('det box thresh', n(o.boxThresh, 2)));
    out.push(line('text', o.chars !== undefined ? `${o.chars} chars, ${o.lines ?? '?'} lines` : undefined));
    out.push(line('mean conf', n(o.meanConfidence, 2)));
    out.push(line('classified', o.kind ? `${o.kind}${o.strength ? ` (${o.strength})` : ''}` : 'nothing fired -> model'));
    out.push(line('markers hit', o.markersMatched?.join(', ')));
    out.push(line('markers vetoed', o.markersVetoed?.join(', ')));
    out.push(line('unit standards', o.unitStandards?.length ? o.unitStandards.join(', ') : 'none'));
    out.push(line('endorsements', o.endorsements?.join(', ')));
    out.push(line('117705 present', o.hasMandatoryKnowledge === undefined ? undefined : o.hasMandatoryKnowledge ? 'yes' : 'no'));
    out.push(line('error', o.error));
    if (o.sample) {
      out.push('', 'text sample (redacted):');
      for (const l of redact(o.sample).slice(0, 400).split('\n')) out.push(`  | ${l}`);
    }
  }

  if (r.timings && Object.keys(r.timings).length) {
    out.push('', '── timings (ms) ──');
    for (const [k, v] of Object.entries(r.timings).sort((a, b) => b[1] - a[1])) {
      out.push(line(k, Math.round(v)));
    }
  }

  if (r.env) {
    const e = r.env;
    out.push('', '── device ──');
    out.push(line('viewport', e.viewport ? `${e.viewport.width}x${e.viewport.height} @${e.dpr ?? 1}x` : undefined));
    out.push(line('installed', e.standalone === undefined ? undefined : e.standalone ? 'yes (PWA)' : 'no (browser)'));
    out.push(line('online', e.online === undefined ? undefined : e.online ? 'yes' : 'NO'));
    out.push(line('cores', e.cores));
    out.push(line('memory', e.memoryMb ? `${e.memoryMb} MB` : undefined));
    out.push(line('user agent', e.userAgent));
  }

  if (r.events?.length) {
    out.push('', '── events ──');
    for (const ev of r.events) out.push(`  +${String(Math.round(ev.t)).padStart(6)}ms  ${ev.what}`);
  }

  if (r.errors?.length) {
    out.push('', '── errors ──');
    for (const e of r.errors) out.push(`  · ${e}`);
  }

  out.push('', '— end of report —');
  return out.filter((l): l is string => l !== null).join('\n');
}

/**
 * Copy text, with a fallback for browsers that refuse the async clipboard.
 *
 * ⚠️ THE FALLBACK IS NOT OPTIONAL. navigator.clipboard needs a secure context
 * AND a user gesture, and iOS Safari has refused it inside some in-app browser
 * contexts — which is exactly where somebody debugging a scanner tends to be.
 * A copy button that silently does nothing is worse than no copy button.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Off-screen but not display:none — a hidden element cannot be selected.
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
