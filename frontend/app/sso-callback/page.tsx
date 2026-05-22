// Catches the redirect from Clerk after Google (or any other OAuth) flow.
// AuthenticateWithRedirectCallback handles session activation and re-routes
// the user to `signInForceRedirectUrl` / `signUpForceRedirectUrl` or the
// `redirectUrlComplete` you passed when starting the flow.
'use client';

import { AuthenticateWithRedirectCallback } from '@clerk/nextjs';

export default function SsoCallbackPage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'var(--bg-deep)' }}
    >
      <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
        Finishing sign-in…
      </div>
      <AuthenticateWithRedirectCallback />
    </main>
  );
}
