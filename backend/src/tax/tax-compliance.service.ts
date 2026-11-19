import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FLAGS, SettingsService } from '../settings/settings.service';
import {
  DEFAULT_MICRO_BUSINESS_TURNOVER_LIMIT_CENTS,
  DEFAULT_VAT_RATE_PERCENT,
  VAT_REGISTRATION_THRESHOLD_CENTS,
  rollingWindowStart,
  summariseTurnover,
  thresholdHeadroomCents,
  thresholdPercent,
  type TaxTurnoverBasis,
  type TaxTurnoverRow,
} from './tax-profile';

export interface TaxComplianceReport {
  asOf: string;
  regime: string;
  vatRegistered: boolean;
  vatNumberPresent: boolean;
  vatRegistrationDate: string | null;
  vatRatePercent: number;
  vatThresholdCents: number;
  vatBasis: TaxTurnoverBasis;
  vatBasisCents: number;
  vatThresholdPercent: number;
  vatHeadroomCents: number;
  grossSalesCents: number;
  agentRevenueCents: number;
  principalRevenueCents: number;
  microBusinessTaxEnabled: boolean;
  microBusinessTaxYearEnd: string | null;
  microBusinessLimitCents: number;
  microBusinessBasisCents: number;
  microBusinessEligible: boolean;
  zohoConfigured: boolean;
  notes: string[];
}

@Injectable()
export class TaxComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * The rolling 12-month picture. Deliberately a REPORT, not a tax return:
   * it never flips VAT registration or calculates turnover tax.
   */
  async report(now = new Date()): Promise<TaxComplianceReport> {
    const [
      regime,
      vatRegistered,
      vatNumber,
      vatRegistrationDate,
      vatThresholdConfigured,
      vatRatePercent,
      vatBasis,
      microEnabled,
      microYearEnd,
      microLimitConfigured,
    ] = await Promise.all([
      this.settings.get(FLAGS.taxRegime),
      this.settings.get(FLAGS.vatRegistered),
      this.settings.get(FLAGS.vatNumber),
      this.settings.get(FLAGS.vatRegistrationDate),
      this.settings.get(FLAGS.vatRegistrationThresholdCents),
      this.settings.get(FLAGS.vatRatePercent),
      this.settings.get(FLAGS.vatTurnoverBasis),
      this.settings.get(FLAGS.microBusinessTaxEnabled),
      this.settings.get(FLAGS.microBusinessTaxYearEnd),
      this.settings.get(FLAGS.microBusinessTurnoverLimitCents),
    ]);

    const from = rollingWindowStart(now);
    const rows = await this.prisma.transaction.findMany({
      where: {
        paidAt: { gte: from },
        refundOfId: null,
      },
      select: {
        paidAt: true,
        buyerTotal: true,
        refundedAmount: true,
        processingFee: true,
        commissionZar: true,
        shippingHandlingCents: true,
      },
    });

    const turnoverRows: TaxTurnoverRow[] = rows.map((row) => ({
      paidAt: row.paidAt ?? from,
      supplyRole: 'AGENT',
      grossSalesCents: row.buyerTotal,
      agentRevenueCents:
        row.processingFee + row.commissionZar + row.shippingHandlingCents,
      principalRevenueCents: 0,
      refundedCents: row.refundedAmount,
    }));

    const basis: TaxTurnoverBasis =
      vatBasis === 'GROSS_SALES' ? 'GROSS_SALES' : 'AGENT_REVENUE';
    const summary = summariseTurnover(turnoverRows, basis);
    const vatThresholdCents =
      vatThresholdConfigured > 0
        ? vatThresholdConfigured
        : VAT_REGISTRATION_THRESHOLD_CENTS;
    const microLimitCents =
      microLimitConfigured > 0
        ? microLimitConfigured
        : DEFAULT_MICRO_BUSINESS_TURNOVER_LIMIT_CENTS;

    const notes: string[] = [
      'Marketplace Buy Now and Auction sales are AGENT supplies: item price and delivery are collected for the seller/courier and are not ALL Outdoor revenue or VAT turnover.',
      'Motivation is the only PRINCIPAL product, and only once its paygate exists.',
      'Turnover tax is an annual income-tax regime; it is never added to an invoice.',
      'This report does not register the business for VAT or file any return.',
    ];

    return {
      asOf: now.toISOString(),
      regime,
      vatRegistered,
      vatNumberPresent: Boolean(vatNumber.trim()),
      vatRegistrationDate: vatRegistrationDate || null,
      vatRatePercent:
        vatRatePercent > 0 ? vatRatePercent : DEFAULT_VAT_RATE_PERCENT,
      vatThresholdCents,
      vatBasis: basis,
      vatBasisCents: summary.basisCents,
      vatThresholdPercent: thresholdPercent(
        summary.basisCents,
        vatThresholdCents,
      ),
      vatHeadroomCents: thresholdHeadroomCents(
        summary.basisCents,
        vatThresholdCents,
      ),
      grossSalesCents: summary.grossSalesCents,
      agentRevenueCents: summary.agentRevenueCents,
      principalRevenueCents: summary.principalRevenueCents,
      microBusinessTaxEnabled: microEnabled,
      microBusinessTaxYearEnd: microYearEnd || null,
      microBusinessLimitCents: microLimitCents,
      microBusinessBasisCents: summary.agentRevenueCents,
      microBusinessEligible:
        microEnabled && summary.agentRevenueCents <= microLimitCents,
      zohoConfigured: Boolean(process.env.ZOHO_BOOKS_ENABLED === 'true'),
      notes,
    };
  }
}
