// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrowseUnavailable } from './browse-unavailable';

/**
 * ⚠️ THE ASSERTIONS THAT MATTER HERE ARE THE NEGATIVE ONES.
 *
 * The bug this component exists for was not that the failure screen looked
 * wrong — it was that there wasn't one, and a failed browse rendered the
 * EMPTY-CATALOGUE copy instead. So it is not enough to check that the new
 * wording appears; the old wording must be absent, or a future edit could
 * reintroduce the claim alongside it and every positive assertion would still
 * pass.
 */
describe('BrowseUnavailable', () => {
  it('never claims the catalogue is empty', () => {
    render(<BrowseUnavailable scopeName="Camping & Outdoor" />);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/no listings/i);
    expect(text).not.toMatch(/check back soon/i);
    expect(text).not.toMatch(/nothing here/i);
  });

  it('says the fault is ours, not an empty shelf', () => {
    render(<BrowseUnavailable scopeName="Camping & Outdoor" />);
    expect(screen.getByText(/could not load/i)).toBeTruthy();
    expect(document.body.textContent).toMatch(/not an empty shelf/i);
  });

  it('names the scope when it has one', () => {
    render(<BrowseUnavailable scopeName="Fishing" />);
    expect(document.body.textContent).toContain('the Fishing listings');
  });

  it('reads sensibly with no scope', () => {
    render(<BrowseUnavailable />);
    const text = document.body.textContent ?? '';
    expect(text).toContain('these listings');
    // No stray "the  listings" from an interpolated empty name.
    expect(text).not.toMatch(/the\s{2,}listings/);
    expect(text).not.toMatch(/undefined/);
  });

  // Marked so a crawler — and a screen reader — can tell this is a failure
  // notice rather than page content. The public browse pages are indexed, and
  // an indexed "no listings" against a full category is a commercial problem.
  it('marks itself as an alert, not as content', () => {
    const { container } = render(<BrowseUnavailable scopeName="Optics" />);
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.querySelector('[data-browse-error="true"]')).toBeTruthy();
  });

  it('tells the reader what to do', () => {
    render(<BrowseUnavailable />);
    expect(document.body.textContent).toMatch(/refresh/i);
  });
});
