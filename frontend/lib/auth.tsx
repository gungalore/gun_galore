'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

/**
 * The viewer, shaped to match what the app already reads off Clerk's user
 * object so 79 call sites change nothing but their import line.
 *
 * ⚠️ `primaryEmailAddress` is an OBJECT, not a string, and that is not
 * ceremony — every read site is `user.primaryEmailAddress?.emailAddress`, and
 * flattening it here would mean touching all of them to save one field.
 */
export interface Viewer {
  id: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  imageUrl: string | null;
  hasImage: boolean;
  primaryEmailAddress: {
    emailAddress: string;
    verification: { status: 'verified' | 'unverified' };
  } | null;
  phone: string | null;
  phoneVerified: boolean;
  kycStatus: string;
  profileCompletedAt: string | null;
  sellerTier: string;
  createdAt: string;
  /** Always true — a self-hosted account has no other way in. */
  passwordEnabled: boolean;
  /** Always false. There is no second factor yet; see the note in Settings. */
  twoFactorEnabled: boolean;
}

interface MeResponse {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  username: string;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  phone: string | null;
  phoneVerified: boolean;
  kycStatus: string;
  profileCompletedAt: string | null;
  sellerTier: string;
  createdAt: string;
}

function toViewer(me: MeResponse): Viewer {
  return {
    id: me.id,
    username: me.username,
    firstName: me.firstName,
    lastName: me.lastName,
    imageUrl: me.avatarUrl,
    hasImage: !!me.avatarUrl,
    primaryEmailAddress: {
      emailAddress: me.email,
      verification: {
        status: me.emailVerifiedAt ? 'verified' : 'unverified',
      },
    },
    phone: me.phone,
    phoneVerified: me.phoneVerified,
    kycStatus: me.kycStatus,
    profileCompletedAt: me.profileCompletedAt,
    sellerTier: me.sellerTier,
    createdAt: me.createdAt,
    passwordEnabled: true,
    twoFactorEnabled: false,
  };
}

interface AuthState {
  user: Viewer | null;
  isLoaded: boolean;
  isSignedIn: boolean;
  getToken: () => Promise<string | null>;
  signOut: (opts?: { redirectUrl?: string } | (() => void)) => Promise<void>;
  refresh: () => Promise<void>;
  /** After a sign-in / verify response, adopt the session it returned. */
  adopt: (accessToken: string, expiresAt: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Refresh this long before the access token actually expires, so an in-flight
 * request never races the expiry.
 */
const REFRESH_MARGIN_MS = 60 * 1000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Viewer | null>(null);
  const [isLoaded, setLoaded] = useState(false);

  // ⚠️ IN MEMORY, NEVER localStorage. The refresh token lives in an httpOnly
  // cookie the page cannot read; keeping the short-lived access token in a
  // ref rather than storage means an XSS has to be present AT THE MOMENT it
  // is used rather than being able to harvest one later.
  const tokenRef = useRef<string | null>(null);
  const expiryRef = useRef<number>(0);
  // One in-flight refresh per tab. Without it, three components calling
  // getToken() on mount fire three rotations and two of them lose the race.
  const inFlight = useRef<Promise<string | null> | null>(null);

  const doRefresh = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!res.ok) {
        tokenRef.current = null;
        expiryRef.current = 0;
        return null;
      }
      const data = (await res.json()) as {
        accessToken?: string;
        expiresAt?: string;
      };
      if (!data.accessToken) return null;
      tokenRef.current = data.accessToken;
      expiryRef.current = data.expiresAt
        ? Date.parse(data.expiresAt)
        : Date.now() + 15 * 60 * 1000;
      return data.accessToken;
    } catch {
      return null;
    }
  }, []);

  const getToken = useCallback(async (): Promise<string | null> => {
    if (tokenRef.current && Date.now() < expiryRef.current - REFRESH_MARGIN_MS) {
      return tokenRef.current;
    }
    if (!inFlight.current) {
      inFlight.current = doRefresh().finally(() => {
        inFlight.current = null;
      });
    }
    return inFlight.current;
  }, [doRefresh]);

  const loadUser = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      setUser(null);
      setLoaded(true);
      return;
    }
    try {
      const res = await fetch(`${API_URL}/auth/me`, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      });
      setUser(res.ok ? toViewer((await res.json()) as MeResponse) : null);
    } catch {
      setUser(null);
    } finally {
      setLoaded(true);
    }
  }, [getToken]);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const adopt = useCallback(
    async (accessToken: string, expiresAt: string) => {
      tokenRef.current = accessToken;
      expiryRef.current = Date.parse(expiresAt);
      await loadUser();
    },
    [loadUser],
  );

  const signOut = useCallback(
    async (opts?: { redirectUrl?: string } | (() => void)) => {
      try {
        await fetch(`${API_URL}/auth/logout`, {
          method: 'POST',
          credentials: 'include',
        });
      } catch {
        // Even if the call fails, drop the local session — the access token
        // expires within fifteen minutes and staying "signed in" on screen
        // after the member asked to leave is the worse failure.
      }
      tokenRef.current = null;
      expiryRef.current = 0;
      setUser(null);
      if (typeof opts === 'function') {
        opts();
        return;
      }
      window.location.href = opts?.redirectUrl ?? '/';
    },
    [],
  );

  const value = useMemo<AuthState>(
    () => ({
      user,
      isLoaded,
      isSignedIn: !!user,
      getToken,
      signOut,
      refresh: loadUser,
      adopt,
    }),
    [user, isLoaded, getToken, signOut, loadUser, adopt],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function useAuthContext(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}

/** Drop-in for Clerk's `useAuth()`. */
export function useAuth() {
  const { getToken, isLoaded, isSignedIn, user, signOut } = useAuthContext();
  return { getToken, isLoaded, isSignedIn, userId: user?.id ?? null, signOut };
}

/** Drop-in for Clerk's `useUser()`. */
export function useUser() {
  const { user, isLoaded, isSignedIn } = useAuthContext();
  return { user, isLoaded, isSignedIn };
}

/**
 * Drop-in for Clerk's `useClerk()`.
 *
 * ⚠️ `openUserProfile` is deliberately absent, not stubbed. It opened Clerk's
 * hosted profile modal; there is nothing to open now, and a no-op function
 * would leave a button on Settings that silently does nothing. The call site
 * has to become a link to /profile/edit instead — which is why removing it
 * breaks the build rather than the page.
 */
export function useClerk() {
  const { signOut } = useAuthContext();
  return { signOut };
}

/** Everything the provider exposes, for the few places that need `adopt`. */
export function useSession() {
  return useAuthContext();
}

/**
 * Drop-in for Clerk's `<SignInButton mode="modal">`.
 *
 * There is no modal. It is a link to /sign-in carrying the current path so the
 * member comes back where they were — which is what the modal was for.
 */
export function SignInButton({
  children,
  className,
}: {
  children?: ReactNode;
  mode?: 'modal' | 'redirect';
  className?: string;
}) {
  const [href, setHref] = useState('/sign-in');
  useEffect(() => {
    // Relative-only, and read on the client so it reflects the real path.
    const here = window.location.pathname + window.location.search;
    setHref(`/sign-in?redirect_url=${encodeURIComponent(here)}`);
  }, []);
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

/** Sends the viewer to sign-in, preserving where they were. */
export function useRequireSignIn() {
  const router = useRouter();
  return useCallback(
    (path?: string) => {
      const here =
        path ?? window.location.pathname + window.location.search;
      router.push(`/sign-in?redirect_url=${encodeURIComponent(here)}`);
    },
    [router],
  );
}
