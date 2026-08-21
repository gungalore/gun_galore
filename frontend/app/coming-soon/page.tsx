import { av } from '@/lib/asset-version';
import { SUPPORT_EMAIL } from '@/lib/brand';
/**
 * Coming-soon gate page.
 *
 * Served via middleware rewrite when COMING_SOON_GATE=on and the
 * visitor has no bypass cookie + isn't hitting an always-allowed
 * route (SMS-link /a/<token> pages, API endpoints, admin, checkout
 * with ?t=<token>).
 *
 * To grant bypass to a tester: send them
 *   https://alloutdoor.co.za/preview?key=<COMING_SOON_BYPASS_SECRET>
 * That route sets a 30-day cookie and redirects them to / where the
 * real site loads from then on.
 *
 * Mobile-first single-screen design — no nav, no footer, no JS.
 */

export const metadata = {
  title: 'Coming Soon — All Outdoor',
  // Outdoor-first, same framing as the root layout and manifest. This gate
  // is the ONLY page a gated visitor (or a crawler that hits us while the
  // gate is on) ever sees, so a "marketplace for firearms" line here quietly
  // repositioned the whole site back to guns.
  description:
    "South Africa's outdoor, hunting and sport marketplace is launching soon.",
};

export default function ComingSoonPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
        background: '#0f0f0f',
        color: '#ffffff',
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif",
        textAlign: 'center',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={av('/logo-mark.svg')}
        alt="All Outdoor"
        style={{ width: 96, height: 96, marginBottom: '2rem' }}
      />
      <h1
        style={{
          fontSize: 'clamp(2rem, 7vw, 3.5rem)',
          fontWeight: 700,
          letterSpacing: '-0.02em',
          marginBottom: '1rem',
        }}
      >
        Coming Soon
      </h1>
      <p
        style={{
          fontSize: '1.0625rem',
          color: 'rgba(255,255,255,0.7)',
          maxWidth: '36ch',
          lineHeight: 1.6,
          marginBottom: '2.5rem',
        }}
      >
        South Africa&apos;s marketplace for buying and selling outdoor,
        hunting and sport gear is almost ready.
      </p>
      <div
        style={{
          paddingTop: '2rem',
          borderTop: '0.5px solid rgba(255,255,255,0.15)',
          width: 'min(100%, 24rem)',
        }}
      >
        <p
          style={{
            fontSize: '0.8125rem',
            color: 'rgba(255,255,255,0.45)',
            lineHeight: 1.5,
          }}
        >
          All Outdoor (Pty) Ltd
          <br />
          {SUPPORT_EMAIL}
        </p>
      </div>
    </main>
  );
}
