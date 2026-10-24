/*
 * Renders the seller remittance advices the platform issues at payout, using
 * the same sample amounts as the Zoho marketplace smoke test. Proves the
 * document is one page and well-formed without needing a live payout.
 *
 * Run from backend/:  npx ts-node --transpile-only --project tsconfig.json scripts/remittance-smoke.ts
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { FeeModel } from '@prisma/client';
import { RemittanceService } from '../src/payments/remittance.service';

const PAID_AT = new Date();
const OUT = path.join(os.tmpdir(), 'alloutdoor-remittance-smoke');

const cases = [
  {
    label: 'Auction',
    expectedNet: 95_000,
    tx: {
      id: 'smoke-au',
      listingPrice: 100_000,
      shippingCost: 15_000,
      shippingHandlingCents: 0,
      processingFee: 5_750,
      buyerTotal: 120_750,
      passFeeToBuyer: true,
      commissionZar: 5_000,
      sellerPayout: 95_000,
      feeModel: FeeModel.SELLER_DEDUCT,
      paidOutAt: PAID_AT,
      orderReference: 'SMOKE-AU-REMITTANCE',
      order: null,
      listing: { title: 'X-BAG' },
      seller: { username: 'smoke_seller' },
    },
  },
  {
    label: 'Buy Now',
    expectedNet: 100_000,
    tx: {
      id: 'smoke-bn',
      listingPrice: 100_000,
      shippingCost: 15_000,
      shippingHandlingCents: 0,
      processingFee: 11_500,
      buyerTotal: 126_500,
      passFeeToBuyer: true,
      commissionZar: 0,
      sellerPayout: 100_000,
      feeModel: FeeModel.BUYNOW_MARKUP,
      paidOutAt: PAID_AT,
      orderReference: 'SMOKE-BN-REMITTANCE',
      order: null,
      listing: { title: 'X-BAG' },
      seller: { username: 'smoke_seller' },
    },
  },
];

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  const svc = new RemittanceService({} as never);
  let failed = false;

  for (const c of cases) {
    const { pdf, filename } = await svc.buildPdf(c.tx as never);
    const doc = await PDFDocument.load(pdf);
    const pages = doc.getPageCount();
    const file = path.join(OUT, filename);
    fs.writeFileSync(file, pdf);

    const ok = pages === 1;
    if (!ok) failed = true;
    console.log(
      `  ${c.label}: ${ok ? 'OK' : 'FAIL'} pages=${pages} net=R${(c.expectedNet / 100).toFixed(2)} -> ${file}`,
    );
  }

  if (failed) {
    console.error('REMITTANCE SMOKE FAILED');
    process.exit(1);
  }
  console.log('REMITTANCE SMOKE PASSED');
}

void main();
