import { orderRef } from './order-reference';

describe('orderRef', () => {
  it('uses the real orderReference when one was allocated', () => {
    expect(
      orderRef({ id: 'cktxn1234567890abcdef', orderReference: 'EFT-0042' }),
    ).toBe('EFT-0042');
  });

  it('falls back to the last 8 chars of the id, uppercased, when absent', () => {
    expect(orderRef({ id: 'cktxnabcdefgh12345678' })).toBe('12345678'.toUpperCase());
  });

  it('falls back the same way for a null orderReference', () => {
    expect(orderRef({ id: 'cktxnabcdefgh12345678', orderReference: null })).toBe(
      '12345678'.toUpperCase(),
    );
  });

  it('uppercases a lower-case tail of the id', () => {
    expect(orderRef({ id: 'xxxxxxxxabcdefgh' })).toBe('ABCDEFGH');
  });

  it('never invents an orderReference for an empty string one — treats it as present', () => {
    // An empty string is falsy-adjacent but not null/undefined; ?? only
    // catches null/undefined, so an explicit '' is returned as-is. This
    // documents that behaviour rather than silently relying on it.
    expect(orderRef({ id: 'cktxnabcdefgh12345678', orderReference: '' })).toBe('');
  });
});
