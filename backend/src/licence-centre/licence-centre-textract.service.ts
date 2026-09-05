// backend/src/licence-centre/licence-centre-textract.service.ts
//
// The OCR half of the Document Centre: AWS Textract, in place of a vision
// model. Everything above it — classification, field extraction, the encrypted
// blob — reads the response this returns.
//
// ⚠️ CLASSIFY AND READ RUN ON THE SAME BYTES, one after the other, inside a
// single upload. Without the cache below that is TWO Textract calls per
// document for one page of OCR, and the second one cannot return anything the
// first did not. The cache is keyed on the bytes themselves, so it cannot
// serve one document's text for another.

import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeDocumentCommand,
  TextractClient,
} from '@aws-sdk/client-textract';

import type { TextractResponse } from './textract-document-extract';

/**
 * How many pages of a PDF are read.
 *
 * A credential is one page — a licence card, a certificate. Two is for the
 * statements of results that print their verification notes overleaf. Beyond
 * that we are paying per page to OCR somebody's whole scanner output, and the
 * fields we want were on page one.
 */
const MAX_PDF_PAGES = 2;

/**
 * Tried in order, first one that fits wins. See rasterise().
 *
 * ⚠️ STARTS AT 3, NOT 1. A PDF page is 72 DPI at scale 1 and Textract wants
 * at least 150; at scale 1 the boxed digits on a SAPS 524 stop resolving.
 */
const PDF_SCALES = [3, 1.5, 1] as const;

/**
 * Textract's synchronous limit is 5 MB. Stopping a megabyte short leaves room
 * for the base64 the SDK wraps the bytes in.
 */
const MAX_PAGE_BYTES = 4_000_000;

/** Bounded so a busy hour cannot hold every document ever uploaded in memory. */
const CACHE_MAX = 32;

@Injectable()
export class LicenceCentreTextractService {
  private readonly log = new Logger(LicenceCentreTextractService.name);
  private client?: TextractClient;
  private readonly cache = new Map<string, TextractResponse>();

  /** Ireland — the only region carrying Textract and Rekognition together. */
  private get region(): string {
    return process.env.AWS_REGION || 'eu-west-1';
  }

  enabled(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    );
  }

  private textract(): TextractClient {
    this.client ??= new TextractClient({ region: this.region });
    return this.client;
  }

  /**
   * OCR a document. Returns null when AWS is not configured or the call
   * fails — never throws at the caller, because a failed read must fall
   * through to the Claude fallback rather than fail the upload.
   */
  async analyse(
    bytes: Buffer,
    mimeType: string,
  ): Promise<TextractResponse | null> {
    if (!this.enabled()) return null;

    const key = createHash('sha256').update(bytes).digest('hex');
    const hit = this.cache.get(key);
    if (hit) return hit;

    try {
      const pages =
        mimeType === 'application/pdf'
          ? await this.rasterise(bytes)
          : [bytes];
      if (!pages.length) return null;

      // Block Ids are unique within a response and there are no relationships
      // across pages, so concatenating is safe and gives the readers one
      // document to look at.
      const blocks = [];
      for (const page of pages) {
        const res = await this.textract().send(
          new AnalyzeDocumentCommand({
            Document: { Bytes: page },
            FeatureTypes: ['FORMS'],
          }),
        );
        blocks.push(...(res.Blocks ?? []));
      }

      const response = { Blocks: blocks } as TextractResponse;
      if (this.cache.size >= CACHE_MAX) {
        this.cache.delete(this.cache.keys().next().value as string);
      }
      this.cache.set(key, response);
      return response;
    } catch (err) {
      // A document Textract cannot read is a fallback case, not an error the
      // member should see. The caller tries Claude next.
      this.log.warn(
        `Textract could not read a ${mimeType} document: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * PDF pages to PNG.
   *
   * ⚠️ IN-PROCESS ON PURPOSE. The synchronous Textract API takes images only,
   * and a PDF otherwise needs the asynchronous S3 API — a bucket, a job, and
   * polling — for a one-page certificate. Rasterising first keeps the whole
   * path synchronous.
   *
   * ⚠️ AND VIA npm, NOT apt. The live box has no pdftoppm, no ImageMagick and
   * no ghostscript, so a system rasteriser would have to be installed by hand
   * on this box and on every future one, and its absence would show up as
   * "PDFs silently stopped working" long after the deploy that needed it.
   */
  private async rasterise(bytes: Buffer): Promise<Buffer[]> {
    const { pdf } = await import('pdf-to-img');

    // ⚠️ SCALE IS NOT ONE NUMBER, BECAUSE PDFs ARE NOT ONE THING. A vector
    // form rasterises to ~0.3 MB at scale 3. A PDF that is really a PHONE
    // PHOTO of a licence — which is how these actually arrive — came out at
    // 2.88 MB from the same setting, against a 5 MB synchronous limit, and a
    // higher-resolution camera would have gone straight through it. The
    // failure would have been an upload that works for everyone whose phone
    // is a bit older.
    //
    // So it steps down until the page fits, rather than betting on one
    // number. Scale 3 first because that is what the boxed digits on a SAPS
    // 524 need to resolve; the lower steps only ever apply to pages that are
    // already dense enough to be too big.
    for (const scale of PDF_SCALES) {
      const doc = await pdf(bytes, { scale });
      const out: Buffer[] = [];
      let tooBig = false;
      for await (const page of doc) {
        if (page.length > MAX_PAGE_BYTES) {
          tooBig = true;
          break;
        }
        out.push(page);
        if (out.length >= MAX_PDF_PAGES) break;
      }
      if (!tooBig) return out;
      this.log.log(`PDF page over ${MAX_PAGE_BYTES} bytes at scale ${scale} — retrying smaller`);
    }
    return [];
  }
}
