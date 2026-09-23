import type { ReactNode } from 'react';
import { AdminSessionProvider } from '@/components/admin/admin-session';
import { AdminHeader, AdminTabBar } from '@/components/admin/admin-chrome';
import { AdminToastProvider } from '@/components/admin/admin-ui';

/**
 * The gated half of the admin.
 *
 * ⚠️ `(protected)` IS A ROUTE GROUP, NOT A URL SEGMENT. The pages inside it
 * keep their real paths (`/admin/warden`, `/admin/money`, …); the group exists
 * so /admin/login can sit OUTSIDE the session gate. Putting the gate in the
 * root admin layout would bounce the login page to itself.
 *
 * ⚠️ THE GATE IS A COMPONENT THAT RUNS, not an exported helper somebody has to
 * remember to call. The old Desk shipped a gate nobody called and showed a
 * stranger the operator's chrome and a screen of 401s.
 */
export default function AdminProtectedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AdminSessionProvider>
      <AdminToastProvider>
        <div className="adm-col">
          <AdminHeader />
          <main className="adm-main">{children}</main>
        </div>
        <AdminTabBar />
      </AdminToastProvider>
    </AdminSessionProvider>
  );
}
