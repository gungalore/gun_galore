import { OzowService } from './ozow.service';
import { normaliseOzowBank, bankByBranchCode } from './ozow-banks';

// No OZOW_* env in the test runner → mock mode (inert). These lock the
// "safe when unconfigured" contract + the pure parsing/normalisation.
describe('OzowService (mock mode — unconfigured)', () => {
  const svc = new OzowService();

  it('createPayment returns a mock- id and a ≤20 char merchant ref, never calls out', async () => {
    const r = await svc.createPayment({
      amountZarCents: 150_00,
      merchantTransactionId: 'cmabc1234567890defghijklmn',
      returnUrl: 'https://alloutdoor.co.za/checkout/complete',
    });
    expect(r.paymentId).toMatch(/^mock-/);
    expect(r.redirectUrl).toBe('');
    expect(r.merchantReference.length).toBeLessThanOrEqual(20);
  });

  it('refundPayment logs intent + returns MOCK_REFUND success (never a real reversal)', async () => {
    const r = await svc.refundPayment('txn_1', 5000);
    expect(r.success).toBe(true);
    expect(r.resultCode).toBe('MOCK_REFUND');
  });

  it('createPayout returns rejected with a reason (no disbursement)', async () => {
    const r = await svc.createPayout({
      txId: 'tx1',
      merchantReference: 'AO123',
      customerBankReference: 'AO 123',
      accountHolder: 'A Seller',
      bankAccountNumber: '123456789',
      branchCode: '250655',
      amountCents: 10_000,
      notifyUrl: 'https://x/y',
    });
    expect(r.accepted).toBe(false);
    expect(r.errorMessage).toBe('payouts not configured');
  });
});

describe('OzowService.parseTransactionWebhook', () => {
  const svc = new OzowService();

  it('reads a full transaction.complete delivery', () => {
    const evt = svc.parseTransactionWebhook({
      TransactionId: 'txn-9',
      TransactionReference: 'AOABC1234',
      Amount: '150.00',
      Status: 'Successful',
    });
    expect(evt.transactionId).toBe('txn-9');
    expect(evt.merchantReference).toBe('AOABC1234');
    expect(evt.amountCents).toBe(15_000);
    expect(evt.status).toBe('Successful');
  });

  it('reads a thin delivery (id + status)', () => {
    const evt = svc.parseTransactionWebhook({ id: 'txn-1', status: 'Error', reason: 'Cancelled' });
    expect(evt.transactionId).toBe('txn-1');
    expect(evt.status).toBe('Error');
    expect(evt.merchantReference).toBeUndefined();
  });
});

describe('normaliseOzowBank', () => {
  it('maps friendly frontend names + local spellings onto the Ozow bank', () => {
    expect(normaliseOzowBank('Capitec')?.groupName).toBe('Capitec Bank');
    expect(normaliseOzowBank('Standard Bank')?.groupName).toBe('Standard Bank');
    expect(normaliseOzowBank('First National Bank')?.groupName).toBe('FNB');
    expect(normaliseOzowBank('Bank Zero')?.groupName).toBe('Bank Zero');
  });

  it('returns null for unmappable names (payout run skips with a reason)', () => {
    expect(normaliseOzowBank('Bank of Narnia')).toBeNull();
    expect(normaliseOzowBank('')).toBeNull();
    expect(normaliseOzowBank(null)).toBeNull();
  });

  it('resolves a universal branch code to its bank', () => {
    expect(bankByBranchCode('250655')?.groupName).toBe('FNB');
    expect(bankByBranchCode('470010')?.groupName).toBe('Capitec Bank');
    expect(bankByBranchCode('nope')).toBeNull();
  });
});
