// class-validator decorators need the metadata polyfill.
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ShippingMethod } from '@prisma/client';
import { CreateTransactionDto } from './create-transaction.dto';

// The checkout delivery instructions are a LABEL field: an optional string the
// buyer types for the courier, hard-capped at 120 chars. These cases lock the
// DTO contract; TransactionsService sanitises + nulls it for non-courier sales.

function instance(over: Record<string, unknown>): CreateTransactionDto {
  return plainToInstance(CreateTransactionDto, {
    listingId: 'L1',
    shippingMethod: ShippingMethod.COURIER,
    ...over,
  });
}

async function instructionErrors(over: Record<string, unknown>) {
  const errors = await validate(instance(over));
  return errors.filter((e) => e.property === 'deliveryInstructions');
}

describe('CreateTransactionDto.deliveryInstructions', () => {
  it('is optional', async () => {
    expect(await instructionErrors({})).toHaveLength(0);
  });

  it('accepts a plain string on a courier checkout', async () => {
    expect(
      await instructionErrors({ deliveryInstructions: 'Ring the bell twice' }),
    ).toHaveLength(0);
  });

  it('accepts exactly 120 characters and rejects 121', async () => {
    expect(
      await instructionErrors({ deliveryInstructions: 'a'.repeat(120) }),
    ).toHaveLength(0);
    expect(
      await instructionErrors({ deliveryInstructions: 'a'.repeat(121) }),
    ).toHaveLength(1);
  });

  it('rejects a non-string value', async () => {
    expect(await instructionErrors({ deliveryInstructions: 42 })).toHaveLength(1);
  });
});
