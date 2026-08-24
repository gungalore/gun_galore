import { Injectable, Logger } from '@nestjs/common';

// ────────────────────────────────────────────────────────────────────
// GOOGLE VISION, AS PLAIN TEXT, FOR ANY DOCUMENT.
//
// Operator, 2026-08-24: "All documents must go through Google vision that
// needs OCR", and on how: Vision's text ADDED alongside the image rather than
// replacing it.
//
// That combination is the accurate one and it is worth being explicit about
// why, because the cheaper option was on the table and rejected. Claude
// reading the IMAGE sees layout — which column a serial sits in, which label a
// value belongs to — and that is what the licence-card column parse depends
// on. Vision reading the same image resolves CHARACTERS better on dense, faint
// or angled print. Handing the model both means a misread digit has to survive
// two independent readers rather than one.
//
// ⚠️ IT COSTS BOTH CALLS. There is no saving here and the operator chose it
// anyway. Do not "optimise" this into text-only later without saying so: the
// layout half is load-bearing for anything that reads a form.
//
// ⚠️ FAIL-SOFT, ALWAYS, AND THIS IS NOT OPTIONAL DECORATION. The production
// key is IP-restricted to the live box, so it 403s from anywhere else BY
// DESIGN — every developer machine and every test run. A document read that
// only works when Google answers is a document read that strands somebody in
// bad light. Every failure path returns null and the caller carries on with
// the image alone, which is exactly what it did before this existed.
// ────────────────────────────────────────────────────────────────────

const VISION_URL = 'https://vision.googleapis.com/v1/images:annotate';

/** Beyond this the prompt is being padded rather than informed. */
const MAX_TEXT_CHARS = 12_000;

@Injectable()
export class GoogleVisionOcrService {
  private readonly logger = new Logger(GoogleVisionOcrService.name);
  private readonly apiKey = process.env.GOOGLE_VISION_API_KEY ?? '';

  /** Whether a call is even worth attempting. */
  get available(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Every character Vision can find in one image, as one string.
   *
   * Returns null for "we have nothing to add" — no key, a 403, a timeout, an
   * unreadable body, or an image with no text in it. Never throws.
   */
  async text(bytes: Buffer): Promise<string | null> {
    if (!this.apiKey || !bytes?.length) return null;

    try {
      const res = await fetch(`${VISION_URL}?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: bytes.toString('base64') },
              // DOCUMENT_TEXT_DETECTION over TEXT_DETECTION: tuned for dense
              // printed text, which is what a certificate or a licence is.
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              imageContext: { languageHints: ['en'] },
            },
          ],
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        // Expected off the live box — the key is IP-restricted.
        this.logger.warn(`Vision returned HTTP ${res.status} — reading image only`);
        return null;
      }
      const body = (await res.json()) as {
        responses?: {
          error?: { message?: string };
          fullTextAnnotation?: { text?: string };
          textAnnotations?: { description?: string }[];
        }[];
      };
      const first = body?.responses?.[0];
      if (first?.error) {
        this.logger.warn(`Vision error: ${first.error.message ?? 'unknown'}`);
        return null;
      }
      // fullTextAnnotation is the whole page with its line breaks intact;
      // textAnnotations[0] is the same string on older responses.
      const raw =
        first?.fullTextAnnotation?.text ??
        first?.textAnnotations?.[0]?.description ??
        '';
      const trimmed = raw.trim();
      if (!trimmed) return null;
      return trimmed.length > MAX_TEXT_CHARS
        ? trimmed.slice(0, MAX_TEXT_CHARS)
        : trimmed;
    } catch (err) {
      this.logger.warn(
        `Vision call failed: ${(err as Error).message} — reading image only`,
      );
      return null;
    }
  }
}
