// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { BuyNowCta } from './buy-now-cta';
import { getCart } from '@/lib/cart-store';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

let signedIn = true;
vi.mock('../lib/auth', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
}));

const ITEM = {
  listingId: 'l1',
  title: 'Turret Tags',
  price: 10_000,
  sellerId: 's1',
  sellerUsername: 'seller',
  isFirearm: false,
  shippingMethods: ['COURIER'],
};

describe('BuyNowCta cart trace (2026-11-26 operator rule)', () => {
  beforeEach(() => {
    localStorage.clear();
    signedIn = true;
    push.mockClear();
  });

  it('adds the Buy Now line to the cart before navigating to checkout', () => {
    render(
      <BuyNowCta listingId="l1" cartItem={ITEM}>
        Buy on Marketplace
      </BuyNowCta>,
    );

    fireEvent.click(document.querySelector('a')!);

    const cart = getCart();
    expect(cart).toHaveLength(1);
    expect(cart[0].listingId).toBe('l1');
  });

  it('remembers the line for a signed-out buyer before sending them to sign-in', () => {
    signedIn = false;
    render(
      <BuyNowCta listingId="l1" cartItem={ITEM}>
        Buy on Marketplace
      </BuyNowCta>,
    );

    fireEvent.click(document.querySelector('button')!);

    expect(getCart()[0].listingId).toBe('l1');
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining('/sign-in?redirect_url='),
    );
  });

  it('does not add a line when the listing is not cart-carryable', () => {
    render(
      <BuyNowCta listingId="l1" cartItem={null}>
        Buy on Marketplace
      </BuyNowCta>,
    );

    fireEvent.click(document.querySelector('a')!);
    expect(getCart()).toHaveLength(0);
  });
});
