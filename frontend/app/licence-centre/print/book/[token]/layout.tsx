import type { Metadata } from 'next';

// A booking token belongs to one print order. Never let a crawler index this
// page or follow it from anywhere.
export const metadata: Metadata = {
  title: 'Print booking — ALL Outdoor',
  robots: { index: false, follow: false },
};

export default function PrintBookingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
