import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import {
  VaultConsentState,
  mayKeep,
  mayOfferAcrossApplications,
  mustAsk,
  vaultConsentState,
} from '../licence-centre/vault-consent';
import { VAULT_CONSENT_VERSION } from '../licence-centre/vault-consent-version';

// ────────────────────────────────────────────────────────────────────
// READING AND WRITING THE ANSWER.
//
// The decision logic is next door in vault-consent.ts and is pure; this is the
// thin layer that fetches the row and stamps it. Keeping them apart is what
// lets the five-state table be tested without a database.
//
// ⚠️ NOT FLAG-GATED, DELIBERATELY. Every other route in this module begins
// with quota.assertEnabled(), which 404s when the Document Centre is switched
// off. The Motivation Centre has to know the consent state whether or not the
// Centre is open — a page that cannot ask the question renders as though
// nobody has consented, and would put the window in front of someone who
// already said yes. Same reasoning already applied to the `status` route.
//
// ⚠️ THE VERSION IS STAMPED HERE AND NOWHERE ELSE, from the constant, never
// from the request. A version the client can choose is not evidence of
// anything.
//
// ⚠️ WHY IT LIVES IN users/ AND NOT IN licence-centre/, WHERE IT BELONGS.
// Both sides need it: the Document Centre's controller serves the routes, and
// motivations.service asks it whether a member's documents may be offered
// across applications. But LicenceCentreModule imports MotivationsModule (for
// the renewal one-tap) and a spec asserts the edge stays one-way — so
// MotivationsModule cannot import the Centre back without a cycle that tsc
// passes and Nest crash-loops on.
//
// UsersModule is @Global, and the columns this reads are on User. So it is
// injectable from both sides with no new module edge at all. The pure
// decision table stays next door in licence-centre/vault-consent.ts, where it
// reads with the rest of the Centre; a pure file is not a provider and
// importing it creates no graph.
// ────────────────────────────────────────────────────────────────────

const SELECT = {
  id: true,
  documentVaultConsentAt: true,
  documentVaultConsentVersion: true,
  documentVaultConsentWithdrawnAt: true,
  documentVaultBackfilledAt: true,
} as const;

export interface VaultConsentView {
  state: VaultConsentState;
  /** The wording currently in force, so the client renders the right text. */
  version: string;
  /** Put the window in front of them. */
  ask: boolean;
  /** May we copy documents out of applications right now? */
  keeping: boolean;
  /**
   * Is the one-off copy of their older documents finished?
   *
   * ⚠️ FALSE ALSO MEANS "NEVER STARTED", which is the normal state for anybody
   * who has not said yes. The Centre only shows a progress line once the
   * remaining count is non-zero, so the two cases do not need telling apart
   * here.
   */
  backfillDone: boolean;
  /**
   * How long a document from an application lives without this consent.
   *
   * ⚠️ FROM THE SETTING, NEVER HARD-CODED IN THE COPY. It is
   * motivation_retention_days and an operator can change it.
   */
  retentionDays: number;
}

@Injectable()
export class VaultConsentService {
  private readonly logger = new Logger(VaultConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    // @Global. The window quotes how long a document survives WITHOUT this,
    // and that number is operator-settable — a notice that says "two years"
    // while the setting says otherwise is a false statement in a consent.
    private readonly settings: SettingsService,
  ) {}

  private async requireUser(clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private view(
    retentionDays: number,
    u: {
      documentVaultConsentAt: Date | null;
      documentVaultConsentVersion: string | null;
      documentVaultConsentWithdrawnAt: Date | null;
      documentVaultBackfilledAt: Date | null;
    },
  ): VaultConsentView {
    const state = vaultConsentState(u);
    return {
      state,
      version: VAULT_CONSENT_VERSION,
      ask: mustAsk(state),
      keeping: mayKeep(state),
      backfillDone: !!u.documentVaultBackfilledAt,
      retentionDays,
    };
  }

  /** The motivation retention window, in days. */
  private async retention(): Promise<number> {
    return this.settings.get(FLAGS.motivationRetentionDays);
  }

  async get(clerkId: string): Promise<VaultConsentView> {
    return this.view(await this.retention(), await this.requireUser(clerkId));
  }

  /**
   * The one place either answer is recorded.
   *
   * ⚠️ THE VERSION GOES ON BOTH. A decline that stamps nothing is
   * indistinguishable from never having been asked, and the window would
   * return on every single visit — which is how a consent prompt turns into
   * something people click through without reading.
   */
  async answer(clerkId: string, agreed: boolean): Promise<VaultConsentView> {
    const user = await this.requireUser(clerkId);
    const now = new Date();
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        documentVaultConsentVersion: VAULT_CONSENT_VERSION,
        documentVaultConsentAt: agreed ? now : null,
        // ⚠️ A YES CLEARS A PREVIOUS WITHDRAWAL, or somebody who turns it back
        // on stays permanently 'withdrawn' — withdrawal wins over everything
        // in the state table, so leaving the stamp would make the yes inert.
        documentVaultConsentWithdrawnAt: agreed
          ? null
          : user.documentVaultConsentWithdrawnAt,
      },
      select: SELECT,
    });
    this.logger.log(
      `Document Centre consent ${agreed ? 'given' : 'declined'} (${VAULT_CONSENT_VERSION}) by user ${user.id}`,
    );
    return this.view(await this.retention(), updated);
  }

  /**
   * Turn it off.
   *
   * ⚠️ DELETES NOTHING, AND THE COPY SAYS SO. Withdrawal stops us keeping
   * anything NEW and stops us offering across applications; the documents
   * already in the Centre stay until the member removes them one at a time.
   * Bulk-deleting on withdrawal would destroy somebody's paperwork on the
   * strength of a toggle, and there is no route that does it.
   *
   * consentAt is deliberately left in place — "agreed once and withdrew since"
   * is a different fact from "never agreed", and a nulled timestamp cannot
   * tell them apart.
   */
  async withdraw(clerkId: string): Promise<VaultConsentView> {
    const user = await this.requireUser(clerkId);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { documentVaultConsentWithdrawnAt: new Date() },
      select: SELECT,
    });
    this.logger.log(`Document Centre consent withdrawn by user ${user.id}`);
    return this.view(await this.retention(), updated);
  }

  /**
   * May this member's documents be offered on an application other than the
   * one they were attached to?
   *
   * Called from the motivations side, which is why it takes our own user id
   * rather than a Clerk one.
   */
  async mayOfferAcross(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        documentVaultConsentAt: true,
        documentVaultConsentVersion: true,
        documentVaultConsentWithdrawnAt: true,
      },
    });
    // No row is not a decision. Fail to today's behaviour rather than
    // silently narrowing somebody's library because a lookup missed.
    if (!u) return true;
    return mayOfferAcrossApplications(vaultConsentState(u));
  }

  /** May we copy this member's documents into the Centre? */
  async mayKeepFor(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        documentVaultConsentAt: true,
        documentVaultConsentVersion: true,
        documentVaultConsentWithdrawnAt: true,
      },
    });
    // ⚠️ FAILS CLOSED, unlike mayOfferAcross above. Keeping is NEW processing
    // and needs a yes we can point at; offering is what the product already
    // does and only stops on an explicit no.
    if (!u) return false;
    return mayKeep(vaultConsentState(u));
  }
}
