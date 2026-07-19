import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { SwapFundingService } from './swap-funding.service';

/**
 * SWOP proof-of-possession. Before a swap can be funded, the SENDER of each
 * leg photographs the item they're shipping next to a handwritten slip bearing
 * the GG-generated per-leg code. Claude vision:
 *   - reads the code back (we compare it server-side to the leg's code — the
 *     anti-replay anchor: a recycled listing photo can't carry this code), and
 *   - checks the item is consistent with the listing + looks freshly shot.
 *
 *   all criteria >= 80 + code matches  → APPROVED (funding can proceed)
 *   code missing/mismatch OR any < 50  → REJECTED (reshoot)
 *   otherwise                          → PENDING_ADMIN_REVIEW
 *
 * The code is minted at swap creation, so the photo can't be pre-staged.
 */

const MODEL_VISION = process.env.ANTHROPIC_MODEL_JUDGE ?? 'claude-sonnet-4-6';
const AUTO_APPROVE_FLOOR = 80;
const AUTO_REJECT_CEILING = 50;

export type SwapProofStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';

export interface SwapProofFindings {
  extracted_code: string | null; // the code Claude read on the slip
  code_legible: number; // 0-100 — a handwritten code slip is clearly readable
  item_match: number; // 0-100 — item matches the listing (title/description/photo)
  live_capture: number; // 0-100 — freshly shot WITH the slip, not a stock/screenshot/reused listing image
  overall_confidence: number;
  recommendation: 'APPROVE' | 'ADMIN_REVIEW' | 'REJECT';
  recommendation_reason: string;
}

function normalizeCode(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

@Injectable()
export class SwapProofService {
  private readonly logger = new Logger(SwapProofService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    // When a leg's proof flips to APPROVED we nudge funding setup (no-op until
    // both legs are APPROVED + address-ready) — otherwise an all-firearm swap
    // (no address step) or a late admin-approval would never auto-fund.
    private readonly swapFunding: SwapFundingService,
  ) {
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = key ? new Anthropic({ apiKey: key }) : null;
  }

  // The sender of a swap leg uploads ONE photo (item + code slip). Returns the
  // resulting status + score.
  async uploadAndScore(
    legId: string,
    senderClerkId: string,
    file: Express.Multer.File,
  ): Promise<{ status: SwapProofStatus; score: number; findings: SwapProofFindings | null }> {
    if (!file?.buffer) throw new BadRequestException('A photo is required');

    const leg = await this.prisma.transaction.findUnique({
      where: { id: legId },
      include: {
        seller: { select: { clerkId: true } },
        swap: { select: { status: true } },
        listing: {
          select: {
            title: true,
            description: true,
            images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
      },
    });
    if (!leg) throw new BadRequestException('Swap item not found');
    if (!leg.swapId || !leg.swapProofCode) {
      throw new BadRequestException('This is not a swap item awaiting verification');
    }
    if (leg.seller.clerkId !== senderClerkId) {
      throw new BadRequestException('Only the sender can verify this item');
    }
    // Proof happens BEFORE the swap is funded (it gates funding). Once funded
    // the items are already proven; block re-uploads.
    if (leg.swap?.status !== 'AWAITING_FUNDING') {
      throw new BadRequestException('This swap is no longer awaiting item verification.');
    }
    if (leg.swapProofStatus === 'APPROVED') {
      return { status: 'APPROVED', score: leg.swapProofScore ?? 100, findings: null };
    }

    const upload = await this.cloudinary.uploadImage(file.buffer, `swap-proof/${legId}`);

    await this.prisma.transaction.update({
      where: { id: legId },
      data: { swapProofPhotoUrl: upload.url, swapProofStatus: 'PENDING_REVIEW' },
    });

    let findings: SwapProofFindings | null = null;
    let status: SwapProofStatus = 'PENDING_REVIEW';
    let score = 0;

    if (this.client) {
      try {
        findings = await this.runVisionScan({
          photoUrl: upload.url,
          listingPhotoUrl: leg.listing.images[0]?.url ?? null,
          expectedCode: leg.swapProofCode,
          listingTitle: leg.listing.title,
          listingDescription: leg.listing.description ?? '',
        });
        score = findings.overall_confidence;
        status = this.decide(findings, leg.swapProofCode);
      } catch (err) {
        this.logger.warn(
          `Swap proof Claude call failed (queueing for admin): ${(err as Error).message}`,
        );
        status = 'PENDING_REVIEW';
      }
    }

    await this.prisma.transaction.update({
      where: { id: legId },
      data: {
        swapProofStatus: status,
        swapProofScore: score,
        swapProofFindings: findings as object | undefined,
        swapProofVerifiedAt: status === 'APPROVED' ? new Date() : null,
      },
    });
    this.logger.log(`Swap proof for leg ${legId} → ${status} (score ${score})`);
    // A proof stuck in PENDING_REVIEW (uncertain scores, or the vision call
    // failed) blocks the whole swap silently — surface it in the alerts
    // inbox so an admin reviews the photo instead of the swap just stalling.
    if (status === 'PENDING_REVIEW') {
      await this.prisma.adminAlert
        .create({
          data: {
            type: 'swap-proof-review',
            referenceId: legId,
            context: `Swap proof photo for leg ${legId} needs manual review (score ${score}${findings ? '' : '; vision scan unavailable'}) — swap ${leg.swapId} is blocked until reviewed.`,
          },
        })
        .catch(() => undefined);
    }
    // Approving this leg may have cleared the last prerequisite — nudge funding
    // setup (no-op until both legs APPROVED + address-ready).
    if (status === 'APPROVED' && leg.swapId) {
      void this.swapFunding.maybeSetUpFunding(leg.swapId);
    }
    return { status, score, findings };
  }

  // Admin override from the swap dossier (PENDING_REVIEW → APPROVED/REJECTED).
  async adminOverride(legId: string, decision: 'APPROVE' | 'REJECT', reason: string) {
    const trimmed = (reason ?? '').trim();
    if (trimmed.length < 5) {
      throw new BadRequestException('Provide a reason of ≥5 characters for the audit log.');
    }
    const leg = await this.prisma.transaction.findUnique({
      where: { id: legId },
      select: { swapId: true },
    });
    if (!leg?.swapId) throw new BadRequestException('Swap item not found');
    await this.prisma.transaction.update({
      where: { id: legId },
      data: {
        swapProofStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        swapProofVerifiedAt: decision === 'APPROVE' ? new Date() : null,
      },
    });
    if (decision === 'APPROVE' && leg.swapId) {
      void this.swapFunding.maybeSetUpFunding(leg.swapId);
    }
    return { ok: true };
  }

  // The code read-back is the hard gate: if Claude didn't read OUR code off the
  // slip, it's a recycled/stock photo → reject regardless of item match.
  private decide(f: SwapProofFindings, expectedCode: string): SwapProofStatus {
    const codeMatches = normalizeCode(f.extracted_code) === normalizeCode(expectedCode);
    if (!codeMatches || f.code_legible < AUTO_REJECT_CEILING) return 'REJECTED';
    const scores = [f.code_legible, f.item_match, f.live_capture];
    if (scores.some((s) => s < AUTO_REJECT_CEILING)) return 'REJECTED';
    if (scores.every((s) => s >= AUTO_APPROVE_FLOOR)) return 'APPROVED';
    return 'PENDING_REVIEW';
  }

  private async runVisionScan(args: {
    photoUrl: string;
    listingPhotoUrl: string | null;
    expectedCode: string;
    listingTitle: string;
    listingDescription: string;
  }): Promise<SwapProofFindings> {
    if (!this.client) throw new Error('Anthropic client not configured');

    const systemPrompt = `You verify "proof of possession" photos for Gun Galore swaps. A member must photograph the item they are about to swap, next to a handwritten (or printed) slip showing a unique code we gave them. This proves the item physically exists in their hands right now and isn't a stolen catalogue/stock image.

You are shown the member's PROOF PHOTO, optionally followed by the original LISTING PHOTO for comparison, plus the expected code + listing details as text.

Output ONLY one valid JSON object (first char "{", no markdown):
{
  "extracted_code": "<the code you read on the slip in the proof photo, EXACTLY as written, or null if none>",
  "code_legible": <0-100>,        // a slip bearing a clearly readable code is present in the PROOF photo
  "item_match": <0-100>,          // the main item in the proof photo is consistent with the listing title/description (be lenient on angle/lighting)
  "live_capture": <0-100>,        // looks like a freshly-taken photo WITH the handwritten slip — NOT a screenshot, catalogue/stock image, or the listing photo reused
  "overall_confidence": <0-100>,
  "recommendation": "APPROVE" | "ADMIN_REVIEW" | "REJECT",
  "recommendation_reason": "<one sentence>"
}

Rules:
- Read the code character-for-character into extracted_code. Do not guess — if it's unreadable, set it null and score code_legible low.
- If there is NO slip/code in the photo, code_legible = 0 and recommend REJECT.
- A photo that is clearly the same file as the listing photo (no slip, identical framing) is NOT live capture — score live_capture low.
- Be conservative with REJECT — only when something is below 50 and a reshoot is needed. Use ADMIN_REVIEW when uncertain.`;

    const userContent: Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'url'; url: string } }
    > = [
      {
        type: 'text',
        text: [
          `Expected code on the slip: ${args.expectedCode}`,
          `Listing title: ${args.listingTitle}`,
          `Listing description: ${args.listingDescription?.slice(0, 600) || '(none)'}`,
          '',
          'PROOF PHOTO (the item + the code slip):',
        ].join('\n'),
      },
      { type: 'image', source: { type: 'url', url: args.photoUrl } },
    ];
    if (args.listingPhotoUrl) {
      userContent.push({
        type: 'text',
        text: 'Original LISTING PHOTO (for item comparison only):',
      });
      userContent.push({
        type: 'image',
        source: { type: 'url', url: args.listingPhotoUrl },
      });
    }

    const msg = await this.client.messages.create({
      model: MODEL_VISION,
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    const block = msg.content.find((b) => b.type === 'text');
    const raw = (block as { text?: string } | undefined)?.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Claude did not return JSON');
    return JSON.parse(match[0]) as SwapProofFindings;
  }
}
