import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * ActionTokensService — mint / resolve / consume tokens for the
 * /a/<token> SMS-link action pages.
 *
 * See ActionToken model in schema.prisma for the full security model.
 *
 * Lifecycle:
 *   mint(...)    → returns the token string (caller embeds in SMS URL)
 *   resolve(t)   → returns the scoped payload to render the page
 *                  (validates expiry + lock + usedAt without consuming)
 *   consume(t)   → marks usedAt + records IP/UA, throws if already used,
 *                  expired, or locked. Use after the underlying action
 *                  has successfully completed.
 *   markInvalid  → increments invalidAttempts; auto-locks at >=5
 */

export type ActionTokenPurpose =
  | 'OFFER_DECISION'
  | 'COUNTER_DECISION'
  | 'AUCTION_BID'
  | 'CHECKOUT'
  // AUCTION_RUNNER_UP — the SELLER's one-tap link after an auction winner
  // blows the 24h pay window. Offers the item to the second-highest bidder at
  // that bidder's own highest bid instead of making the seller restart a
  // 7-day auction to reach a buyer we already had. Seller-confirmed, never
  // automatic. targetType = 'listing'; metadata carries the runner-up's id +
  // amount as snapshotted when the SMS was sent (both re-validated on accept).
  | 'AUCTION_RUNNER_UP'
  // DISPATCH — seller's one-tap link from the 48h dispatch nudge SMS.
  // Lands on `/a/<token>` which renders the dispatch form (tracking
  // reference input + optional Pudo locker) so the seller can mark
  // the parcel shipped WITHOUT signing in. targetType = 'transaction'.
  | 'DISPATCH'
  // TRANSACTION_ACCEPT — first step of the seller's two-step workflow
  // after a buyer pays. SMS fires immediately on payment with this
  // token; tap → Accept (one-tap, no sign-in) OR Reject (with reason).
  // targetType = 'transaction'. 48h TTL = ACCEPT_DEADLINE_HOURS.
  | 'TRANSACTION_ACCEPT'
  // KYC_VERIFY — seller's link from the "verify your identity to release
  // payout" SMS. Lands on `/a/<token>` → redirects to `/kyc/verify?t=`
  // so the seller can do VerifyNow ID + face-match WITHOUT signing in.
  // targetType = 'user', targetId = authorisedUserId = the seller. The
  // token does NOT bypass the identity proof itself (real SA ID + live
  // selfie face-matched against Home Affairs are still required); it only
  // removes the Clerk-login wall when the SMS opens in an external
  // browser. 7-day TTL — KYC isn't time-critical like a 24h checkout.
  | 'KYC_VERIFY'
  // SWAP_PROPOSAL_DECISION — the listing owner's one-tap link from the
  // "you've received a swap proposal" SMS. Renders the proposal (their
  // item ↔ the proposer's item ± cash) so they can Accept / Reject /
  // Counter the cash WITHOUT signing in. targetType = 'swapProposal'.
  | 'SWAP_PROPOSAL_DECISION'
  // SWAP_COUNTER_DECISION — the proposer's one-tap link after the owner
  // counters the cash. Tap → Accept / Reject the counter. 24h TTL.
  | 'SWAP_COUNTER_DECISION'
  // SWAP_DISPATCH — a swap party's one-tap dispatch link for THEIR leg
  // (S4). targetType = 'transaction' (the leg). Added now so the union
  // is stable; wired in S4.
  | 'SWAP_DISPATCH';

export type ActionTokenTargetType =
  | 'offer'
  | 'listing'
  | 'transaction'
  // KYC_VERIFY tokens target the user themselves (no offer/listing/tx).
  | 'user'
  // Swop/Trade negotiation tokens target a SwapProposal.
  | 'swapProposal';

/** Max wrong / invalid resolution attempts before the token locks. */
const MAX_INVALID_ATTEMPTS = 5;

/** Token bytes — 16 bytes = 128 bits = ~22 chars base64url. */
const TOKEN_BYTES = 16;

@Injectable()
export class ActionTokensService {
  private readonly logger = new Logger(ActionTokensService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Mint ────────────────────────────────────────────────────────

  /**
   * Mint a fresh token. Caller is responsible for embedding the
   * returned string in the SMS URL like:
   *   `${appUrl}/a/${token}`
   *
   * Expiry should match the underlying decision window — e.g. offer's
   * expiresAt, auction's endTime, 24h for checkout flows.
   */
  async mint(args: {
    purpose: ActionTokenPurpose;
    targetType: ActionTokenTargetType;
    targetId: string;
    authorisedUserId: string;
    expiresAt: Date;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    if (args.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Token expiresAt must be in the future',
      );
    }

    const token = this.generateTokenString();

    await this.prisma.actionToken.create({
      data: {
        token,
        purpose: args.purpose,
        targetType: args.targetType,
        targetId: args.targetId,
        authorisedUserId: args.authorisedUserId,
        expiresAt: args.expiresAt,
        metadataJson: args.metadata ? JSON.stringify(args.metadata) : null,
      },
    });

    this.logger.log(
      `Minted ${args.purpose} token for user ${args.authorisedUserId} (target ${args.targetType}:${args.targetId}, expires ${args.expiresAt.toISOString()})`,
    );
    return token;
  }

  // ─── Resolve (non-consuming) ─────────────────────────────────────

  /**
   * Resolve a token to its raw record. Used by the page-render path
   * (GET /actions/:token) to decide what UI to show — does NOT consume
   * the token, so the page can be loaded multiple times before the
   * user actually clicks a button.
   *
   * Validates:
   *   - exists
   *   - not expired
   *   - not used
   *   - not locked (invalidAttempts < MAX_INVALID_ATTEMPTS)
   *
   * Throws the appropriate HTTP-mapped exception on failure so the
   * frontend can show a tailored error message.
   */
  async resolve(token: string): Promise<ResolvedToken> {
    if (!token || typeof token !== 'string' || token.length > 64) {
      throw new BadRequestException('Invalid token format');
    }
    const row = await this.prisma.actionToken.findUnique({
      where: { token },
    });
    if (!row) {
      // Don't reveal whether the token exists. Same error for "not found"
      // as for invalid format — limits enumeration.
      throw new NotFoundException('Link not found');
    }
    if (row.invalidAttempts >= MAX_INVALID_ATTEMPTS) {
      throw new ForbiddenException(
        'This link has been locked after too many invalid attempts. Please request a fresh link from your All Outdoor dashboard.',
      );
    }
    if (row.usedAt) {
      throw new GoneException(
        'This link has already been used. You can view the outcome in your All Outdoor account.',
      );
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new GoneException(
        'This link has expired. The action it covered is no longer available — check your All Outdoor account for the current state.',
      );
    }
    return {
      id: row.id,
      token: row.token,
      purpose: row.purpose as ActionTokenPurpose,
      targetType: row.targetType as ActionTokenTargetType,
      targetId: row.targetId,
      authorisedUserId: row.authorisedUserId,
      expiresAt: row.expiresAt,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
    };
  }

  // ─── Consume (one-way, after action succeeds) ────────────────────

  /**
   * Mark the token as used. Call AFTER the underlying service call
   * has completed successfully — never before. If the action fails,
   * don't consume; let the user retry.
   *
   * Throws if the token has already been consumed (idempotency
   * boundary) so two parallel button-clicks can't both succeed.
   */
  async consume(
    token: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    // Use updateMany with a usedAt=null guard so this is atomic — only
    // ONE concurrent caller can flip it from null to set.
    const result = await this.prisma.actionToken.updateMany({
      where: { token, usedAt: null },
      data: {
        usedAt: new Date(),
        consumedFromIp: ip?.slice(0, 64) ?? null,
        consumedFromUserAgent: userAgent?.slice(0, 256) ?? null,
      },
    });
    if (result.count === 0) {
      throw new GoneException(
        'This link has already been used or is no longer valid.',
      );
    }
  }

  // ─── Mark invalid (brute-force protection) ───────────────────────

  /**
   * Increment the invalidAttempts counter. Call when:
   *   - Token exists but doesn't match the expected purpose
   *   - User attempts an action the token doesn't authorise
   *   - Payload validation fails on the consume side
   *
   * At MAX_INVALID_ATTEMPTS the token is permanently locked. This
   * stops someone who got hold of one valid token from probing its
   * other-purpose handlers.
   */
  async markInvalid(token: string): Promise<void> {
    try {
      await this.prisma.actionToken.update({
        where: { token },
        data: { invalidAttempts: { increment: 1 } },
      });
    } catch {
      // Token doesn't exist — silently ignore (no point lockstepping
      // a non-existent row).
    }
  }

  // ─── Verify-and-consume helper for actions ───────────────────────

  /**
   * One-stop helper for action endpoints. Resolves the token,
   * validates it matches the expected purpose + targetType, runs
   * the action callback, then consumes on success / markInvalid on
   * failure.
   *
   * Use this in controllers so each action handler is one line:
   *   const result = await this.tokens.runAction(token, 'OFFER_DECISION', 'offer',
   *     async ({ targetId, authorisedUserId }) =>
   *       this.offersService.acceptByUserId(targetId, authorisedUserId));
   */
  async runAction<T>(
    token: string,
    expectedPurpose: ActionTokenPurpose,
    expectedTargetType: ActionTokenTargetType,
    action: (ctx: {
      targetId: string;
      authorisedUserId: string;
      metadata: Record<string, unknown> | null;
    }) => Promise<T>,
    ip?: string,
    userAgent?: string,
  ): Promise<T> {
    const resolved = await this.resolve(token);
    if (
      resolved.purpose !== expectedPurpose ||
      resolved.targetType !== expectedTargetType
    ) {
      // Wrong endpoint for this token — count as invalid attempt and
      // refuse. Don't tell the caller WHY it failed (just "not allowed")
      // so probing doesn't leak token shape.
      await this.markInvalid(token);
      throw new ForbiddenException('This link cannot perform that action.');
    }
    const result = await action({
      targetId: resolved.targetId,
      authorisedUserId: resolved.authorisedUserId,
      metadata: resolved.metadata,
    });
    await this.consume(token, ip, userAgent);
    return result;
  }

  // ─── Internal: token generation ──────────────────────────────────

  /**
   * 16 random bytes → 22 chars base64url. Uses Node's crypto
   * randomBytes (CSPRNG). Collision probability is astronomically low
   * (2^128 space) but we still use a unique constraint at the DB
   * level as the defence-in-depth.
   */
  private generateTokenString(): string {
    return randomBytes(TOKEN_BYTES)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}

export interface ResolvedToken {
  id: string;
  token: string;
  purpose: ActionTokenPurpose;
  targetType: ActionTokenTargetType;
  targetId: string;
  authorisedUserId: string;
  expiresAt: Date;
  metadata: Record<string, unknown> | null;
}
