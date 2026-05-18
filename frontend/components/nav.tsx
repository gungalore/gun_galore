'use client';

import Link from 'next/link';
import { SignInButton, UserButton, useUser } from '@clerk/nextjs';
import { useState, useRef, useEffect } from 'react';

export function Nav() {
  const { isSignedIn, isLoaded } = useUser();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  return (
    <nav
      className="sticky top-0 z-50"
      style={{
        background: 'var(--bg-deep)',
        borderBottom: '0.5px solid var(--border)',
      }}
    >
      <div className="max-w-[1280px] mx-auto px-4 h-14 flex items-center gap-6">
        {/* Logo */}
        <Link href="/" className="shrink-0 flex items-center" aria-label="Gun Galore">
          <span
            className="text-lg tracking-tight"
            style={{ color: 'var(--text-primary)', fontWeight: 500 }}
          >
            Gun<span style={{ color: 'var(--red)' }}>·</span>Galore
          </span>
        </Link>

        {/* Primary nav */}
        <div className="flex items-center gap-5 flex-1 text-sm">
          <Link
            href="/"
            style={{ color: 'var(--text-secondary)' }}
            className="hover:text-[#f5f5f5] transition-colors"
          >
            Marketplace
          </Link>
        </div>

        {/* Right side */}
        {isLoaded && (
          <div className="flex items-center gap-3">
            <Link
              href="/listings/new"
              className="text-sm px-3 py-1.5 rounded-[6px] transition-colors"
              style={{ background: 'var(--red)', color: '#fff', fontWeight: 500 }}
            >
              Sell
            </Link>

            {isSignedIn ? (
              <div className="flex items-center gap-2">
                {/* Account dropdown */}
                <div className="relative" ref={menuRef}>
                  <button
                    onClick={() => setMenuOpen((o) => !o)}
                    className="text-sm px-2.5 py-1.5 rounded-[6px]"
                    style={{ color: 'var(--text-secondary)', border: '0.5px solid var(--border)' }}
                  >
                    Account ▾
                  </button>
                  {menuOpen && (
                    <div
                      className="absolute right-0 mt-1 w-44 rounded-[8px] py-1 z-50"
                      style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)' }}
                    >
                      {[
                        { href: '/my/listings', label: 'My Listings' },
                        { href: '/my/orders', label: 'My Orders' },
                        { href: '/my/sales', label: 'My Sales' },
                        { href: '/dashboard', label: 'Dashboard' },
                        { href: '/my/kyc', label: 'Verify Identity' },
                      ].map(({ href, label }) => (
                        <Link
                          key={href}
                          href={href}
                          onClick={() => setMenuOpen(false)}
                          className="block px-3 py-2 text-sm transition-colors"
                          style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
                        >
                          {label}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
                <UserButton />
              </div>
            ) : (
              <SignInButton mode="modal">
                <button
                  className="text-sm px-3 py-1.5 rounded-[6px]"
                  style={{
                    color: 'var(--text-secondary)',
                    border: '0.5px solid var(--border)',
                  }}
                >
                  Sign in
                </button>
              </SignInButton>
            )}
          </div>
        )}
      </div>
    </nav>
  );
}
