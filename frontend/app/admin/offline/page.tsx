import { LAST_GOOD_READ_KEY } from '../../../lib/desk-offline-device';
import {
  LAST_GOOD_READ_CSS_VAR,
  deskOfflineInlineScript,
} from '../../../lib/desk-offline';

/**
 * THE DESK'S STAND-IN PAGE — what an operator sees when a board cannot be
 * fetched.
 *
 * 🚨 IT MUST NEVER SHOW A FIGURE, AND EVERY OTHER RULE ON THIS PAGE FOLLOWS
 * FROM THAT ONE. The reason /admin is network-only in the service worker is
 * that a cached admin page is a number somebody acts on that stopped being
 * true — a cached "0 things need you" is the worst thing this panel could
 * render, because it is indistinguishable from a quiet morning. So this
 * document carries no count, no board, no name, no member data. It says what
 * it is, when this browser last got a real read, and offers a retry.
 *
 * ⚠️ THE ONE NUMBER ON THE PAGE IS A TIMESTAMP THIS BROWSER WROTE ABOUT
 * ITSELF. It is read from localStorage by the inline script below, never
 * rendered into the HTML — the HTML is shared by everyone the precache serves
 * it to, and localStorage is not. app/admin/desk/health/this-device.tsx is
 * what writes it.
 *
 * 🚨 AND IT ARRIVES AS A CSS VARIABLE, NOT AS textContent, BECAUSE textContent
 * COULD NEVER SURVIVE. The script runs while the document is parsing; react
 * hydrates a few hundred milliseconds later, compares `props.children` (the em
 * dash this file renders) against a text node that no longer matches, and
 * throws a hydration mismatch — which discards the server markup for that
 * subtree and re-renders it from this JSX. The dash came back every time, so
 * the row was permanently a dash. A pseudo-element's content is not in the DOM
 * and has nothing for hydration to revert; see LAST_GOOD_READ_CSS_VAR in
 * lib/desk-offline.ts, and lib/use-standalone.ts for the same pre-paint shape
 * the shop already uses on <html>.
 *
 * ⚠️ ZERO DEPENDENCIES, ON PURPOSE. No fetch, no client component, no
 * next/image, no icon from the kit. A document served from the precache has
 * only what the precache already holds; the Desk's JS chunks ARE precached, so
 * the page paints instantly, but an <img> whose URL carries the asset-version
 * query string is NOT precached under that key and would draw a broken box.
 * The mark is set in type instead.
 *
 * ⚠️ static, AND STATED. A precached document has to be the same document for
 * everybody; a dynamic API anywhere in this tree would make it a per-request
 * render that the service worker then froze at whatever the first visitor got.
 */
export const dynamic = 'force-static';

/**
 * Two scripts' worth of work in one tag, because a precached page gets no
 * bundle of its own — built in lib/ so a spec can execute it.
 *
 *   1. The remembered read. Always the full "3 Sep 09:14" form, never the
 *      board's bare "09:14" for today — on this page the reader does not know
 *      how long they have been offline, which is the one context where a time
 *      with no date is a guess dressed as a fact.
 *
 *   2. Self-heal on reconnect. Same 400ms settle the shop's page uses: the
 *      `online` event fires before the interface is usably up, and an
 *      immediate reload lands on a second failure.
 *
 * ⚠️ THE SOURCE LIVES IN lib/desk-offline.ts AND NOT HERE. Nothing under app/
 * is collected by vitest, so a script written inline in this file is a script
 * no suite can run; lib/desk-offline.spec.ts executes this exact string
 * against a fake window and fails if it ever writes textContent again.
 */
const OFFLINE_SCRIPT = deskOfflineInlineScript(LAST_GOOD_READ_KEY);

/**
 * ⚠️ THE DASH IS THE FALLBACK OF A var(), WHICH IS WHY THE SCRIPT REFUSES A
 * VALUE IT CANNOT QUOTE. An invalid substitution does not fall back — it
 * invalidates the whole declaration, so `content` takes its initial value
 * `normal`, which on ::after draws no pseudo-element at all and leaves the row
 * with nothing in it. `lastGoodReadCssValue` is the same test the script
 * applies before setting the property.
 *
 * ⚠️ A <style> TAG RATHER THAN THE style ATTRIBUTE: an inline style cannot
 * carry a pseudo-element, and this page has no stylesheet of its own to put
 * the rule in — components/desk/tokens.css is the Desk's palette and is shared
 * with every board.
 */
const OFFLINE_STYLE = `#dk-last-read::after{content:var(${LAST_GOOD_READ_CSS_VAR},"—")}`;

export default function AdminOfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--dk-ground)',
        color: 'var(--dk-ink)',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <span
          className="dk-mono"
          style={{
            display: 'block',
            fontSize: 11,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'var(--dk-ink-3)',
            marginBottom: 22,
          }}
        >
          The Desk
        </span>

        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '-0.015em',
            margin: '0 0 10px',
          }}
        >
          Can&rsquo;t reach the box
        </h1>

        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--dk-ink-2)', margin: '0 0 18px' }}>
          This device has no route to the server, so there is no board to show.
        </p>

        {/* ⚠️ THE SECOND PARAGRAPH IS THE POINT OF THE PAGE, NOT FILLER. An
            operator who reaches a stand-in screen on an admin panel has to know
            whether they are looking at something old. They are not: nothing the
            Desk reads is ever cached. Saying so is what stops the next question
            being "is this yesterday's pile?". */}
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--dk-ink-2)', margin: '0 0 22px' }}>
          Nothing from the Desk is kept on this device &mdash; no cards, no
          figures, no names. This page is the only part of it that was stored,
          and it holds none of that.
        </p>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            background: 'var(--dk-surface)',
            border: '1px solid var(--dk-line)',
            borderRadius: 'var(--dk-radius-card)',
            marginBottom: 20,
          }}
        >
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink)', flex: 1 }}>Last good read</span>
          {/* ⚠️ NO CHILDREN, AND THAT IS THE FIX, NOT AN OVERSIGHT. The text
              comes from ::after so hydration has nothing to compare and
              nothing to put back; a dash typed in here would be
              `props.children` again and would win again. The dash a browser
              with no remembered read keeps is the var() fallback in
              OFFLINE_STYLE — and it is deliberately not "never": this browser
              may simply never have loaded the Health board, which is a
              different fact. */}
          <span id="dk-last-read" className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)' }} />
        </div>

        <a
          href="/admin/desk"
          style={{
            display: 'inline-block',
            padding: '11px 22px',
            borderRadius: 'var(--dk-radius-control)',
            background: 'var(--dk-ink)',
            color: 'var(--dk-ground)',
            fontSize: 13,
            fontWeight: 500,
            textDecoration: 'none',
          }}
        >
          Try again
        </a>

        <p
          style={{
            fontSize: 11.5,
            lineHeight: 1.5,
            color: 'var(--dk-ink-3)',
            margin: '22px 0 0',
          }}
        >
          The Desk reloads on its own the moment this device is back on a
          network.
        </p>
      </div>
      <style dangerouslySetInnerHTML={{ __html: OFFLINE_STYLE }} />
      <script dangerouslySetInnerHTML={{ __html: OFFLINE_SCRIPT }} />
    </main>
  );
}
