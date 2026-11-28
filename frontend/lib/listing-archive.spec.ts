import { describe, expect, it } from 'vitest';
import {
  archiveDateLabel,
  archiveImageUrl,
  archiveReason,
  archiveStatusLabel,
  canRelistFromArchive,
  isArchivedListing,
} from './listing-archive';

describe('listing archive helpers', () => {
  it('sends only removed/expired statuses to the archive', () => {
    expect(isArchivedListing({ status: 'CANCELLED' })).toBe(true);
    expect(isArchivedListing({ status: 'EXPIRED' })).toBe(true);
    expect(isArchivedListing({ status: 'active' })).toBe(false);
    expect(isArchivedListing({ status: 'SOLD' })).toBe(false);
    expect(isArchivedListing({ status: null })).toBe(false);
  });

  it('labels cancelled as Removed and expired as Expired', () => {
    expect(archiveStatusLabel('CANCELLED')).toBe('Removed');
    expect(archiveStatusLabel('EXPIRED')).toBe('Expired');
    expect(archiveStatusLabel('SOMETHING_ELSE')).toBe('Archived');
  });

  it('shows the admin reason when the listing was taken down', () => {
    expect(
      archiveReason({
        id: 'l1',
        title: 'Cleaning kit',
        price: 1,
        status: 'CANCELLED',
        listingType: 'AUCTION',
        adminOverrideReason: 'Test listing removed at operator request.',
      }),
    ).toBe('Test listing removed at operator request.');
  });

  it('falls back to honest copy without a free-text reason', () => {
    expect(
      archiveReason({
        id: 'l1',
        title: 'Old listing',
        price: 100,
        status: 'CANCELLED',
        listingType: 'BUY_NOW',
      }),
    ).toBe('You cancelled this listing.');
    expect(
      archiveReason({
        id: 'l2',
        title: 'Old listing',
        price: 100,
        status: 'EXPIRED',
        listingType: 'BUY_NOW',
      }),
    ).toContain('expired');
  });

  it('offers Relist only for expired listings', () => {
    expect(canRelistFromArchive({ status: 'EXPIRED' })).toBe(true);
    expect(canRelistFromArchive({ status: 'CANCELLED' })).toBe(false);
  });

  it('uses archived/ended/updated dates and tolerates missing media', () => {
    expect(
      archiveDateLabel({
        id: 'l1',
        title: 'T',
        price: 1,
        status: 'CANCELLED',
        listingType: 'BUY_NOW',
        archivedAt: null,
        endedAt: null,
        auctionSettledAt: null,
        updatedAt: '2026-11-27T10:00:00.000Z',
      }),
    ).toBeTruthy();
    expect(
      archiveImageUrl({
        id: 'l1',
        title: 'T',
        price: 1,
        status: 'CANCELLED',
        listingType: 'BUY_NOW',
        images: [],
      }),
    ).toBeNull();
  });
});
