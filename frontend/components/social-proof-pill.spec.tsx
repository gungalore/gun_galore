// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SocialProofPill } from './social-proof-pill';

// The saved count is a real number, so the floor matters: the operator asked
// for it from the first save, but "0 saved" must never render on a cold
// listing, and a surface can still opt into the older >=3 gate.
describe('SocialProofPill - count floor', () => {
  it('renders the first save', () => {
    render(<SocialProofPill count={1} />);
    expect(screen.getByText(/saved by 1 person/i)).toBeTruthy();
  });

  it('never renders a zero count', () => {
    const { container } = render(<SocialProofPill count={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('pluralises real counts', () => {
    render(<SocialProofPill count={4} />);
    expect(screen.getByText(/saved by 4 people/i)).toBeTruthy();
  });

  it('honours a caller-supplied higher floor', () => {
    const { container } = render(
      <SocialProofPill count={2} minCount={3} />,
    );
    expect(container.innerHTML).toBe('');
  });
});
