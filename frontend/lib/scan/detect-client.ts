import type { Quad } from './geometry';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

// ────────────────────────────────────────────────────────────────────
// Asking the server where the document is.
//
// The model runs on the server, not here: onnxruntime-web's smallest runtime
// is 13.3MB and the model another 12.8MB, and 26MB before a member scans
// anything is not a cost to put on a South African phone. See
// backend/src/scan/docquad.service.ts for the rest of that reasoning.
//
// ⚠️ THE QUAD COMES BACK NORMALISED, AND THAT IS THE WHOLE POINT. The server
// answers in the pixels of the image it was handed. processCapture then
// decodes that same image into a raster which `decode` QUIETLY SHRINKS above
// 3000px on the long edge — so on a 4K phone the server's pixels and the
// raster's pixels are different numbers for the same corner, and nothing
// throws when you mix them. capture.ts already carries this scar on aimBox
// ("NORMALISED, NOT PIXELS, and that is the whole point"). Same trap, same
// answer: divide by the dimensions the server used, here, once, at the
// boundary — and let the consumer multiply by whatever raster it ends up with.
// ────────────────────────────────────────────────────────────────────

/**
 * How sure the model has to be before its corners replace the aim box.
 *
 * ⚠️ MEASURED, NOT CHOSEN. Run over fifteen photographs of the operator's own
 * licence card, the minimum per-corner confidence separates the model's
 * successes from its failures with nothing in between:
 *
 *     white-on-white (all four genuinely wrong)   0.06  0.12  0.41  0.43
 *     every photograph it got right               0.83 .. 0.95
 *
 * 0.80 sits in that gap. It accepts ten and declines five, and the five it
 * declines fall through to the aim box, which is a working outcome rather
 * than a wrong crop of a statutory document.
 *
 * ⚠️ DO NOT SWAP THIS FOR THE SIGMA FIGURE. The response also carries
 * `minSigma`, and it looks like a confidence but is not one: it sits at
 * 2.5-3.4 across successes AND failures alike on the same fifteen images, so
 * it separates nothing. The reference implementation ships a 5.0 threshold on
 * it with the check commented out — they tried it and disabled it too.
 */
export const DETECT_ACCEPT = 0.8;

export interface DetectedDocument {
  /** Corners as FRACTIONS of the image, 0..1, TL TR BR BL. */
  quad: Quad;
  /** The weakest corner's confidence — min over parts, never a mean. */
  minConfidence: number;
  /** True when minConfidence clears DETECT_ACCEPT. */
  confident: boolean;
  /** Diagnostic only. Never gate on this — see DETECT_ACCEPT. */
  minSigma: number;
  /** Fraction of the frame the model's mask calls document. */
  maskCoverage: number;
  /** Server-side round trip, milliseconds. */
  ms: number;
}

/** The raw shape the endpoint returns. Kept separate so the mapping is visible. */
interface DetectResponse {
  found: boolean;
  quad?: Array<{ x: number; y: number }>;
  width?: number;
  height?: number;
  minConfidence?: number;
  minSigma?: number;
  maskCoverage?: number;
  ms?: number;
}

/**
 * Normalise the server's pixel corners against the dimensions it used.
 *
 * Exported for its own test: this is the exact step whose absence has broken
 * four separate measurement harnesses on this project, each time silently.
 */
export function normaliseQuad(
  pts: Array<{ x: number; y: number }>,
  width: number,
  height: number,
): Quad | null {
  if (pts.length !== 4 || !(width > 0) || !(height > 0)) return null;
  const out = pts.map((p) => ({ x: p.x / width, y: p.y / height }));
  if (out.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  return out as unknown as Quad;
}

/**
 * Ask the server to find the document in this frame.
 *
 * ⚠️ NEVER THROWS, ALWAYS DEGRADES. A member standing in a gun shop with one
 * bar of signal must still be able to photograph their licence. Every failure
 * — offline, timeout, 500, the model unavailable on the box, a malformed
 * response — returns null, and null means the caller falls back to the aim
 * box exactly as it did before this existed. Detection is an improvement to
 * the flow, not a dependency of it.
 */
export async function detectDocument(
  frame: Blob,
  opts: { token?: string | null; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<DetectedDocument | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  // Caller aborts (they navigated away, they retook the shot) chain through.
  opts.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    const form = new FormData();
    form.append('frame', frame, 'frame.jpg');
    const res = await fetch(`${API_URL}/scan/detect`, {
      method: 'POST',
      body: form,
      // FormData sets its own multipart boundary; setting Content-Type by hand
      // produces a boundary-less header and multer parses nothing.
      headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : {},
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const body = (await res.json()) as DetectResponse;
    if (!body.found || !body.quad || !body.width || !body.height) return null;

    const quad = normaliseQuad(body.quad, body.width, body.height);
    if (!quad) return null;

    const minConfidence = body.minConfidence ?? 0;
    return {
      quad,
      minConfidence,
      confident: minConfidence >= DETECT_ACCEPT,
      minSigma: body.minSigma ?? 0,
      maskCoverage: body.maskCoverage ?? 0,
      ms: body.ms ?? 0,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
