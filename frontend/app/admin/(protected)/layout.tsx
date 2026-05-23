import Link from 'next/link';
import GlobalSearch from './global-search';
import SidebarNav from './sidebar-nav';

// Auth gate removed — moved to client-side localStorage check inside
// each admin page (see lib/admin-auth.requireAdminToken). The layout
// just renders chrome unconditionally; pages bounce themselves to
// /admin/login if the token is missing.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
        {/* Active-route highlighting requires usePathname so the nav
            list lives in a client component. */}
        <SidebarNav />
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

      {/* Content — header strip with global search, then page content */}
      <main className="flex-1 min-w-0">
        <header
          className="px-6 py-3 sticky top-0 z-40"
          style={{
            background: 'var(--bg-page)',
            borderBottom: '0.5px solid var(--border)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="max-w-2xl">
            <GlobalSearch />
          </div>
        </header>
        <div className="p-6">{children}</div>
      </main>
    </div>
  );
}
