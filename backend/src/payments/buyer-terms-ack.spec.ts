// class-validator decorators need the metadata polyfill; Nest's own
// bootstrap loads it, a bare jest run does not.
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { vicinityLabel } from '../common/province-labels';
import { toPublicLocality } from '../listings/locality';

/**
 * The buyer's pre-payment acknowledgement, and the vicinity it points at.
 *
 * CPA s49 is why this is a tick and not a line buried in the Terms: a term
 * limiting a consumer's rights must be in plain language, their attention must
 * be drawn to it, and they must assent. These assertions cover the two halves
 * that make the record defensible — that it cannot be skipped, and that what
 * was shown is recoverable afterwards.
 */
describe('buyer terms acknowledgement — DTO gate', () => {
  const baseTx = {
    listingId: 'L1',
    shippingMethod: 'PUDO',
    pudoPickupLockerId: 'CG929',
  };

  it('rejects a single-item checkout with the acknowledgement missing', async () => {
    const dto = plainToInstance(CreateTransactionDto, { ...baseTx });
    const errors = await validate(dto);
    expect(
      errors.some((e) => e.property === 'buyerTermsAccepted'),
    ).toBe(true);
  });

  it('rejects it when explicitly false — absence and refusal are the same', async () => {
    const dto = plainToInstance(CreateTransactionDto, {
      ...baseTx,
      buyerTermsAccepted: false,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'buyerTermsAccepted')).toBe(true);
  });

  it('accepts it when true', async () => {
    const dto = plainToInstance(CreateTransactionDto, {
      ...baseTx,
      buyerTermsAccepted: true,
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'buyerTermsAccepted')).toBe(false);
  });

  it('requires it on the ORDER, not per line — one tick covers the cart', async () => {
    const missing = plainToInstance(CreateOrderDto, {
      lines: [{ listingId: 'L1', shippingMethod: 'PUDO' }],
    });
    expect(
      (await validate(missing)).some((e) => e.property === 'buyerTermsAccepted'),
    ).toBe(true);

    const ok = plainToInstance(CreateOrderDto, {
      buyerTermsAccepted: true,
      lines: [{ listingId: 'L1', shippingMethod: 'PUDO' }],
    });
    expect(
      (await validate(ok)).some((e) => e.property === 'buyerTermsAccepted'),
    ).toBe(false);
  });
});

describe('vicinity shown to the buyer', () => {
  it('is town + province for an ordinary listing', () => {
    expect(
      vicinityLabel({
        isFirearm: false,
        publicLocality: 'Centurion',
        province: 'GAUTENG',
      }),
    ).toBe('Centurion, Gauteng');
  });

  it('falls back to the province alone when a listing predates publicLocality', () => {
    expect(
      vicinityLabel({
        isFirearm: false,
        publicLocality: null,
        province: 'WESTERN_CAPE',
      }),
    ).toBe('Western Cape');
  });

  it('uses the planned dealer for a firearm — it never moves from the seller', () => {
    expect(
      vicinityLabel({
        isFirearm: true,
        plannedDealerLocation: 'Van der Merwe Arms — Centurion, Gauteng',
        publicLocality: 'Sandton',
        province: 'GAUTENG',
      }),
    ).toBe('Van der Merwe Arms — Centurion, Gauteng');
  });
});

describe('toPublicLocality refuses anything finer than a town', () => {
  it('passes a plain town through', () => {
    expect(toPublicLocality('Cape Town')).toBe('Cape Town');
  });

  it('collapses stray whitespace', () => {
    expect(toPublicLocality('  Port   Elizabeth ')).toBe('Port Elizabeth');
  });

  it('refuses a hand-typed street address rather than publishing it', () => {
    // The whole point: a listing with no town is fixable, a listing that
    // published someone's street address is not.
    expect(toPublicLocality('12 Kruis Street, Centurion')).toBeNull();
    expect(toPublicLocality('Unit 4, Sandton')).toBeNull();
  });

  it('treats blank and missing as no locality', () => {
    expect(toPublicLocality('   ')).toBeNull();
    expect(toPublicLocality(null)).toBeNull();
    expect(toPublicLocality(undefined)).toBeNull();
  });
});
