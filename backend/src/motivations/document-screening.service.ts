import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../common/llm/llm.service';
import { type LlmPart } from '../common/llm/llm.types';
import { DocumentPageRasterService } from './document-page-raster.service';

// ────────────────────────────────────────────────────────────────────
// SCREENING AN UPLOADED DOCUMENT'S PAGES — DeepSeek Flash, as a MONITOR.
//
// Operator ask, 2026-10-01: "use deepseek api to view all documents … for
// contact details and thirdparty advertising etc … and see if the monitoring
// is robust." The vault is where a member's own paperwork lives, so this runs
// on EVERY uploaded page as a background signal, NOT as a gate.
//
// ⚠️ IT NEVER BLOCKS A VAULT UPLOAD. A licence legitimately carries a full
// name, an ID number and a home address — those are the document, not a
// violation, and refusing a member's own licence for containing their own
// name would be absurd. So this service never rejects; it only records what a
// human should look at: a page that looks like an ADVERT, a stock/watermarked
// image passed off as a document, a QR/social handle used to route around the
// platform, or a page that plainly is not the document it claims to be. Each
// finding is written to ContactDetailRejection (the T&S queue) and forgotten.
//
// ⚠️ FAIL-SOFT IN EVERY DIRECTION. A missing key, an unreadable page, a
// malformed reply, a DB error — each costs at most one screening, never the
// upload. Every path returns void and swallows.
//
// ⚠️ PDF PAGES COME FROM THE PRINT RASTER. pagesFor(bytes, render:'print') is
// the same ~300 dpi conversion the vault's own vision path uses, cached on the
// source sha256, so a PDF is rasterised once for OCR and screening alike.
// ────────────────────────────────────────────────────────────────────

/** Cap the pages screened per document — a long bank statement must not turn
 *  into a dozen vision calls. */
const MAX_PAGES = 6;

const SCREEN_PURPOSE = 'moderation.document.images';

const SYSTEM_PROMPT = `You are a monitoring screener for documents uploaded to ALL Outdoor, a South African marketplace. You see one member's uploaded page(s) and report whether any page shows one of a few off-platform or integrity signals. This is a monitor, not a gate: be precise and conservative.

Report ONLY:
- advertising: the page is an advert or promotional flyer for a business, shop, service or channel (not a licence, invoice, statement, certificate or proof-of-address)
- contact-push: the page pushes a social handle, a "contact us" QR code, or a WhatsApp/channel link used to route around the platform
- stock-or-fake: the page is plainly a stock image, a screenshot, or a watermarked picture rather than a photograph of a real document
- wrong-document: the page is obviously not the kind of document it is supposed to be

A name, ID number, address, phone number or email that is PART OF the document itself (a licence, a bill, a bank statement) is NORMAL and must never be reported. Manufacturer or municipal logos are normal.

Reply with JSON ONLY: {"flagged":true|false,"unsure":true|false,"categories":["advertising"|"contact-push"|"stock-or-fake"|"wrong-document"],"reasons":["short reason naming the page"]}
Set unsure=true if you cannot tell. No prose, no markdown.`;

export interface ScreenDocumentInput {
  bytes: Buffer;
  mimeType: string;
  sha256: string;
  /** The member who uploaded it, for the T&S queue. */
  ownerId?: string;
  /** Human label for the queue sample — a title or filename, never file bytes. */
  label?: string;
}

@Injectable()
export class DocumentScreeningService {
  private readonly logger = new Logger(DocumentScreeningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly raster: DocumentPageRasterService,
  ) {}

  /**
   * Screen one uploaded document. Never throws, never blocks the upload.
   * Fire-and-forget from the upload path.
   */
  async screen(input: ScreenDocumentInput): Promise<void> {
    try {
      if (!process.env.DEEPSEEK_API_KEY) return;
      const parts = await this.pageParts(input);
      if (!parts.length) return;

      const raw = await this.call(input, parts);
      const parsed = this.parse(raw);
      if (!parsed) return;

      const noteworthy = parsed.flagged || parsed.unsure;
      if (!noteworthy) return;

      await this.persist(input, parsed);
    } catch (err) {
      this.logger.warn(
        `Document screening failed (non-fatal): ${(err as Error).message}`,
      );
    }
  }

  /** The page images: a PDF is rasterised at print scale, an image is used
   *  as-is. Capped at MAX_PAGES. */
  private async pageParts(input: ScreenDocumentInput): Promise<LlmPart[]> {
    if (input.mimeType === 'application/pdf') {
      const pages = await this.raster.pagesFor({
        bytes: input.bytes,
        sha256: input.sha256,
        render: 'print',
      });
      return pages.slice(0, MAX_PAGES).map((p) => ({
        type: 'image' as const,
        mimeType: 'image/jpeg',
        data: p.bytes.toString('base64'),
      }));
    }
    if (input.mimeType.startsWith('image/')) {
      return [
        {
          type: 'image' as const,
          mimeType: input.mimeType,
          data: input.bytes.toString('base64'),
        },
      ];
    }
    return [];
  }

  private async call(input: ScreenDocumentInput, parts: LlmPart[]): Promise<string> {
    const content: LlmPart[] = [
      {
        type: 'text',
        text: `Screen the ${parts.length} uploaded page(s)${
          input.label ? ` ("${input.label.slice(0, 80)}")` : ''
        }. Return the JSON verdict only.`,
      },
      ...parts,
    ];
    const msg = await this.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      maxTokens: 300,
      temperature: 0,
      json: {},
      thinking: { budgetTokens: 0 },
      purpose: SCREEN_PURPOSE,
      // deepseek-flash is the only vision-capable DeepSeek id.
      model: 'deepseek-flash',
      timeoutMs: 30_000,
    });
    return msg.text;
  }

  private parse(raw: string): {
    flagged: boolean;
    unsure: boolean;
    categories: string[];
    reasons: string[];
  } | null {
    const trimmed = (raw ?? '').trim();
    const first = trimmed.indexOf('{');
    const last = trimmed.lastIndexOf('}');
    if (first < 0 || last <= first) return null;
    try {
      const o = JSON.parse(trimmed.slice(first, last + 1)) as Record<string, unknown>;
      if (typeof o.flagged !== 'boolean') return null;
      return {
        flagged: o.flagged,
        unsure: o.unsure === true,
        categories: Array.isArray(o.categories)
          ? o.categories.filter((c): c is string => typeof c === 'string')
          : [],
        reasons: Array.isArray(o.reasons)
          ? o.reasons.filter((r): r is string => typeof r === 'string').slice(0, 6)
          : [],
      };
    } catch {
      return null;
    }
  }

  /** Record the finding in the T&S queue. Best-effort: a DB failure is logged,
   *  not raised. */
  private async persist(
    input: ScreenDocumentInput,
    parsed: { flagged: boolean; unsure: boolean; categories: string[]; reasons: string[] },
  ): Promise<void> {
    const category = parsed.unsure
      ? `review:${parsed.categories[0] ?? 'unclear'}`
      : parsed.categories[0] ?? 'document-signal';
    let userId: string | null = null;
    if (input.ownerId) {
      const user = await this.prisma.user
        .findUnique({ where: { id: input.ownerId }, select: { id: true } })
        .catch(() => null);
      userId = user?.id ?? null;
    }
    await this.prisma.contactDetailRejection.create({
      data: {
        userId,
        channel: 'vault-document',
        category,
        sampleText: (input.label ?? parsed.reasons.join('; ') ?? '').slice(0, 200),
      },
    });
  }
}
