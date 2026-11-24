// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionBox } from './action-box';

describe('ActionBox', () => {
  it('renders a static surface with a heading, description and one explicit action', () => {
    const { container } = render(
      <ActionBox
        title="Marketplace"
        description="Fixed prices."
        meta="3 live listings"
        action={<a href="/buy">Shop Marketplace</a>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Marketplace' })).toBeTruthy();
    expect(screen.getByText('Fixed prices.')).toBeTruthy();
    expect(screen.getByText('3 live listings')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Shop Marketplace' })).toBeTruthy();
    // The box itself is not an actionable surface.
    const box = container.firstElementChild as HTMLElement;
    expect(box.tagName).toBe('DIV');
    expect(box.getAttribute('role')).toBeNull();
    expect(box.getAttribute('tabindex')).toBeNull();
  });
});
