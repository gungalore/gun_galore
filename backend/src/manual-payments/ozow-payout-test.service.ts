import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OzowService,
  OzowPayoutBeneficiary,
  OzowPayoutTestConfiguration,
} from '../payments/ozow.service';

// The Ozow payout TEST-CASE harness. Impersonates a merchant payout so the
// mandatory money-out test cases can be run and their JSON captured, WITHOUT
// fabricating seller transactions: the request record goes in the isolated
// OzowPayoutTestAttempt table and the verify/notification handlers never
// mutate a Transaction for it.
//
// ⚠️ REFUSED BY DEFAULT. Three independent guards: this service runs only when
// OZOW_PAYOUT_TEST=true AND the environment is not live, and
// OzowService.createPayout refuses the mock host unless OZOW_PAYOUT_MOCK=true
// in a non-live environment. There is no accidental path to a payout.

export interface OzowTestPayoutInput {
  amountCents: number;
  accountHolder: string;
  accountNumber: string;
  /** Destination bank by Ozow bank name (e.g. "Absa"). */
  bankName?: string;
  /** Or by universal branch code (resolved against Ozow's live list). */
  branchCode?: string;
  label?: string;
  mock?: boolean;
}

/** The three mock failure scenarios Ozow's money-out tests require. */
export type OzowMockScenario =
  | 'decryptionFailed'
  | 'notVerified'
  | 'keyMissing';

/** Our logical scenario names → the config keys Ozow actually returns. */
export function resolveMockConfigKeys(
  config: Record<string, unknown>,
): Record<OzowMockScenario, string> & { all: string[] } {
  const keys = Object.keys(config);
  const find = (re: RegExp, fallback: string) =>
    keys.find((k) => re.test(k)) ?? fallback;
  const decryptionFailed = find(
    /decryptionfailed/i,
    'IsAccountDecryptionFailed',
  );
  const notVerified = find(/notverified/i, 'IsNotVerifiedResponse');
  const keyMissing = find(
    /accountdecryptionkeymissing|keymissing/i,
    'IsAccountDecryptionKeyMissing',
  );
  return {
    decryptionFailed,
    notVerified,
    keyMissing,
    all: Array.from(
      new Set([...keys, decryptionFailed, notVerified, keyMissing]),
    ),
  };
}

export type OzowTestPayoutResult = {
  label: string;
  merchantReference: string;
  attemptId: string;
  payoutId: string;
  accepted: boolean;
  status?: number;
  subStatus?: number;
  errorMessage?: string;
  isMock: boolean;
};

@Injectable()
export class OzowPayoutTestService {
  private readonly logger = new Logger(OzowPayoutTestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ozow: OzowService,
  ) {}

  private assertAvailable(): void {
    if (process.env.OZOW_ENV === 'live') {
      throw new ForbiddenException(
        'Ozow payout testing is disabled in live mode.',
      );
    }
    if (process.env.OZOW_PAYOUT_TEST !== 'true') {
      throw new ForbiddenException(
        'Ozow payout testing requires OZOW_PAYOUT_TEST=true.',
      );
    }
    if (!this.ozow.isPayoutsConfigured()) {
      throw new ServiceUnavailableException(
        'Ozow Payouts is not configured — cannot run payout tests.',
      );
    }
  }

  // Public /api origin for the payout notifyUrl. Mirrors ManualPaymentsService.
  private publicApiBase(): string {
    if (process.env.PUBLIC_API_URL)
      return process.env.PUBLIC_API_URL.replace(/\/$/, '');
    const fe = process.env.FRONTEND_URL;
    return fe ? `${fe.replace(/\/$/, '')}/api` : 'http://localhost:3001/api';
  }

  /** Submit one harness payout (real staging, or the mock endpoint). */
  async submitPayout(
    input: OzowTestPayoutInput,
  ): Promise<OzowTestPayoutResult> {
    this.assertAvailable();
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new BadRequestException('amountCents must be a positive integer');
    }
    if (!input.accountHolder?.trim() || !input.accountNumber?.trim()) {
      throw new BadRequestException(
        'accountHolder and accountNumber are required',
      );
    }
    if (!input.bankName?.trim() && !input.branchCode?.trim()) {
      throw new BadRequestException('Provide a bankName or a branchCode');
    }

    // Resolve the destination from Ozow's LIVE bank list, NOT our static seller
    // list — the staging test account (Ozow's Absa 4050338500) is reachable by
    // name/branch even though it is not a seller bank.
    const bank = await this.ozow.resolvePayoutBank({
      bankName: input.bankName,
      branchCode: input.branchCode,
    });
    if (!bank) {
      throw new BadRequestException(
        `No Ozow bank matches "${input.bankName ?? input.branchCode}" — check GET /getavailablebanks`,
      );
    }

    const label = (input.label ?? 'test').trim().slice(0, 40) || 'test';
    const isMock = input.mock === true;
    const merchantReference = `AOTEST${Date.now().toString(36).toUpperCase()}`
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 20);
    const customerBankReference =
      `AO ${label}`
        .replace(/[^A-Za-z0-9 -]/g, ' ')
        .trim()
        .slice(0, 20) || 'AO TEST';
    const notifyUrl = `${this.publicApiBase()}/payments/webhook/ozow-payout`;

    const beneficiary: OzowPayoutBeneficiary = {
      txId: `test-${merchantReference}`,
      merchantReference,
      customerBankReference,
      accountHolder: input.accountHolder.trim(),
      bankAccountNumber: input.accountNumber.trim(),
      branchCode: bank.universalBranchCode,
      amountCents: input.amountCents,
      notifyUrl,
    };

    let attemptId = '';
    const result = await this.ozow.createPayout(
      beneficiary,
      async (material) => {
        const row = await this.prisma.ozowPayoutTestAttempt.create({
          data: {
            label,
            isMock,
            siteCode: material.siteCode,
            merchantReference: material.merchantReference,
            customerBankReference: material.customerBankReference,
            amountCents: material.amountCents,
            isRtc: material.isRtc,
            notifyUrl: material.notifyUrl,
            bankGroupId: material.bankGroupId,
            encryptedAccountNumber: material.encryptedAccountNumber,
            branchCode: material.branchCode,
            encryptionKeyCiphertext: material.ciphertext,
            encryptionKeyIv: material.iv,
            encryptionKeyAuthTag: material.authTag,
          },
          select: { id: true },
        });
        attemptId = row.id;
        return row.id;
      },
      {
        mock: isMock,
        resolvedBank: {
          bankGroupId: bank.bankGroupId,
          branchCode: bank.universalBranchCode,
        },
      },
    );

    if (attemptId) {
      await this.prisma.ozowPayoutTestAttempt
        .update({
          where: { id: attemptId },
          data: {
            ...(result.payoutId ? { gatewayPayoutId: result.payoutId } : {}),
            requestStatus: result.status,
            requestSubStatus: result.subStatus,
            requestErrorMessage: result.errorMessage || null,
          },
        })
        .catch(() => undefined);
    } else {
      // The request was rejected before persistence (bad URL / unknown bank).
      throw new BadRequestException(
        result.errorMessage ?? 'Ozow rejected the test payout request',
      );
    }

    this.logger.log(
      `Ozow TEST payout ${label} (${isMock ? 'mock' : 'staging'}): ${result.accepted ? 'accepted' : 'rejected'} ${result.payoutId || result.errorMessage || ''}`,
    );
    return {
      label,
      merchantReference,
      attemptId,
      payoutId: result.payoutId,
      accepted: result.accepted,
      status: result.status,
      subStatus: result.subStatus,
      errorMessage: result.errorMessage,
      isMock,
    };
  }

  async getAttempt(id: string) {
    this.assertAvailable();
    return this.prisma.ozowPayoutTestAttempt.findUnique({ where: { id } });
  }

  async listAttempts() {
    this.assertAvailable();
    return this.prisma.ozowPayoutTestAttempt.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getTestConfiguration(): Promise<OzowPayoutTestConfiguration> {
    this.assertAvailable();
    return this.ozow.getPayoutTestConfiguration();
  }

  async setTestConfiguration(
    config: OzowPayoutTestConfiguration,
  ): Promise<OzowPayoutTestConfiguration> {
    this.assertAvailable();
    return this.ozow.setPayoutTestConfiguration(config);
  }

  async getMockPayout(payoutId: string): Promise<Record<string, unknown>> {
    this.assertAvailable();
    return this.ozow.getMockPayout(payoutId);
  }

  /**
   * Arm ONE mock scenario (or clear with null). Reads the live configuration
   * first and writes back using the EXACT key casing Ozow returns, then re-reads
   * to confirm — the flag names are documented inconsistently (PascalCase in the
   * OpenAPI vs camelCase in Ozow's test instructions), and a wrong-cased Set is
   * silently ignored, which would make a mock test pass for the wrong reason.
   */
  async setMockScenario(target: OzowMockScenario | null): Promise<{
    before: OzowPayoutTestConfiguration;
    set: OzowPayoutTestConfiguration;
    after: OzowPayoutTestConfiguration;
  }> {
    this.assertAvailable();
    const before = await this.ozow.getPayoutTestConfiguration();
    const keys = resolveMockConfigKeys(before);
    const payload: Record<string, boolean> = {};
    for (const key of keys.all) payload[key] = false;
    if (target) payload[keys[target]] = true;
    const set = await this.ozow.setPayoutTestConfiguration(payload);
    const after = await this.ozow.getPayoutTestConfiguration();
    return { before, set, after };
  }
}
