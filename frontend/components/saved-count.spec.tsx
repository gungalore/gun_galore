// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SavedCount } from './saved-count';

describe('SavedCount - card social proof', () => {
  it('shows the number from the first save', () => {
    render(<SavedCount count={1} />);
    expect(screen.getByText('1 saved')).toBeTruthy();
  });

  it('renders the real count, not a rounded-up placeholder', () => {
    render(<SavedCount count={12} />);
    expect(screen.getByText('12 saved')).toBeTruthy();
  });

  it('renders nothing at zero', () => {
    const { container } = render(<SavedCount count={0} />);
    expect(container.innerHTML).toBe('');
  });

  it('ignores a non-finite count rather than printing NaN', () => {
    const { container } = render(<SavedCount count={Number.NaN} />);
    expect(container.innerHTML).toBe('');
  });
});
