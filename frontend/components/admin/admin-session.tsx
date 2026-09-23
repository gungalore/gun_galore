'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  adminLogout,
  adminMe,
  adminTokens,
  type AdminIdentity,
} from '@/lib/admin-api';

interface AdminSessionValue {
  admin: AdminIdentity | null;
  /** SUPERADMIN may write; every other tier is read-only. */
  isGod: boolean;
  signOut: () => Promise<void>;
}

const AdminSessionContext = createContext<AdminSessionValue>({
  admin: null,
  isGod: false,
  signOut: async () => {},
});

export function useAdminSession(): AdminSessionValue {
  return useContext(AdminSessionContext);
}

/**
 * THE SESSION GATE, AND IT IS ACTUALLY CALLED.
 *
 * ⚠️ THE OLD DESK SHIPPED `requireDeskToken()` EXPORTED AND CALLED BY NOBODY,
 * and the result was a stranger seeing the operator's chrome, the board names
 * and a screenful of 401s. This component mounts in the protected layout, so
 * every route under it is gated by construction rather than by each page
 * remembering to ask.
 *
 * A missing token bounces immediately (no request); a stale one is tried
 * against /admin/auth/me, whose 401 the api client already rotates once.
 */
export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [admin, setAdmin] = useState<AdminIdentity | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function verify() {
      if (!adminTokens.access() && !adminTokens.refresh()) {
        router.replace(
          `/admin/login?next=${encodeURIComponent(pathname ?? '/admin/warden')}`,
        );
        return;
      }
      try {
        const me = await adminMe();
        if (!cancelled) {
          setAdmin(me);
          setChecked(true);
        }
      } catch {
        adminTokens.clear();
        if (!cancelled) {
          router.replace(
            `/admin/login?next=${encodeURIComponent(pathname ?? '/admin/warden')}`,
          );
        }
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [pathname, router]);

  const signOut = useCallback(async () => {
    await adminLogout();
    router.replace('/admin/login');
  }, [router]);

  const value = useMemo<AdminSessionValue>(
    () => ({
      admin,
      isGod: admin?.role === 'SUPERADMIN',
      signOut,
    }),
    [admin, signOut],
  );

  if (!checked) {
    return <AdminBootScreen />;
  }

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

/** Shown while /admin/auth/me is in flight — never a blank white page. */
function AdminBootScreen() {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <div className="adm-dot" style={{ width: 10, height: 10 }} />
      <p
        style={{
          fontFamily: 'var(--adm-mono)',
          fontSize: 12,
          color: 'var(--adm-ink-2)',
          letterSpacing: '0.1em',
        }}
      >
        ESTABLISHING SECURE SESSION…
      </p>
    </div>
  );
}
