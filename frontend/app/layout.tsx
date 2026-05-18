import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { Nav } from '@/components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gun Galore — SA Firearms Marketplace',
  description: "South Africa's verified firearms, hunting and outdoor marketplace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en-ZA">
        <body className="antialiased">
          <Nav />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
