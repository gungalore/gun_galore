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
  title: 'Create your account — Gun Galore',
};

export default function SignUpPage() {
  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{
        background:
          'linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-page) 50%, var(--bg-deep) 100%)',
      }}
    >
      <SignUpForm />
    </main>
  );
}
