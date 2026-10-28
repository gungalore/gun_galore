import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { serverAuth as auth } from '../../lib/auth-server';
import { PageReveal } from '@/components/page-reveal';
import { SellerQuestionsCard } from '../dashboard/seller-questions-card';

export const metadata: Metadata = { title: 'Messages' };

/**
 * The member's listing-message inbox, as buyer or seller.
 *
 * The dashboard keeps its inline card, but this route is the stable
 * destination for notifications, email CTAs and the account menu. A
 * `?inquiry=<id>` deep link opens that conversation directly (the card
 * scrolls the thread into view and loads it on mount).
 */
export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ inquiry?: string | string[] }>;
}) {
  const params = await searchParams;
  const inquiryId =
    typeof params.inquiry === 'string'
      ? params.inquiry
      : Array.isArray(params.inquiry)
        ? (params.inquiry[0] ?? null)
        : null;

  const { userId } = await auth();
  if (!userId) {
    // Keep the thread the email/push opened. A bare /messages redirect drops
    // the ?inquiry=... target and lands the member on the whole list.
    const target = inquiryId
      ? `/messages?inquiry=${encodeURIComponent(inquiryId)}#inquiries`
      : '/messages';
    redirect(`/sign-in?redirect_url=${encodeURIComponent(target)}`);
  }

  return (
    <main className="max-w-[760px] mx-auto px-4 py-6">
      <PageReveal variant="slide-up">
        <div data-reveal className="mb-5">
          <h1
            className="text-xl font-medium"
            style={{ color: 'var(--text-primary)' }}
          >
            Messages
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
            Buyer and seller conversations about listings. Replies stay on ALL
            Outdoor.
          </p>
        </div>

        <div id="inquiries" style={{ scrollMarginTop: 80 }}>
          <SellerQuestionsCard initialInquiryId={inquiryId} />
        </div>
      </PageReveal>
    </main>
  );
}
