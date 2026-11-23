// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListingFaq, type ListingFaqEntry } from './listing-faq';

const ENTRIES: ListingFaqEntry[] = [
  {
    id: 'faq-new',
    question: 'Does it come with a case?',
    answer: 'Yes, the original hard case is included.',
  },
  {
    id: 'faq-old',
    question: 'Is the barrel threaded?',
    answer: 'No, it is the standard unthreaded barrel.',
  },
];

const SELLER_REPLY = { label: 'Usually replies within 3 hours', sampleSize: 12 };

/**
 * ⚠️ THE NEGATIVE ASSERTIONS MATTER MOST.
 *
 * The product rule is that a seller cannot hide or delete an answered question
 * and that the public section carries no report/seller controls. A future edit
 * could add a "Hide" button next to an answer and every positive assertion
 * here would still pass, so the absence of those controls is asserted directly.
 */
describe('ListingFaq', () => {
  it('renders the heading, subtitle, entries and reply-time label', () => {
    render(<ListingFaq entries={ENTRIES} sellerReply={SELLER_REPLY} />);

    expect(
      screen.getByRole('heading', { name: /questions & answers/i }),
    ).toBeTruthy();
    expect(screen.getByText(/personal details removed/i)).toBeTruthy();
    expect(screen.getByText('Does it come with a case?')).toBeTruthy();
    expect(
      screen.getByText('Yes, the original hard case is included.'),
    ).toBeTruthy();
    expect(screen.getByText('Is the barrel threaded?')).toBeTruthy();
    expect(screen.getByText('Usually replies within 3 hours')).toBeTruthy();
    expect(
      screen.getByText(/based on this seller's recent replies/i),
    ).toBeTruthy();
  });

  it('renders the required empty state with the reply label', () => {
    const { container } = render(
      <ListingFaq entries={[]} sellerReply={SELLER_REPLY} />,
    );

    expect(
      screen.getByRole('heading', { name: /questions & answers/i }),
    ).toBeTruthy();
    // The badge survives an empty list: a responsive seller with no public
    // questions yet is still useful information for the buyer.
    expect(screen.getByText('Usually replies within 3 hours')).toBeTruthy();
    expect(screen.getByText(/no public questions yet/i)).toBeTruthy();
    expect(screen.getByText(/ask the seller below/i)).toBeTruthy();
    expect(container.querySelectorAll('[id^="faq-"]')).toHaveLength(0);
  });

  it('falls back to the new-seller badge when there is no reply time', () => {
    render(<ListingFaq entries={[]} sellerReply={null} />);

    expect(
      screen.getByText(/new seller — reply time not yet known/i),
    ).toBeTruthy();
    expect(screen.queryByText(/based on this seller's recent replies/i)).toBeNull();
  });

  it('does not claim a basis when the reply sample is too small', () => {
    // The backend returns this label with sampleSize 0 rather than null (see
    // backend/src/listings/seller-reply-time.ts). Rendering "Based on this
    // seller's recent replies." under it would contradict the label itself.
    render(
      <ListingFaq
        entries={ENTRIES}
        sellerReply={{
          label: 'New seller — reply time not yet known',
          sampleSize: 0,
        }}
      />,
    );

    expect(
      screen.getByText(/new seller — reply time not yet known/i),
    ).toBeTruthy();
    expect(screen.queryByText(/based on this seller's recent replies/i)).toBeNull();
  });

  it('exposes a #faq-<id> anchor per entry with the answer always visible', () => {
    const { container } = render(
      <ListingFaq entries={ENTRIES} sellerReply={SELLER_REPLY} />,
    );

    const newest = container.querySelector('#faq-faq-new');
    const older = container.querySelector('#faq-faq-old');

    expect(newest).toBeTruthy();
    expect(older).toBeTruthy();
    // No accordion: the composer's "See the full answer" anchor must land on a
    // visible answer, not a closed <details>.
    expect(container.querySelectorAll('details')).toHaveLength(0);
    expect(newest?.textContent).toContain('Does it come with a case?');
    expect(newest?.textContent).toContain(
      'Yes, the original hard case is included.',
    );
    expect(older?.textContent).toContain(
      'No, it is the standard unthreaded barrel.',
    );
    expect(container.querySelector('section#questions')).toBeTruthy();
  });

  it('renders no hide/show/report control in either state', () => {
    for (const props of [
      { entries: ENTRIES, sellerReply: SELLER_REPLY },
      { entries: [] as ListingFaqEntry[], sellerReply: SELLER_REPLY },
    ]) {
      const { container, unmount } = render(<ListingFaq {...props} />);

      expect(
        container.querySelectorAll('button, [role="button"]'),
      ).toHaveLength(0);
      // No link controls either — the only deep links into the section live
      // in the private composer, not in the public Q&A itself.
      expect(
        container.querySelectorAll('a[href], a[href^="#"]'),
      ).toHaveLength(0);

      const text = container.textContent ?? '';
      expect(text).not.toMatch(/hide|report|delete|show all/i);

      unmount();
    }
  });
});
