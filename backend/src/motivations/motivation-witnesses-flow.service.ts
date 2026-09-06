import { Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { MotivationQuotaService } from './motivation-quota.service';
import { MotivationWitnessService } from './motivation-witness.service';
import { MotivationSharedService } from './motivation-shared.service';

// ────────────────────────────────────────────────────────────────────
// CHARACTER WITNESSES, from the applicant's side of the invitation.
// MotivationWitnessService owns the token, the SMS and the signing page;
// this owns the ownership check in front of all four routes.
// ────────────────────────────────────────────────────────────────────

@Injectable()
export class MotivationWitnessesService {
  private readonly logger = new Logger(MotivationWitnessesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: MotivationQuotaService,
    private readonly witnesses: MotivationWitnessService,
    private readonly shared: MotivationSharedService,
  ) {}

  // ── Character witnesses ─────────────────────────────────────────
  //
  // ⚠️ OWNERSHIP IS CHECKED HERE AND ONLY HERE. MotivationWitnessService knows
  // nothing about who is calling — it works from ids — because its other half
  // is reached by a stranger holding a link. Every applicant-side entry point
  // has to prove the motivation belongs to the caller before it delegates.

  private async requireOwnMotivation(clerkId: string, id: string) {
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    return { user, row };
  }

  async listWitnesses(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const { row } = await this.requireOwnMotivation(clerkId, id);
    return { witnesses: await this.witnesses.list(row.id) };
  }

  async inviteWitness(
    clerkId: string,
    id: string,
    args: { slot: number; name: string; phone: string },
  ) {
    await this.quota.assertEnabled();
    const { user, row } = await this.requireOwnMotivation(clerkId, id);
    const answers = this.shared.readAnswers(row.answersEncrypted);
    return this.witnesses.invite({
      motivationId: row.id,
      applicantUserId: user.id,
      applicantName: (answers.full_name ?? '').trim() || 'An All Outdoor member',
      slot: args.slot,
      name: args.name,
      phone: args.phone,
      // ⚠️ FROM THE ENVIRONMENT, NEVER FROM THE REQUEST. A base URL taken off a
      // Host header is a base URL an attacker can set, and this one is posted
      // to a third party by SMS.
      baseUrl: process.env.FRONTEND_URL ?? 'https://alloutdoor.co.za',
    });
  }

  async removeWitness(clerkId: string, id: string, witnessId: string) {
    await this.quota.assertEnabled();
    const { row } = await this.requireOwnMotivation(clerkId, id);
    await this.witnesses.remove(row.id, witnessId);
    return { removed: true as const };
  }

  async witnessSignature(clerkId: string, id: string, witnessId: string) {
    await this.quota.assertEnabled();
    const { row } = await this.requireOwnMotivation(clerkId, id);
    const owned = await this.prisma.motivationWitness.findFirst({
      where: { id: witnessId, motivationId: row.id },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Witness not found');
    return this.witnesses.signature(owned.id);
  }
}
