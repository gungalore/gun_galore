// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RegisterList } from './register-list';

/**
 * ⚠️ WHAT THIS CAN AND CANNOT PROVE.
 *
 * The bug was a LAYOUT one — three registers overflowed a 390px screen — and
 * jsdom computes no layout, so the overflow itself is verified in a browser,
 * not here. What this pins is the part jsdom can see and that a future edit
 * could quietly undo: the structural classes the media query in tokens.css
 * hangs off, and the fact that the responsive decision is made in CSS rather
 * than by a JS branch.
 *
 * If someone reintroduces `phone ? <Cards/> : <Rows/>`, these assertions go
 * red — which is the point, because a JS branch is also what makes every cold
 * load paint the desktop tree first.
 */

const rows = [
  {
    id: 'a',
    lead: 'UM000123',
    title: 'Musgrave RSA Deluxe .308',
    sub: 'buyer → seller',
    amount: 'R 28 500',
    tags: <span data-testid="tag">awaiting review</span>,
  },
  { id: 'b', lead: 'UM000124', title: 'Second row', sub: 'x → y' },
];

describe('RegisterList', () => {
  it('carries the classes the phone layout hangs off', () => {
    const { container } = render(<RegisterList rows={rows} onOpen={() => {}} />);
    expect(container.querySelectorAll('.dk-reg-row')).toHaveLength(2);
    expect(container.querySelector('.dk-reg-lead')).toBeTruthy();
    expect(container.querySelector('.dk-reg-main')).toBeTruthy();
    expect(container.querySelector('.dk-reg-trail')).toBeTruthy();
  });

  it('renders one row per entry, each a button that opens it', () => {
    const onOpen = vi.fn();
    render(<RegisterList rows={rows} onOpen={onOpen} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    buttons[1].click();
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('announces that a row opens a dialog', () => {
    // The row is a button that opens a drawer, and a screen reader should be
    // told that before it is pressed.
    render(<RegisterList rows={rows} onOpen={() => {}} />);
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-haspopup')).toBe('dialog');
    }
  });

  it('omits the trailing pieces rather than rendering empty ones', () => {
    // Row b has no amount and no tags. An empty <span> there would still take
    // its gap and push the layout around on a phone.
    const { container } = render(<RegisterList rows={rows} onOpen={() => {}} />);
    const trails = container.querySelectorAll('.dk-reg-trail');
    expect(trails[0].textContent).toContain('R 28 500');
    expect(trails[1].textContent).toBe('');
  });

  it('draws a separator on every row except the last', () => {
    const { container } = render(<RegisterList rows={rows} onOpen={() => {}} />);
    const all = container.querySelectorAll<HTMLElement>('.dk-reg-row');
    expect(all[0].style.borderBottom).not.toBe('');
    expect(all[all.length - 1].style.borderBottom).toBe('');
  });

  it('renders the empty thumb well when a listing has no image', () => {
    // Not "renders nothing": the well holds the row's left edge steady, so a
    // list of listings where some have photos does not jag in and out.
    const { container } = render(
      <RegisterList
        rows={[{ id: 'a', hasThumb: true, thumb: null, title: 'No photo' }]}
        onOpen={() => {}}
      />,
    );
    expect(container.querySelector('.dk-reg-thumb')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });

  it('uses the image when there is one, and never shows alt text', () => {
    const { container } = render(
      <RegisterList
        rows={[
          { id: 'a', hasThumb: true, thumb: 'https://cdn/x.jpg', title: 'T' },
        ]}
        onOpen={() => {}}
      />,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn/x.jpg');
    // alt="" — decorative. The title next to it already says what it is.
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('does not branch the tree on a JS breakpoint', () => {
    // The whole reason this component exists is that order-book's
    // `phone ? <OrderCards/> : <Rows/>` was never copied to its three
    // siblings. Rendering identically regardless of matchMedia is what makes
    // it correct in the first frame, on the server and on the client.
    const wide = render(<RegisterList rows={rows} onOpen={() => {}} />);
    const wideHtml = wide.container.innerHTML;
    wide.unmount();

    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: true, // pretend we are a phone
      media: q,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    const narrow = render(<RegisterList rows={rows} onOpen={() => {}} />);
    expect(narrow.container.innerHTML).toBe(wideHtml);

    window.matchMedia = original;
  });
});
