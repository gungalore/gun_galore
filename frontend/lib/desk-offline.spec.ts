/**
 * THE ONLY PLACE THE SERVICE WORKER'S FALLBACK RULES CAN BE TESTED.
 *
 * vitest's include is ['lib/**\/*.spec.ts', 'components/**\/*.spec.tsx'] —
 * nothing under app/ is collected at all, so a rule written inline in
 * app/sw.ts is a rule no suite can ever fail on. That is why app/sw.ts is a
 * thin adapter over lib/desk-offline.ts and why this file exists.
 *
 * ⚠️ WHAT THIS SUITE CANNOT DO. It pins the DECISION — which document answers
 * which failed request, and what stamp the precache entry carries. It cannot
 * prove serwist then serves it: that needs an installed service worker, a real
 * precache and a browser with the network off. The Health board's "Offline
 * stand-in" row is the check that runs where this one cannot.
 */
import { describe, expect, it } from 'vitest';
import {
  DESK_OFFLINE_URL,
  LAST_GOOD_READ_CSS_VAR,
  SHOP_OFFLINE_URL,
  deskOfflineFallbackApplies,
  deskOfflineInlineScript,
  deskOfflinePrecacheEntry,
  deskStandInInstallFailureIsTolerated,
  isAdminPath,
  isDeskStandInUrl,
  lastGoodReadCssValue,
  precacheBuildId,
  shopOfflineFallbackApplies,
} from './desk-offline';
import { LAST_GOOD_READ_KEY } from './desk-offline-device';

/** The shape @serwist/next injects, trimmed to what the code reads. */
const MANIFEST = [
  { url: '/_next/static/chunks/1397-c448d720d33cf9dc.js', revision: null },
  { url: '/_next/static/RgLPD2v8Vs-yP2mGBb0ai/_buildManifest.js', revision: 'e191fba4' },
  { url: '/icon-desk-192.png', revision: 'cc40ec8f' },
];

describe('which stand-in answers a failed navigation', () => {
  it('sends every Desk surface to the Desk document', () => {
    for (const path of [
      '/admin',
      '/admin/desk',
      '/admin/desk/ledger',
      '/admin/desk/health',
      // 🚨 THE BOUNCE TARGET. RequireDeskSession replaces() to /admin/login
      // when the refresh is unreachable, and that route is network-only — so
      // without this covered, an offline reload of any board ended on the
      // browser's error page by way of a door that cannot open.
      '/admin/login',
      '/admin/offline',
    ]) {
      expect(deskOfflineFallbackApplies('document', path), path).toBe(true);
      expect(shopOfflineFallbackApplies('document', path), path).toBe(false);
    }
  });

  it('leaves the shop to the shop', () => {
    for (const path of ['/', '/listings/abc', '/documents', '/bench']) {
      expect(shopOfflineFallbackApplies('document', path), path).toBe(true);
      expect(deskOfflineFallbackApplies('document', path), path).toBe(false);
    }
  });

  it('gives the token, money, identity and auth paths neither', () => {
    // Not an oversight and not a gap: a stand-in page invites a retry against
    // a single-use token, and one over a sign-in form is a form somebody fills
    // in while the API is unreachable.
    for (const path of [
      '/a/abc123',
      '/checkout',
      '/preview/xyz',
      '/kyc',
      '/sign-in',
      '/sign-up',
      '/verify-email',
      '/forgot-password',
      '/reset-password',
    ]) {
      expect(shopOfflineFallbackApplies('document', path), path).toBe(false);
      expect(deskOfflineFallbackApplies('document', path), path).toBe(false);
    }
  });

  it('answers nothing that is not a document', () => {
    // ⚠️ A FALLBACK PLUGIN IS ATTACHED TO EVERY RUNTIME STRATEGY, not only the
    // navigation one — serwist pushes it onto each handler in runtimeCaching.
    // Without the destination test a failed /admin image would be answered
    // with a page of HTML.
    for (const destination of ['image', 'script', 'style', 'font', '']) {
      expect(deskOfflineFallbackApplies(destination, '/admin/desk')).toBe(false);
      expect(shopOfflineFallbackApplies(destination, '/')).toBe(false);
    }
  });

  it('is a partition — no document can be offered both pages', () => {
    for (const path of ['/', '/admin', '/admin/desk', '/admin-anything', '/listings']) {
      const both =
        deskOfflineFallbackApplies('document', path) &&
        shopOfflineFallbackApplies('document', path);
      expect(both, path).toBe(false);
    }
  });

  it('defines "admin" once, by the same bare prefix the NetworkOnly rule uses', () => {
    // The stricter form (=== '/admin' || startsWith('/admin/')) would leave
    // /admin-anything network-only with no stand-in at all.
    expect(isAdminPath('/admin-anything')).toBe(true);
    expect(deskOfflineFallbackApplies('document', '/admin-anything')).toBe(true);
    expect(shopOfflineFallbackApplies('document', '/admin-anything')).toBe(false);
  });

  it('names the two documents it routes to', () => {
    expect(DESK_OFFLINE_URL).toBe('/admin/offline');
    expect(SHOP_OFFLINE_URL).toBe('/offline');
  });
});

describe('the precache stamp', () => {
  it('reads the build id off the injected manifest', () => {
    expect(precacheBuildId(MANIFEST)).toBe('RgLPD2v8Vs-yP2mGBb0ai');
    expect(deskOfflinePrecacheEntry(MANIFEST)).toEqual({
      url: '/admin/offline',
      revision: 'RgLPD2v8Vs-yP2mGBb0ai',
    });
  });

  it('tolerates bare-string entries beside object ones', () => {
    expect(precacheBuildId(['/logo.svg', ...MANIFEST])).toBe('RgLPD2v8Vs-yP2mGBb0ai');
  });

  it('refuses to invent a stamp, and drops the entry instead', () => {
    // 🚨 A CONSTANT REVISION IS THE BUG WITH THE LONG FUSE. Serwist keys a
    // precached entry by url + revision, so one that never changes is never
    // re-fetched — the stand-in would serve the HTML of whichever build first
    // installed it, pointing at chunk filenames deleted two deploys ago, and
    // only while the operator is already offline. Dropping the entry costs the
    // page; inventing a stamp costs the page AND hides that it is broken.
    expect(precacheBuildId([{ url: '/icon-192.png', revision: 'abc' }])).toBe(null);
    expect(precacheBuildId([])).toBe(null);
    expect(precacheBuildId(undefined)).toBe(null);
    expect(deskOfflinePrecacheEntry(undefined)).toBe(null);
  });

  it('does not mistake another manifest-shaped path for the build id', () => {
    expect(precacheBuildId([{ url: '/_next/static/chunks/_buildManifest.js' }])).toBe(null);
    expect(precacheBuildId([{ url: '/_buildManifest.js' }])).toBe(null);
  });
});

describe('what a failed precache fetch is allowed to cost', () => {
  /**
   * 🚨 THE RULE THIS SUITE EXISTS FOR. A precache install is all-or-nothing —
   * serwist's PrecacheStrategy throws on any status >= 400 and rethrows a
   * network failure, and `Serwist.handleInstall` awaits every entry inside
   * `event.waitUntil` — so one url that answers non-200 costs EVERY visitor
   * their service worker. `/admin/offline` is the only entry in the manifest
   * that is a rendered ROUTE — every other one is a file on disk, under
   * /_next/static/ or globbed out of public/ — and it sits under a path an
   * edge rule can be pointed at. The rescue in app/sw.ts narrows that
   * to one url and one event; these are the two halves of the narrowing.
   */
  it('tolerates the stand-in failing during install', () => {
    for (const url of [
      'https://alloutdoor.co.za/admin/offline',
      '/admin/offline',
      'https://alloutdoor.co.za/admin/offline?__WB_REVISION__=abc',
    ]) {
      expect(deskStandInInstallFailureIsTolerated('install', url), url).toBe(true);
    }
  });

  it('lets every other precache entry sink the install, which is the point', () => {
    // A rescue that matched any url would let a missing JS chunk install
    // silently, and a precache holding three quarters of a build is worse than
    // no precache at all.
    for (const url of [
      'https://alloutdoor.co.za/_next/static/chunks/1397-c448d720d33cf9dc.js',
      'https://alloutdoor.co.za/_next/static/RgLPD2v8Vs-yP2mGBb0ai/_buildManifest.js',
      'https://alloutdoor.co.za/icon-desk-192.png',
      // ⚠️ NEIGHBOURS OF THE STAND-IN, NOT THE STAND-IN. The precache rescue is
      // the one place in this file that may not use isAdminPath: a prefix test
      // here would hand the licence-to-fail-silently to any admin url that ever
      // entered the manifest.
      'https://alloutdoor.co.za/admin/desk',
      'https://alloutdoor.co.za/admin/offline/extra',
      'https://alloutdoor.co.za/admin/offlinex',
    ]) {
      expect(deskStandInInstallFailureIsTolerated('install', url), url).toBe(false);
    }
  });

  it('tolerates nothing outside install', () => {
    // The same strategy answers a precache MISS on a real navigation
    // (`_handleFetch`). Rescuing there would answer a document request with a
    // body-less 204 — a blank page where the browser's error page belongs,
    // which is worse than what this feature replaced.
    for (const type of ['fetch', 'activate', 'message', undefined]) {
      expect(
        deskStandInInstallFailureIsTolerated(type, 'https://alloutdoor.co.za/admin/offline'),
        String(type),
      ).toBe(false);
    }
  });

  it('says no to a url it cannot parse rather than throwing', () => {
    expect(isDeskStandInUrl('http://[')).toBe(false);
  });
});

/**
 * ⚠️ THE REAL KEY, IMPORTED RATHER THAN RETYPED. The script is parameterised,
 * so a literal here would pass forever while the page and the Health board
 * drifted onto a different key and the row went permanently blank — the exact
 * failure shape this suite exists to catch.
 */
const LAST_GOOD_READ_TEST_KEY = LAST_GOOD_READ_KEY;

/**
 * The stand-in page's inline script, executed.
 *
 * 🚨 THIS IS THE ONLY PLACE IT CAN BE RUN AT ALL. Nothing under app/ is
 * collected by vitest, so while the source lived inline in
 * app/admin/offline/page.tsx it was several lines of browser code with no suite
 * behind it — which is how it shipped writing `textContent` into an element
 * react then hydrated, putting the em dash back every time.
 *
 * The fakes are deliberately hostile: `getElementById` counts its calls, so a
 * reintroduced DOM write fails here even though the script's own try/catch
 * would swallow the throw it would otherwise raise.
 */
function runOfflineScript(stored: string | null | 'blocked') {
  const setProperties: Record<string, string> = {};
  const listeners: Record<string, Array<() => void>> = {};
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const replaced: string[] = [];
  let getElementByIdCalls = 0;

  const documentFake = {
    documentElement: {
      style: {
        setProperty(name: string, value: string) {
          setProperties[name] = value;
        },
      },
    },
    getElementById() {
      getElementByIdCalls += 1;
      return null;
    },
  };

  const windowFake: Record<string, unknown> = {
    addEventListener(type: string, fn: () => void) {
      (listeners[type] ??= []).push(fn);
    },
    setTimeout(fn: () => void, ms: number) {
      timers.push({ fn, ms });
      return 0;
    },
    location: {
      replace(url: string) {
        replaced.push(url);
      },
    },
  };
  if (stored === 'blocked') {
    // ⚠️ READING THE PROPERTY THROWS when site data is blocked — it does not
    // return null. That is the failure the script's try wraps.
    Object.defineProperty(windowFake, 'localStorage', {
      get() {
        throw new Error('site data blocked');
      },
    });
  } else {
    windowFake.localStorage = { getItem: () => stored };
  }

  const src = deskOfflineInlineScript(LAST_GOOD_READ_TEST_KEY);
  new Function('window', 'document', src)(windowFake, documentFake);

  return { setProperties, listeners, timers, replaced, getElementByIdCalls };
}

describe('how the remembered read reaches the stand-in page', () => {
  it('sets a CSS variable and never writes into the DOM', () => {
    // 🚨 THE DEFECT THIS PINS. Writing `textContent` here is undone by
    // hydration: react compares props.children (the em dash the page renders)
    // against the replaced text node and throws a mismatch, which discards the
    // server markup for that subtree and re-renders it from the JSX. The one
    // number on the page was permanently a dash.
    const run = runOfflineScript('2026-09-03T07:14:00.000Z');
    expect(run.getElementByIdCalls).toBe(0);
    // 09:14 SAST from 07:14Z is the whole of the timezone behaviour; the
    // punctuation around it is ICU's and differs between engines, so it is
    // deliberately not pinned. ⚠️ AND THAT IS NOT HYPOTHETICAL — node 22's ICU
    // renders this en-ZA month as "Sept" with a comma after it, so a spec that
    // pinned the exact string would fail on whichever engine spells it "Sep"
    // while the page was working perfectly.
    expect(run.setProperties[LAST_GOOD_READ_CSS_VAR]).toMatch(/^"\d{1,2} Sept?,? 09:14"$/);
  });

  it('leaves the dash alone when there is nothing remembered', () => {
    expect(runOfflineScript(null).setProperties).toEqual({});
  });

  it('leaves the dash alone when what is remembered is not a date', () => {
    expect(runOfflineScript('not-a-date').setProperties).toEqual({});
  });

  it('still arms the reconnect reload when storage is blocked', () => {
    // ⚠️ THE READ AND THE LISTENER ARE IN ONE SCRIPT, so an unguarded throw on
    // the localStorage property would take the reload with it — turning a
    // missing timestamp into a page that never heals itself.
    const run = runOfflineScript('blocked');
    expect(run.setProperties).toEqual({});
    expect(run.listeners.online).toHaveLength(1);
  });

  it('reloads to /admin/desk after a settle, not to the url that failed', () => {
    // This document is served in place of whatever /admin url failed, but the
    // operator may equally have hit /admin/offline directly — reloading THAT
    // re-serves this page from the precache forever.
    const run = runOfflineScript(null);
    run.listeners.online[0]();
    expect(run.timers).toHaveLength(1);
    expect(run.timers[0].ms).toBe(400);
    run.timers[0].fn();
    expect(run.replaced).toEqual(['/admin/desk']);
  });
});

describe('the CSS-string boundary', () => {
  it('quotes a rendered timestamp, separators included', () => {
    expect(lastGoodReadCssValue('3 Sep 09:14')).toBe('"3 Sep 09:14"');
    expect(lastGoodReadCssValue('03 Sep, 09:14')).toBe('"03 Sep, 09:14"');
    // ICU emits U+00A0 and U+202F as separators on some engines; a class that
    // allowed only the ASCII space would blank the row on those and nowhere
    // else, which is the kind of gap nobody reproduces. Built from escapes
    // rather than typed, because neither is distinguishable from a space in a
    // diff or a review.
    const nbsp = String.fromCharCode(0x00a0);
    const narrow = String.fromCharCode(0x202f);
    expect(lastGoodReadCssValue(`3${nbsp}Sep${narrow}09:14`)).toBe(
      `"3${nbsp}Sep${narrow}09:14"`,
    );
  });

  it('refuses anything that could close the string', () => {
    // 🚨 localStorage IS WRITABLE BY ANY SCRIPT ON THIS ORIGIN. A value
    // carrying a quote would close the CSS string, and an invalid var()
    // substitution does not fall back — it invalidates the whole declaration,
    // so `content` takes its initial value and ::after draws nothing at all.
    // Not a wrong figure: a row with nothing in it, including the dash.
    for (const bad of ['3 Sep "09:14', 'a;color:red', '}x{', 'a\\b', 'a\nb', '']) {
      expect(lastGoodReadCssValue(bad), JSON.stringify(bad)).toBe(null);
    }
  });
});
