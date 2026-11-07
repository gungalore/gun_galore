import { Suspense } from 'react';
import { VerifyPhoneForm } from './verify-phone-form';

export const metadata = { title: 'Verify your phone number' };

/**
 * Phone verification. Unlike /verify-email this is INSIDE the app shell — the
 * member is already signed in, and the page is reached from checkout, the sell
 * form or a "verify" prompt. `/verify-phone?next=/checkout/...` comes back to
 * where they were.
 */
export default function VerifyPhonePage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Suspense fallback={null}>
        <VerifyPhoneForm />
      </Suspense>
    </main>
  );
}
