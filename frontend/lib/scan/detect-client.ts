import type { Quad, Rect } from './geometry';
import { type Candidate, pickCandidate } from './doccorner';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ────────────────────────────────────────────────────────────────────
// Asking the server where the document is.
//
// ⚠️ THE FALLBACK, NOT THE PATH. The phone runs the same DocCornerNet in a
// worker for the live box and for the capture itself (live-detector.ts). This
// is for a browser that could not load the runtime — and it must answer the
// same way: the server returns every pass's candidate and the choice is made
// HERE with pickCandidate, exactly as the worker path does, so both paths
// prefer the card in the box over the sheet it lies on.
//
// ⚠️ THE QUAD COMES BACK NORMALISED, AND THAT IS THE WHOLE POINT. The server
// answers in fractions of the upright image it was handed. processCapture
// then decodes that same image into a raster which `decode` QUIETLY SHRINKS
// above its cap — so on a 4K phone the server's pixels and the raster's pixels
// are different numbers for the same corner. Fractions cannot drift.
// ────────────────────────────────────────────────────────────────────

/**
 * How sure the model has to be before its corners may CROP a document.
 *
 * With DocCornerNet this is a presence probability, and it is decisive: 1.00
 * or 0.00 on 31 of 33 fixtures. 0.80 keeps the old constant's meaning — a
 * crop of a statutory document needs the model to be sure — without sitting
 * on a knife edge.
 */
export const DETECT_ACCEPT = 0.8;

export interface DetectedDocument {
  /** Corners as FRACTIONS of the image, 0..1, TL TR BR BL. */
  quad: Quad;
  /** P(document present) for the chosen pass. */
  minConfidence: number;
  /** True when minConfidence clears DETECT_ACCEPT. */
  confident: boolean;
  /** Which pass won, and why — diagnostics. */
  region: 'full' | 'aim';
  why: string;
  candidates: Candidate[];
  /** Server-side round trip, milliseconds. */
  ms: number;
}

/**
 * Why the last call came back with nothing.
 *
 * ⚠️ BECAUSE "no answer" COST A DIAGNOSIS CYCLE. Both phones reported the
 * model never answering and the cause was a 401 — the wrong guard, and the
 * token in the wrong place. Diagnostics only; nothing branches on it.
 */
export let lastDetectFailure: string | null = null;

interface DetectResponse {
  found: boolean;
  candidates?: Array<{
    quad: Array<{ x: number; y: number }>;
    score: number;
    region: 'full' | 'aim';
  }>;
  width?: number;
  height?: number;
  ms?: number;
}

/** What the caller knows that the server does not. */
export interface DetectPriors {
  /** The aim box as fractions of the frame. Enables the server's second pass. */
  aim?: Rect;
  /** The document's long/short ratio when the shape is known. */
  expectAspect?: number;
}

/**
 * Ask the server to find the document in this frame.
 *
 * ⚠️ NEVER THROWS, ALWAYS DEGRADES. A member standing in a gun shop with one
 * bar of signal must still be able to photograph their licence. Every failure
 * — offline, timeout, 500, the model unavailable on the box, a malformed
 * response — returns null, and null means the caller falls back to the aim
 * box exactly as it did before this existed.
 */
export async function detectDocument(
  frame: Blob,
  opts: DetectPriors & {
    /** A SCAN_HANDOFF action token — travels as ?t=, per ScanHandoffGuard. */
    token?: string | null;
    /** A Clerk session token — travels as a Bearer header. */
    clerkToken?: string | null;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<DetectedDocument | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const form = new FormData();
    form.append('frame', frame, 'frame.jpg');
    if (opts.aim) {
      form.append('aimX', String(opts.aim.x));
      form.append('aimY', String(opts.aim.y));
      form.append('aimW', String(opts.aim.width));
      form.append('aimH', String(opts.aim.height));
    }
    // ⚠️ THE ACTION TOKEN GOES IN ?t=, NOT IN A BEARER HEADER. ScanHandoffGuard
    // tries Authorization as a CLERK session first and only then looks for the
    // query parameter — so a scan-handoff token sent as a Bearer fails the
    // Clerk check, finds no ?t=, and 401s.
    const url = new URL(`${API_URL}/scan/detect`);
    if (opts.token) url.searchParams.set('t', opts.token);
    const res = await fetch(url.toString(), {
      method: 'POST',
      body: form,
      // FormData sets its own multipart boundary; setting Content-Type by hand
      // produces a boundary-less header and multer parses nothing.
      headers: opts.clerkToken ? { Authorization: `Bearer ${opts.clerkToken}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) {
      lastDetectFailure = `HTTP ${res.status}`;
      return null;
    }

    const body = (await res.json()) as DetectResponse;
    if (!body.found || !body.candidates || !body.width || !body.height) {
      lastDetectFailure = body.found ? 'malformed response' : 'server found nothing';
      return null;
    }
    const candidates: Candidate[] = [];
    for (const c of body.candidates) {
      if (!c.quad || c.quad.length !== 4) continue;
      const q = c.quad.map((p) => ({ x: Number(p.x), y: Number(p.y) }));
      if (q.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) continue;
      candidates.push({ quad: q as unknown as Quad, score: Number(c.score) || 0, region: c.region });
    }
    // The same admission test as the worker path, and a lower bar than the
    // crop gate: the caller reads `confident` for that.
    const pick = pickCandidate(candidates, {
      minScore: 0.5,
      frameW: body.width,
      frameH: body.height,
      expectAspect: opts.expectAspect,
      aim: opts.aim,
    });
    if (!pick) {
      lastDetectFailure = candidates.length ? 'no plausible candidate' : 'unusable corners';
      return null;
    }
    lastDetectFailure = null;
    return {
      quad: pick.quad,
      minConfidence: pick.score,
      confident: pick.score >= DETECT_ACCEPT,
      region: pick.region,
      why: pick.why,
      candidates,
      ms: body.ms ?? 0,
    };
  } catch (e) {
    lastDetectFailure =
      (e as Error)?.name === 'AbortError' ? 'timed out' : 'network error';
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
