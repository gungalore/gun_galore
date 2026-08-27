// Custom sign-up form — PRODUCTION, fully wired to Clerk (see sign-up-form.tsx:
// signUp.create → email-code verification → setActive). Consent is recorded via
// POST /users/me/consent (flushed by <ConsentSync/>).
//
// Field map → Clerk field:
//   firstName     → Clerk firstName
//   lastName      → Clerk lastName
//   username      → Clerk username (also stored as unique User.username locally)
//   email         → Clerk emailAddress
//   phone         → unsafeMetadata.phone (→ our webhook → User.phone; unverified)
//   password      → Clerk password
//
// Delivery address is captured at first checkout (both seller + buyer give it,
// so it can be passed to Pudo/TCG for the waybill).
import SignUpForm from './sign-up-form';

export const metadata = {
  title: 'Create your account — All Outdoor',
};

export default function SignUpPage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-12"
      // Plain page ground, like every other surface. This carried a vertical
      // gradient between --bg-deep and --bg; harmless on its own, but the rule
      // is one background for the whole site (operator, 2026-08-27) and a
      // gradient is still a background. The ground comes from <html> now.
      style={{ background: 'var(--bg)' }}
    >
      <SignUpForm />
    </main>
  );
}
