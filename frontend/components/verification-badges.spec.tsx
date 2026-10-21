// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VerificationBadges } from './verification-badges';

describe('VerificationBadges', () => {
  it('shows only the checks the member has completed', () => {
    render(
      <VerificationBadges
        verification={{
          phoneVerified: true,
          emailVerified: true,
          idVerified: false,
        }}
      />,
    );

    expect(screen.getByLabelText('Phone verified')).toBeTruthy();
    expect(screen.getByLabelText('Email verified')).toBeTruthy();
    expect(screen.queryByLabelText('ID verified')).toBeNull();
  });

  it('renders nothing when nothing is verified', () => {
    const { container } = render(
      <VerificationBadges
        verification={{
          phoneVerified: false,
          emailVerified: false,
          idVerified: false,
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
