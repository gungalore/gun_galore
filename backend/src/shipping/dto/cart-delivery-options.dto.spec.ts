// class-validator/class-transformer decorators need the metadata polyfill.
import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CartDeliveryOptionsDto } from './cart-delivery-options.dto';

/**
 * The first assertion here is that the module IMPORTS AT ALL.
 *
 * `emitDecoratorMetadata` emits `Reflect.metadata('design:type', X)` for a
 * decorated property, and that reference is evaluated EAGERLY when the class
 * is defined. Declaring the address DTO *after* the class that uses it put it
 * in the temporal dead zone, so the module threw
 * `ReferenceError: Cannot access 'CartDeliveryAddressDto' before initialization`
 * on load — which took the whole API down at boot. tsc sees nothing wrong:
 * the types are fine, only the runtime declaration order is not.
 */
describe('CartDeliveryOptionsDto', () => {
  const address = {
    streetAddress: '44 Stanley Avenue',
    suburb: 'Milpark',
    city: 'Johannesburg',
    postalCode: '2092',
    province: 'GAUTENG',
  };

  it('accepts a well-formed cart quote request', async () => {
    const dto = plainToInstance(CartDeliveryOptionsDto, {
      lines: [{ listingId: 'L1', quantity: 2 }],
      deliveryAddress: address,
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects an empty cart', async () => {
    const dto = plainToInstance(CartDeliveryOptionsDto, {
      lines: [],
      deliveryAddress: address,
    });
    expect((await validate(dto)).some((e) => e.property === 'lines')).toBe(true);
  });

  it('rejects a province that is not a real province', async () => {
    // The whole reason this DTO does not reuse the shared address type, which
    // types province as a bare string.
    const dto = plainToInstance(CartDeliveryOptionsDto, {
      lines: [{ listingId: 'L1' }],
      deliveryAddress: { ...address, province: 'ATLANTIS' },
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('rejects a line with no listing id', async () => {
    const dto = plainToInstance(CartDeliveryOptionsDto, {
      lines: [{ quantity: 1 }],
      deliveryAddress: address,
    });
    expect(await validate(dto)).not.toHaveLength(0);
  });
});
