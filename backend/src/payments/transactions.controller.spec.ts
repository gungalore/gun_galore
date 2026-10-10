// The CHECKOUT action token must be single-use: consume it AFTER a successful
// transaction create. It legitimately spans the earlier load-user / save-address
// requests, so it can't be consumed on first read; and a lost consume race must
// not fail an already-created order (the reservation CAS is the real guard).
jest.mock('meilisearch', () => ({ Meilisearch: class {} }));

import { BadRequestException } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';

function makeController(
  over: {
    createImpl?: jest.Mock;
    consumeImpl?: jest.Mock;
  } = {},
) {
  const txService = {
    create:
      over.createImpl ?? jest.fn().mockResolvedValue({ transactionId: 'TX1' }),
  };
  const tokens = {
    consume: over.consumeImpl ?? jest.fn().mockResolvedValue(undefined),
  };
  const controller = new TransactionsController(
    txService as never,
    {} as never, // tracking
    {} as never, // dealerVerification
    {} as never, // receipts
    tokens as never,
  );
  return { controller, txService, tokens };
}

function req(over: Record<string, unknown> = {}) {
  return {
    protocol: 'https',
    ip: '1.2.3.4',
    get: () => 'test-agent',
    ...over,
  } as never;
}

describe('TransactionsController.create — CHECKOUT token consumption', () => {
  const dto = { listingId: 'L1' } as never;

  it('consumes the token after a successful create', async () => {
    const { controller, tokens } = makeController();
    const result = await controller.create(
      'U1',
      dto,
      req({
        viaActionToken: true,
        actionToken: 'tok-1',
        actionTokenTargetId: 'L1',
      }),
    );
    expect(result).toEqual({ transactionId: 'TX1' });
    expect(tokens.consume).toHaveBeenCalledWith(
      'tok-1',
      '1.2.3.4',
      'test-agent',
    );
  });

  it('does not consume on a session-authenticated create', async () => {
    const { controller, tokens } = makeController();
    await controller.create('U1', dto, req());
    expect(tokens.consume).not.toHaveBeenCalled();
  });

  it('rejects a token used against a different listing before creating', async () => {
    const { controller, txService, tokens } = makeController();
    await expect(
      controller.create(
        'U1',
        dto,
        req({
          viaActionToken: true,
          actionToken: 'tok-1',
          actionTokenTargetId: 'OTHER',
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(txService.create).not.toHaveBeenCalled();
    expect(tokens.consume).not.toHaveBeenCalled();
  });

  it('still returns the order when the consume race loses', async () => {
    const { controller } = makeController({
      consumeImpl: jest.fn().mockRejectedValue(new Error('already used')),
    });
    await expect(
      controller.create(
        'U1',
        dto,
        req({
          viaActionToken: true,
          actionToken: 'tok-1',
          actionTokenTargetId: 'L1',
        }),
      ),
    ).resolves.toEqual({ transactionId: 'TX1' });
  });
});
