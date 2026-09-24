import type { Request } from 'express';
import { PaymentsWebhookController } from './transactions.controller';

describe('Ozow payout verification response contract', () => {
  it('returns the required failure shape when AccessToken is invalid', async () => {
    const txService = {
      ozowPayoutAccessTokenValid: jest.fn().mockReturnValue(false),
    };
    const controller = new PaymentsWebhookController(txService as never);
    const response = await controller.ozowPayoutVerify(
      { headers: { accesstoken: 'wrong' } } as unknown as Request,
      { PayoutId: 'payout-1' },
    );

    expect(response).toEqual({
      payoutId: 'payout-1',
      isVerified: false,
      accountNumberDecryptionKey: '',
      reason: 'Unauthorized webhook call',
    });
  });
});
