import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSaIdNumber } from '../common/id-crypto';
import { PeachService } from './peach.service';

/**
 * Bank-account verification (BANV) request seam.
 *
 * Every path that saves banking details calls request(userId). The check can
 * only run when an SA ID is already on file; a buyer who saves refund details
 * before any identity step is skipped until their profile supplies one. The
 * result is applied by TransactionsService.handlePeachBanvWebhook.
 */
@Injectable()
export class BanvService {
  private readonly logger = new Logger(BanvService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly peach: PeachService,
  ) {}

  isEnabled(): boolean {
    return this.peach.isBanvEnabled();
  }

  async request(userId: string): Promise<void> {
    if (!this.isEnabled()) return;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        bankAccountNumber: true,
        bankBranchCode: true,
        bankAccountType: true,
        idNumberEncrypted: true,
        firstName: true,
        lastName: true,
      },
    });
    if (
      !user ||
      !user.bankAccountNumber ||
      !user.bankBranchCode ||
      !user.idNumberEncrypted
    ) {
      return;
    }
    try {
      const idNumber = decryptSaIdNumber(user.idNumberEncrypted);
      const res = await this.peach.verifyBankAccount({
        accountNumber: user.bankAccountNumber,
        branchCode: user.bankBranchCode,
        accountType: user.bankAccountType ?? 'unknown',
        idNumber,
        initials: user.firstName ? user.firstName.trim().charAt(0) : undefined,
        lastName: user.lastName ?? undefined,
      });
      if (!res) return;
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          bankVerificationId: res.bankVerificationId,
          bankAvsResult: `REQUESTED:${res.resultCode ?? res.status}`,
        },
      });
      this.logger.log(
        `BANV requested for user ${user.id} (verification ${res.bankVerificationId})`,
      );
    } catch (err) {
      this.logger.warn(
        `BANV request failed for user ${userId}: ${(err as Error).message}`,
      );
    }
  }
}
