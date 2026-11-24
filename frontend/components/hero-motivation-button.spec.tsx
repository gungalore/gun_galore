// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HeroMotivationButton } from './hero-motivation-button';

const auth = vi.hoisted(() => ({ isSignedIn: false }));

vi.mock('@/lib/auth', () => ({
  useUser: () => auth,
}));

beforeEach(() => {
  auth.isSignedIn = false;
});

describe('HeroMotivationButton', () => {
  it('shows the published price and the public entry point when signed out', () => {
    render(<HeroMotivationButton />);
    const link = screen.getByRole('link', {
      name: /Motivation Creator - R295/i,
    });
    expect(link.getAttribute('href')).toBe('/motivation');
  });

  it('goes straight to the application when signed in', () => {
    auth.isSignedIn = true;
    render(<HeroMotivationButton />);
    expect(
      screen
        .getByRole('link', { name: /Motivation Creator - R295/i })
        .getAttribute('href'),
    ).toBe('/licence-centre/applications');
  });
});
