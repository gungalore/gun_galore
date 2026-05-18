import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value;
  if (!token) redirect('/admin/login');

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-page)' }}>
      {/* Sidebar */}
      <aside
        className="w-52 shrink-0 flex flex-col py-6 px-3"
        style={{ background: 'var(--bg-card)', borderRight: '0.5px solid var(--border)' }}
      >
        <div className="px-2 mb-6">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--red)' }}>
            Admin Panel
          </span>
        </div>
        <nav className="flex flex-col gap-1 text-sm">
          {[
            { href: '/admin', label: 'Overview' },
            { href: '/admin/listings', label: 'Listings' },
            { href: '/admin/users', label: 'Users' },
            { href: '/admin/transactions', label: 'Transactions' },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className="px-2 py-1.5 rounded-[6px] transition-colors"
              style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto">
          <Link
            href="/admin/logout"
            className="px-2 py-1.5 text-sm block rounded-[6px]"
            style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}
          >
            Log out
          </Link>
        </div>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0 p-6">{children}</main>
    </div>
  );
}
