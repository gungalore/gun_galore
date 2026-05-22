// Custom sign-up form — VISUAL MOCK for now. We'll wire it to Clerk after
// you've signed off on the look.
//
// Field map → Clerk field (eventual):
//   firstName     → Clerk firstName
//   lastName      → Clerk lastName
//   username      → Clerk username (also stored as unique User.username locally)
//   email         → Clerk emailAddress
//   phone         → Clerk phoneNumber
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
