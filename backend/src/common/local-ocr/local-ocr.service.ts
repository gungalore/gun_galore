import { Injectable, Logger } from '@nestjs/common';

export interface LocalOcrRead {
  text: string;
  /** PaddleOCR-VL does not report a calibrated score; validators do the work. */
  confidence: number;
}

interface PaddleResponse {
  texts?: unknown;
}

/**
 * PADDLEOCR-VL-1.6, RUNNING ON THIS MACHINE.
 *
 * ⚠️ THE MODEL IS A PYTHON SERVICE, NOT A NODE DEPENDENCY. PaddleOCR-VL is a
 * 0.9B vision-language parser with no maintained Node runtime; the adapter is a
 * tiny FastAPI process (`backend/ocr/paddleocr_vl_server.py`) that loads the
 * model once and answers one batched request with one line of text per crop.
 *
 * ⚠️ THIS IS THE FAST PATH, NOT A REPLACEMENT FOR GEMINI. The extractor only
 * keeps a local read when the field has a deterministic validator (ID number,
 * date, exact choice, printed number). Names, addresses, makes, models and
 * serials still go to the vision reader with the Jev crop beside them.
 *
 * ⚠️ FAIL-SOFT. Service down, model still loading, a bad crop or a timeout all
 * return nulls; the upload continues down the existing Gemini path.
 */
@Injectable()
export class LocalOcrService {
  private readonly logger = new Logger(LocalOcrService.name);

  isEnabled(): boolean {
    return process.env.LOCAL_OCR_ENABLED !== 'false';
  }

  /**
   * Read a batch of crops. The returned array is always the same length as the
   * input; a null entry means "use the vision reader for this field".
   */
  async readMany(images: Buffer[]): Promise<(LocalOcrRead | null)[]> {
    if (!this.isEnabled() || !images.length) {
      return images.map(() => null);
    }
    const url = process.env.PADDLE_OCR_URL ?? 'http://127.0.0.1:8090/ocr';
    const controller = new AbortController();
    const timeoutMs = Number(process.env.PADDLE_OCR_TIMEOUT_MS ?? 180_000);
    const timeout = setTimeout(
      () => controller.abort(),
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 180_000,
    );
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: images.map((image) => image.toString('base64')),
          task: 'ocr',
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        this.logger.warn(
          `PaddleOCR-VL returned ${res.status}; falling back to the vision reader.`,
        );
        return images.map(() => null);
      }
      const data = (await res.json()) as PaddleResponse;
      if (!Array.isArray(data.texts)) {
        this.logger.warn(
          'PaddleOCR-VL returned no text array; falling back to the vision reader.',
        );
        return images.map(() => null);
      }
      const texts: unknown[] = data.texts;
      return images.map((_, index) => {
        const raw = texts[index];
        if (typeof raw !== 'string') return null;
        const text = cleanPaddleText(raw);
        return text ? { text, confidence: 1 } : null;
      });
    } catch (err) {
      this.logger.warn(
        `PaddleOCR-VL unavailable: ${(err as Error).message}. Falling back to the vision reader.`,
      );
      return images.map(() => null);
    } finally {
      clearTimeout(timeout);
    }
  }
}

/** PaddleOCR-VL returns document text, sometimes with markdown/table dressing. */
function cleanPaddleText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/[*_`#>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
