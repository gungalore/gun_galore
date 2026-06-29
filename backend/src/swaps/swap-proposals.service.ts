import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import {
  Prisma,
  ListingStatus,
  ListingType,
  SwapProposalStatus,
  SwapStatus,
  SwapRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { KycService } from '../kyc/kyc.service';
import { SwapFundingService } from './swap-funding.service';
import { CreateSwapProposalDto } from './dto/create-swap-proposal.dto';
import { CounterSwapDto } from './dto/counter-swap.dto';

const PROPOSAL_TTL_HOURS = 48;
const COUNTER_TTL_HOURS = 24;
// Lazy getter — see OffersService for why this must NOT be a module-level
// constant (ESM hoist vs dotenv ordering).
const APP_URL = () => process.env.FRONTEND_URL ?? 'http://localhost:3000';

// Open (non-terminal) proposal states — used for the one-active-per-pair
// guard and sibling-rejection.
const OPEN_STATUSES: SwapProposalStatus[] = [
  SwapProposalStatus.PENDING,
  SwapProposalStatus.COUNTERED,
];

@Injectable()
export class SwapProposalsService {
  private readonly logger = new Logger(SwapProposalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly contactFilter: ContactDetailFilterService,
    private readonly actionTokens: ActionTokensService,
    private readonly kyc: KycService,
    private readonly swapFunding: SwapFundingService,
  ) {}

  // ----------------------------------------------------------------
  // Propose a swap (proposer offers ONE of their SWOP listings ± cash)
  // ----------------------------------------------------------------
  async propose(proposerClerkId: string, dto: CreateSwapProposalDto) {
    const proposer = await this.prisma.user.findUnique({
      where: { clerkId: proposerClerkId },
    });
    if (!proposer) throw new ForbiddenException('User not found');
    if (proposer.isBanned) throw new ForbiddenException('Account is suspended');

    if (dto.listingId === dto.offeredListingId) {
      throw new BadRequestException('You cannot swap a listing for itself');
    }

    const [wanted, offered] = await Promise.all([
      this.prisma.listing.findUnique({
        where: { id: dto.listingId },
        include: { seller: true },
      }),
      this.prisma.listing.findUnique({ where: { id: dto.offeredListingId } }),
    ]);

    if (!wanted) throw new NotFoundException('Listing not found');
    if (!offered) throw new NotFoundException('Your offered listing was not found');

    if (wanted.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('That listing is no longer available');
    }
    if (offered.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Your offered listing is not active');
    }
    if (wanted.listingType !== ListingType.SWOP) {
      throw new BadRequestException('That listing is not open to swaps');
    }
    if (offered.listingType !== ListingType.SWOP) {
      throw new BadRequestException(
        'The item you offer must be a Swop / Trade listing of yours',
      );
    }
    if (wanted.sellerId === proposer.id) {
      throw new BadRequestException('You cannot propose a swap on your own listing');
    }
    if (offered.sellerId !== proposer.id) {
      throw new BadRequestException('You can only offer a listing you own');
    }
    // S6 — firearm swap legs are allowed, but ONLY via a licensed-dealer
    // transfer (no private-arrange in v1). Every firearm side must offer
    // DEALER_TRANSFER (create-time already forces this, but re-assert here).
    if (wanted.isFirearm && !wanted.shippingMethods.includes('DEALER_TRANSFER')) {
      throw new BadRequestException(
        'That firearm can only be swapped via a licensed-dealer transfer.',
      );
    }
    if (offered.isFirearm && !offered.shippingMethods.includes('DEALER_TRANSFER')) {
      throw new BadRequestException(
        'Your firearm can only be swapped via a licensed-dealer transfer.',
      );
    }
    // The PROPOSER will RECEIVE the wanted item. If it's a firearm they must
    // affirm 18+/competency now (mirrors the firearm-checkout gate). The OWNER
    // affirms for the offered firearm when they accept/counter. Gate + log
    // (durable evidence) — matches the existing firearm-attestation pattern.
    if (wanted.isFirearm && dto.firearmAttestation18Plus !== true) {
      throw new BadRequestException(
        'You must confirm you are over 18 and (where applicable) hold the relevant SAPS competency to swap for a firearm.',
      );
    }
    if (wanted.isFirearm) {
      this.logger.log(
        `FIREARM_ATTESTATION swap-propose accepted=true proposer=${proposer.id} wanted=${wanted.id}`,
      );
    }

    // One active proposal per proposer per listing (mirrors the
    // @@unique([listingId, proposerId])). A closed proposal is deleted so
    // the unique constraint is clear for a fresh attempt.
    const existing = await this.prisma.swapProposal.findUnique({
      where: {
        listingId_proposerId: {
          listingId: wanted.id,
          proposerId: proposer.id,
        },
      },
    });
    if (existing && OPEN_STATUSES.includes(existing.status)) {
      throw new BadRequestException(
        'You already have an active proposal on this listing',
      );
    }

    // Contact-detail filter on the optional note (fee-bypass channel).
    if (dto.proposerNote) {
      const check = await this.contactFilter.check(
        dto.proposerNote,
        'swap-note',
        proposerClerkId,
      );
      if (!check.allowed) throw new BadRequestException(check.reason);
    }

    const cashAmount = dto.cashAmount ?? 0;
    const cashDirection = cashAmount > 0 ? (dto.cashDirection ?? null) : null;

    if (existing) {
      await this.prisma.swapProposal.delete({ where: { id: existing.id } });
    }

    let proposal;
    try {
      proposal = await this.prisma.swapProposal.create({
        data: {
          listingId: wanted.id,
          proposerId: proposer.id,
          ownerId: wanted.sellerId,
          offeredListingId: offered.id,
          cashAmount,
          cashDirection,
          proposerNote: dto.proposerNote,
          status: SwapProposalStatus.PENDING,
          expiresAt: new Date(Date.now() + PROPOSAL_TTL_HOURS * 3_600_000),
        },
      });
    } catch (e) {
      // Two parallel proposes for the same (listingId, proposerId) can both
      // pass the read-check above; the @@unique then trips on the second
      // insert. Surface the friendly 400 instead of a raw P2002 → 500.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new BadRequestException(
          'You already have an active proposal on this listing',
        );
      }
      throw e;
    }

    void this.notifyOwnerOfProposal(proposal.id);
    return proposal;
  }

  // ----------------------------------------------------------------
  // Owner counters the cash (once)
  // ----------------------------------------------------------------
  async counter(ownerClerkId: string, proposalId: string, dto: CounterSwapDto) {
    const { proposal } = await this.loadForOwner(ownerClerkId, proposalId);
    if (proposal.status !== SwapProposalStatus.PENDING) {
      throw new BadRequestException('Proposal is not pending');
    }
    if (proposal.counterCashAmount !== null) {
      throw new BadRequestException('You can only counter once per proposal');
    }
    // The owner commits to RECEIVING the offered item by countering — attest if
    // it's a firearm (they'll still have to accept-counter, but they're the
    // recipient and this is their commit point).
    await this.requireOwnerFirearmAttestation(proposal, dto.firearmAttestation18Plus);
    if (dto.ownerNote) {
      const check = await this.contactFilter.check(
        dto.ownerNote,
        'swap-counter-note',
        ownerClerkId,
      );
      if (!check.allowed) throw new BadRequestException(check.reason);
    }

    const updated = await this.prisma.swapProposal.update({
      where: { id: proposalId },
      data: {
        counterCashAmount: dto.counterCashAmount,
        counterCashDirection: dto.counterCashDirection,
        ownerNote: dto.ownerNote,
        status: SwapProposalStatus.COUNTERED,
        expiresAt: new Date(Date.now() + COUNTER_TTL_HOURS * 3_600_000),
      },
    });

    void this.notifyProposerOfCounter(proposalId);
    void this.notifications.resolveByEntity('swapProposal', proposalId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Owner accepts the ORIGINAL proposal → create the Swap
  // ----------------------------------------------------------------
  async acceptProposal(
    ownerClerkId: string,
    proposalId: string,
    firearmAttestation18Plus?: boolean,
  ) {
    const { proposal } = await this.loadForOwner(ownerClerkId, proposalId);
    if (proposal.status !== SwapProposalStatus.PENDING) {
      throw new BadRequestException('Proposal is not pending');
    }
    // The owner RECEIVES the offered item on accept — attest if it's a firearm.
    await this.requireOwnerFirearmAttestation(proposal, firearmAttestation18Plus);
    return this.convertToSwap(proposalId, SwapProposalStatus.PENDING, false);
  }

  // ----------------------------------------------------------------
  // Proposer accepts the owner's COUNTER → create the Swap
  // ----------------------------------------------------------------
  async acceptCounter(proposerClerkId: string, proposalId: string) {
    const { proposal } = await this.loadForProposer(proposerClerkId, proposalId);
    if (proposal.status !== SwapProposalStatus.COUNTERED) {
      throw new BadRequestException('No counter to accept');
    }
    return this.convertToSwap(proposalId, SwapProposalStatus.COUNTERED, true);
  }

  // ----------------------------------------------------------------
  // Owner rejects the original proposal
  // ----------------------------------------------------------------
  async reject(ownerClerkId: string, proposalId: string) {
    const { proposal } = await this.loadForOwner(ownerClerkId, proposalId);
    if (proposal.status !== SwapProposalStatus.PENDING) {
      throw new BadRequestException('Proposal is not pending');
    }
    const updated = await this.prisma.swapProposal.update({
      where: { id: proposalId },
      data: { status: SwapProposalStatus.REJECTED },
    });
    void this.notifyDeclined(proposalId, 'declined');
    void this.notifications.resolveByEntity('swapProposal', proposalId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Proposer rejects the owner's counter
  // ----------------------------------------------------------------
  async rejectCounter(proposerClerkId: string, proposalId: string) {
    const { proposal } = await this.loadForProposer(proposerClerkId, proposalId);
    if (proposal.status !== SwapProposalStatus.COUNTERED) {
      throw new BadRequestException('No counter to reject');
    }
    const updated = await this.prisma.swapProposal.update({
      where: { id: proposalId },
      data: { status: SwapProposalStatus.REJECTED },
    });
    void this.notifications.resolveByEntity('swapProposal', proposalId);
    return updated;
  }

  // ----------------------------------------------------------------
  // Proposer withdraws (only while PENDING)
  // ----------------------------------------------------------------
  async withdraw(proposerClerkId: string, proposalId: string) {
    const { proposal } = await this.loadForProposer(proposerClerkId, proposalId);
    if (proposal.status !== SwapProposalStatus.PENDING) {
      throw new BadRequestException('Cannot withdraw — proposal is no longer pending');
    }
    const updated = await this.prisma.swapProposal.update({
      where: { id: proposalId },
      data: { status: SwapProposalStatus.WITHDRAWN },
    });
    void this.notifications.resolveByEntity('swapProposal', proposalId);
    return updated;
  }

  // ----------------------------------------------------------------
  // The crux — atomically reserve BOTH listings + create the Swap +
  // two zero-money Transaction legs, all in one transaction so a
  // concurrent accept (e.g. double-tapped SMS) or a since-sold listing
  // can never leave one item reserved without the other.
  // ----------------------------------------------------------------
  private async convertToSwap(
    proposalId: string,
    expectedStatus: SwapProposalStatus,
    useCounter: boolean,
  ) {
    const swapId = await this.prisma.$transaction(async (tx) => {
      // 1. Claim the proposal — status guard makes a concurrent accept
      //    return count=0 and abort. The expiresAt guard also rejects an
      //    accept past the displayed TTL (the website Accept button can fire
      //    in the ~10-min gap before the expiry cron flips a stale proposal;
      //    the SMS token path already lapses with the proposal).
      const claim = await tx.swapProposal.updateMany({
        where: {
          id: proposalId,
          status: expectedStatus,
          expiresAt: { gt: new Date() },
        },
        data: { status: SwapProposalStatus.CONVERTED },
      });
      if (claim.count === 0) {
        throw new BadRequestException('Proposal is no longer open');
      }

      const proposal = await tx.swapProposal.findUnique({
        where: { id: proposalId },
      });
      if (!proposal) throw new NotFoundException('Proposal not found');

      // 2. Agreed cash = original or owner's counter.
      const cashAmount = useCounter
        ? (proposal.counterCashAmount ?? 0)
        : proposal.cashAmount;
      const cashDirection = useCounter
        ? proposal.counterCashDirection
        : proposal.cashDirection;
      const cashPayerId =
        cashAmount > 0 && cashDirection
          ? cashDirection === SwapRole.INITIATOR_GIVES
            ? proposal.proposerId
            : proposal.ownerId
          : null;

      // 3. Reserve BOTH listings atomically — require both flips. The
      //    count !== 2 guard throws, which rolls back the whole tx
      //    (including the proposal claim above). Also re-asserts both are
      //    still ACTIVE + SWOP.
      const reserve = await tx.listing.updateMany({
        where: {
          id: { in: [proposal.listingId, proposal.offeredListingId] },
          status: ListingStatus.ACTIVE,
          listingType: ListingType.SWOP,
        },
        data: { status: ListingStatus.PAYMENT_PENDING },
      });
      if (reserve.count !== 2) {
        throw new BadRequestException(
          'Both items must still be available to agree the swap.',
        );
      }

      // 4. Create the Swap parent (AWAITING_FUNDING; fees computed at S3).
      const swap = await tx.swap.create({
        data: {
          status: SwapStatus.AWAITING_FUNDING,
          initiatorId: proposal.proposerId,
          ownerId: proposal.ownerId,
          cashPayerId,
          cashAmount,
        },
      });

      // 5. Two zero-money Transaction legs (one per shipping direction).
      //    INITIATOR_GIVES = proposer's offered item → owner.
      //    OWNER_GIVES     = owner's listed item → proposer.
      await tx.transaction.createMany({
        data: [
          {
            swapId: swap.id,
            swapRole: SwapRole.INITIATOR_GIVES,
            listingId: proposal.offeredListingId,
            sellerId: proposal.proposerId,
            buyerId: proposal.ownerId,
            listingPrice: 0,
            commissionZar: 0,
            processingFee: 0,
            passFeeToBuyer: false,
            buyerTotal: 0,
            sellerPayout: 0,
          },
          {
            swapId: swap.id,
            swapRole: SwapRole.OWNER_GIVES,
            listingId: proposal.listingId,
            sellerId: proposal.ownerId,
            buyerId: proposal.proposerId,
            listingPrice: 0,
            commissionZar: 0,
            processingFee: 0,
            passFeeToBuyer: false,
            buyerTotal: 0,
            sellerPayout: 0,
          },
        ],
      });

      // 6. Link the proposal → swap.
      await tx.swapProposal.update({
        where: { id: proposalId },
        data: { swapId: swap.id },
      });

      // 7. Kill sibling open proposals that target OR offer either of the
      //    two now-reserved listings — they can never convert (the items
      //    are gone) so close them cleanly.
      await tx.swapProposal.updateMany({
        where: {
          id: { not: proposalId },
          status: { in: OPEN_STATUSES },
          OR: [
            { listingId: { in: [proposal.listingId, proposal.offeredListingId] } },
            { offeredListingId: { in: [proposal.listingId, proposal.offeredListingId] } },
          ],
        },
        data: { status: SwapProposalStatus.REJECTED },
      });

      return swap.id;
    });

    // Post-commit side-effects (fire-and-forget): KYC-trigger BOTH parties
    // (each ships an item, so each must be verified like a seller) +
    // notify both that the swap is agreed.
    void this.afterSwapCreated(swapId, proposalId);
    void this.notifications.resolveByEntity('swapProposal', proposalId);
    // S6: an all-firearm swap has no street-address step to kick funding setup,
    // so nudge it here. maybeSetUpFunding only proceeds once every leg is
    // address-ready (firearm legs need no address), so it no-ops for courier
    // legs until the recipient submits their address.
    void this.swapFunding.maybeSetUpFunding(swapId);

    return this.prisma.swap.findUnique({ where: { id: swapId } });
  }

  private async afterSwapCreated(swapId: string, proposalId: string) {
    try {
      const swap = await this.prisma.swap.findUnique({
        where: { id: swapId },
        include: {
          initiator: true,
          owner: true,
          transactions: {
            select: { swapRole: true, listing: { select: { title: true } } },
          },
        },
      });
      if (!swap) return;

      // Both parties need KYC (both are shipping an item).
      void this.kyc
        .triggerSellerVerification(swap.initiatorId)
        .catch((e) =>
          this.logger.warn(`swap KYC (initiator) failed: ${(e as Error).message}`),
        );
      void this.kyc
        .triggerSellerVerification(swap.ownerId)
        .catch((e) =>
          this.logger.warn(`swap KYC (owner) failed: ${(e as Error).message}`),
        );

      const initiatorGives = swap.transactions.find(
        (t) => t.swapRole === SwapRole.INITIATOR_GIVES,
      );
      const ownerGives = swap.transactions.find(
        (t) => t.swapRole === SwapRole.OWNER_GIVES,
      );
      const initiatorItem = initiatorGives?.listing.title ?? 'your item';
      const ownerItem = ownerGives?.listing.title ?? 'their item';

      // Notify the initiator: gives initiatorItem, gets ownerItem.
      await this.notifications.swapAgreed({
        email: swap.initiator.email,
        name: swap.initiator.firstName ?? 'there',
        phone: swap.initiator.phone,
        counterpartyName: swap.owner.username ?? 'the other member',
        yourItemTitle: initiatorItem,
        theirItemTitle: ownerItem,
        swapId: swap.id,
      });
      // Notify the owner: gives ownerItem, gets initiatorItem.
      await this.notifications.swapAgreed({
        email: swap.owner.email,
        name: swap.owner.firstName ?? 'there',
        phone: swap.owner.phone,
        counterpartyName: swap.initiator.username ?? 'the other member',
        yourItemTitle: ownerItem,
        theirItemTitle: initiatorItem,
        swapId: swap.id,
      });
    } catch (err) {
      this.logger.error(`afterSwapCreated failed: ${(err as Error).message}`);
    }
  }

  // ----------------------------------------------------------------
  // Queries
  // ----------------------------------------------------------------
  async getMine(proposerClerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: proposerClerkId },
    });
    if (!user) return [];
    return this.prisma.swapProposal.findMany({
      where: { proposerId: user.id },
      include: this.listingPreviewInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReceived(ownerClerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: ownerClerkId },
    });
    if (!user) return [];
    return this.prisma.swapProposal.findMany({
      where: { ownerId: user.id },
      include: this.listingPreviewInclude(),
      orderBy: { createdAt: 'desc' },
    });
  }

  // Proposals attached to a single listing — drives the SwapPanel on the
  // listing detail page. The owner sees received proposals; a viewer sees
  // only their own proposal (if any).
  async getForListing(clerkId: string | null, listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, sellerId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');

    const user = clerkId
      ? await this.prisma.user.findUnique({ where: { clerkId } })
      : null;
    const isOwner = !!user && user.id === listing.sellerId;

    if (isOwner) {
      const proposals = await this.prisma.swapProposal.findMany({
        where: { listingId, status: { in: OPEN_STATUSES } },
        include: this.listingPreviewInclude(),
        orderBy: { createdAt: 'desc' },
      });
      return { role: 'owner' as const, proposals };
    }

    if (user) {
      const mine = await this.prisma.swapProposal.findFirst({
        where: { listingId, proposerId: user.id },
        include: this.listingPreviewInclude(),
        orderBy: { createdAt: 'desc' },
      });
      return { role: 'viewer' as const, proposals: mine ? [mine] : [] };
    }

    return { role: 'anon' as const, proposals: [] };
  }

  // Listings the signed-in user can OFFER in a swap — their own ACTIVE SWOP
  // listings (excludes the listing they're proposing on). S6: firearm SWOP
  // listings are now offerable (they're create-forced to include
  // DEALER_TRANSFER; the propose gate re-asserts it). isFirearm is surfaced so
  // the UI can flag the dealer-transfer + attestation requirement.
  async getMyOfferableListings(clerkId: string, excludeListingId?: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) return [];
    return this.prisma.listing.findMany({
      where: {
        sellerId: user.id,
        status: ListingStatus.ACTIVE,
        listingType: ListingType.SWOP,
        ...(excludeListingId ? { id: { not: excludeListingId } } : {}),
      },
      select: {
        id: true,
        title: true,
        isFirearm: true,
        images: { where: { isPrimary: true }, take: 1, select: { url: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(clerkId: string, proposalId: string) {
    const proposal = await this.prisma.swapProposal.findUnique({
      where: { id: proposalId },
      include: this.listingPreviewInclude(),
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException();
    if (proposal.proposerId !== user.id && proposal.ownerId !== user.id) {
      throw new ForbiddenException('Access denied');
    }
    return proposal;
  }

  // ----------------------------------------------------------------
  // Cron — expire stale proposals
  // ----------------------------------------------------------------
  async expireStale() {
    const runStart = new Date();
    // ONE atomic, status-guarded flip — a proposal that CONVERTED in the gap
    // (accept committed concurrently) has left OPEN_STATUSES, so the DB
    // excludes it here. This avoids the TOCTOU where a read-then-id-only-write
    // would clobber a just-accepted proposal back to EXPIRED (and falsely SMS
    // "expired" on a live swap). Mirrors OffersService.expireStale.
    const res = await this.prisma.swapProposal.updateMany({
      where: { status: { in: OPEN_STATUSES }, expiresAt: { lt: runStart } },
      data: { status: SwapProposalStatus.EXPIRED },
    });
    if (res.count === 0) return;
    this.logger.log(`Expired ${res.count} swap proposal(s)`);
    // Notify only the rows THIS run flipped (@updatedAt bumped to >= runStart),
    // so a previous run's expirations aren't re-notified.
    const justExpired = await this.prisma.swapProposal.findMany({
      where: {
        status: SwapProposalStatus.EXPIRED,
        updatedAt: { gte: runStart },
      },
      select: { id: true },
    });
    for (const s of justExpired) {
      void this.notifyDeclined(s.id, 'expired');
      void this.notifications.resolveByEntity('swapProposal', s.id);
    }
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------
  private listingPreviewInclude() {
    return {
      listing: {
        select: {
          id: true,
          title: true,
          isFirearm: true,
          images: { where: { isPrimary: true }, take: 1, select: { url: true } },
          seller: { select: { username: true, clerkId: true } },
        },
      },
      offeredListing: {
        select: {
          id: true,
          title: true,
          isFirearm: true,
          images: { where: { isPrimary: true }, take: 1, select: { url: true } },
        },
      },
      proposer: { select: { username: true, clerkId: true } },
      owner: { select: { username: true, clerkId: true } },
    };
  }

  private async loadForOwner(ownerClerkId: string, proposalId: string) {
    const proposal = await this.prisma.swapProposal.findUnique({
      where: { id: proposalId },
      include: { owner: true },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.owner.clerkId !== ownerClerkId) {
      throw new ForbiddenException('Access denied');
    }
    return { proposal };
  }

  private async loadForProposer(proposerClerkId: string, proposalId: string) {
    const proposal = await this.prisma.swapProposal.findUnique({
      where: { id: proposalId },
      include: { proposer: true },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    if (proposal.proposer.clerkId !== proposerClerkId) {
      throw new ForbiddenException('Access denied');
    }
    return { proposal };
  }

  // S6 — the owner RECEIVES the offered item; if it's a firearm they must
  // affirm 18+/competency at their commit point (counter/accept). Gate + log,
  // matching the firearm-checkout attestation pattern.
  private async requireOwnerFirearmAttestation(
    proposal: { offeredListingId: string; ownerId: string },
    attestation: boolean | undefined,
  ) {
    const offered = await this.prisma.listing.findUnique({
      where: { id: proposal.offeredListingId },
      select: { isFirearm: true },
    });
    if (offered?.isFirearm && attestation !== true) {
      throw new BadRequestException(
        'You must confirm you are over 18 and (where applicable) hold the relevant SAPS competency to swap for a firearm.',
      );
    }
    if (offered?.isFirearm) {
      this.logger.log(
        `FIREARM_ATTESTATION swap-accept accepted=true owner=${proposal.ownerId} offered=${proposal.offeredListingId}`,
      );
    }
  }

  // ----------------------------------------------------------------
  // Notifications
  // ----------------------------------------------------------------
  private async notifyOwnerOfProposal(proposalId: string) {
    try {
      const proposal = await this.prisma.swapProposal.findUnique({
        where: { id: proposalId },
        include: {
          listing: true,
          offeredListing: true,
          owner: true,
          proposer: true,
        },
      });
      if (!proposal) return;
      const token = await this.actionTokens
        .mint({
          purpose: 'SWAP_PROPOSAL_DECISION',
          targetType: 'swapProposal',
          targetId: proposal.id,
          authorisedUserId: proposal.ownerId,
          expiresAt:
            proposal.expiresAt ??
            new Date(Date.now() + PROPOSAL_TTL_HOURS * 3_600_000),
        })
        .catch((err) => {
          this.logger.warn(`SWAP_PROPOSAL token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.swapProposalReceived({
        ownerEmail: proposal.owner.email,
        ownerName: proposal.owner.firstName ?? 'there',
        ownerPhone: proposal.owner.phone,
        proposerName: proposal.proposer.username ?? 'A member',
        wantedTitle: proposal.listing.title,
        wantedListingId: proposal.listingId,
        offeredTitle: proposal.offeredListing.title,
        cashAmount: proposal.cashAmount,
        cashFromProposer: proposal.cashDirection === SwapRole.INITIATOR_GIVES,
        proposalId: proposal.id,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`notifyOwnerOfProposal failed: ${(err as Error).message}`);
    }
  }

  private async notifyProposerOfCounter(proposalId: string) {
    try {
      const proposal = await this.prisma.swapProposal.findUnique({
        where: { id: proposalId },
        include: { listing: true, proposer: true },
      });
      if (!proposal || proposal.counterCashAmount === null) return;
      const token = await this.actionTokens
        .mint({
          purpose: 'SWAP_COUNTER_DECISION',
          targetType: 'swapProposal',
          targetId: proposal.id,
          authorisedUserId: proposal.proposerId,
          expiresAt:
            proposal.expiresAt ??
            new Date(Date.now() + COUNTER_TTL_HOURS * 3_600_000),
        })
        .catch((err) => {
          this.logger.warn(`SWAP_COUNTER token mint failed: ${(err as Error).message}`);
          return null;
        });
      await this.notifications.swapProposalCountered({
        proposerEmail: proposal.proposer.email,
        proposerName: proposal.proposer.firstName ?? 'there',
        proposerPhone: proposal.proposer.phone,
        wantedTitle: proposal.listing.title,
        wantedListingId: proposal.listingId,
        counterCashAmount: proposal.counterCashAmount,
        counterCashFromProposer:
          proposal.counterCashDirection === SwapRole.INITIATOR_GIVES,
        ownerNote: proposal.ownerNote ?? undefined,
        proposalId: proposal.id,
        actionUrl: token ? `${APP_URL()}/a/${token}` : undefined,
      });
    } catch (err) {
      this.logger.error(`notifyProposerOfCounter failed: ${(err as Error).message}`);
    }
  }

  private async notifyDeclined(proposalId: string, reason: 'declined' | 'expired') {
    try {
      const proposal = await this.prisma.swapProposal.findUnique({
        where: { id: proposalId },
        include: { listing: true, proposer: true },
      });
      if (!proposal) return;
      await this.notifications.swapDeclined({
        email: proposal.proposer.email,
        name: proposal.proposer.firstName ?? 'there',
        wantedTitle: proposal.listing.title,
        wantedListingId: proposal.listingId,
        reason,
        proposalId: proposal.id,
      });
    } catch (err) {
      this.logger.error(`notifyDeclined failed: ${(err as Error).message}`);
    }
  }
}
