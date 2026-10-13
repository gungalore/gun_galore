import { BadRequestException, Injectable } from '@nestjs/common';
import { NotificationsService } from '../notifications/notifications.service';

// Member-submitted bug reports. One-way: the report is emailed to the support
// mailbox (see NotificationsService.bugReport) and nothing is stored and no
// inbox/AdminAlert row is written — operator decision 2026-10-13.
//
// The category list is deliberately small and product-shaped (Buy Now,
// Auctions, Payments, ...), not a free string, so the subject line is always
// something the operator can triage at a glance. Keep it in step with the
// frontend list in frontend/app/report-a-bug/page.tsx.
export const BUG_CATEGORIES = [
  'BUY_NOW',
  'AUCTION',
  'PAYMENT',
  'OFFERS',
  'LISTING',
  'DELIVERY',
  'ACCOUNT',
  'OTHER',
] as const;

export type BugCategory = (typeof BUG_CATEGORIES)[number];

const CATEGORY_LABELS: Record<BugCategory, string> = {
  BUY_NOW: 'Buy Now',
  AUCTION: 'Auctions',
  PAYMENT: 'Payments',
  OFFERS: 'Offers',
  LISTING: 'Selling / Listing',
  DELIVERY: 'Delivery / Shipping',
  ACCOUNT: 'Account & Login',
  OTHER: 'Other',
};

const MIN_DESCRIPTION = 10;
const MAX_DESCRIPTION = 2000;
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;

function extensionFor(mimetype: string): string {
  if (mimetype === 'image/png') return 'png';
  if (mimetype === 'image/webp') return 'webp';
  return 'jpg';
}

export interface ReportBugInput {
  userId: string;
  category?: string;
  description?: string;
  screenshot?: { buffer: Buffer; mimetype: string } | null;
}

@Injectable()
export class BugsService {
  constructor(private readonly notifications: NotificationsService) {}

  async report(input: ReportBugInput): Promise<{ received: true }> {
    const category = (input.category ?? '').trim().toUpperCase();
    if (!(BUG_CATEGORIES as readonly string[]).includes(category)) {
      throw new BadRequestException('Choose a valid category.');
    }

    const description = (input.description ?? '').trim();
    if (description.length < MIN_DESCRIPTION) {
      throw new BadRequestException(
        'Please describe the problem in a bit more detail.',
      );
    }
    if (description.length > MAX_DESCRIPTION) {
      throw new BadRequestException(
        `Keep the description under ${MAX_DESCRIPTION} characters.`,
      );
    }

    const shot = input.screenshot ?? null;
    if (shot && shot.buffer.length > MAX_SCREENSHOT_BYTES) {
      throw new BadRequestException('Screenshot is too large (max 8 MB).');
    }

    await this.notifications.bugReport({
      category: CATEGORY_LABELS[category as BugCategory],
      description,
      reporterId: input.userId,
      screenshot: shot
        ? {
            buffer: shot.buffer,
            filename: `bug-${Date.now()}.${extensionFor(shot.mimetype)}`,
          }
        : null,
    });

    return { received: true };
  }
}
