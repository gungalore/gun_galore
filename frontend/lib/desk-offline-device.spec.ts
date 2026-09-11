/**
 * The browser half of Phase 9, tested without a browser.
 *
 * ⚠️ NODE ENVIRONMENT, ON PURPOSE — no `// @vitest-environment jsdom` line.
 * Every function here is written to survive the absence of the API it wants,
 * which is the behaviour worth pinning: a private window, an embedded webview
 * or a browser set to block site data does not return null from
 * `localStorage`, it THROWS on the property access. Running the suite in a
 * runtime that genuinely has none of these is the cheapest way to prove the
 * guards are real rather than decorative.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAST_GOOD_READ_KEY,
  deskInstallOffer,
  deskOfflineDocumentCached,
  documentNavigationUrl,
  promptBelongsToDesk,
  readLastGoodRead,
  rememberLastGoodRead,
} from './desk-offline-device';

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  // ⚠️ `delete` FOR THE TWO NODE DOES NOT HAVE, `vi.stubGlobal` FOR THE ONE IT
  // DOES. `performance` is a real global here, and deleting a global the
  // runtime owns is how a suite leaks a broken environment into the file that
  // runs after it.
  delete g.localStorage;
  delete g.caches;
  vi.unstubAllGlobals();
});

describe('the remembered last good read', () => {
  it('survives the reload that destroys the page’s own state', () => {
    const store = new Map<string, string>();
    g.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    rememberLastGoodRead('2026-09-11T07:14:00.000Z');
    expect(store.get(LAST_GOOD_READ_KEY)).toBe('2026-09-11T07:14:00.000Z');
    expect(readLastGoodRead()).toBe('2026-09-11T07:14:00.000Z');
  });

  it('returns null, not a throw, when there is no storage at all', () => {
    expect(readLastGoodRead()).toBe(null);
    expect(() => rememberLastGoodRead('2026-09-11T07:14:00.000Z')).not.toThrow();
  });

  it('returns null, not a throw, when the ACCESS itself throws', () => {
    // 🚨 THIS IS THE CASE A `?? null` WOULD NOT COVER. With site data blocked
    // the property getter raises rather than answering — and this value is
    // read inside an effect on the Health board, so an uncaught throw blanks
    // the card that was supposed to explain what was wrong.
    Object.defineProperty(g, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('access denied');
      },
    });
    expect(readLastGoodRead()).toBe(null);
    expect(() => rememberLastGoodRead('2026-09-11T07:14:00.000Z')).not.toThrow();
  });

  it('treats an empty string as nothing remembered', () => {
    g.localStorage = { getItem: () => '', setItem: () => {} };
    expect(readLastGoodRead()).toBe(null);
  });
});

describe('whose install offer the captured event is', () => {
  it('accepts an event captured on a Desk document', () => {
    expect(promptBelongsToDesk('https://alloutdoor.co.za/admin/desk')).toBe(true);
    expect(promptBelongsToDesk('https://alloutdoor.co.za/admin/desk/health')).toBe(true);
    expect(promptBelongsToDesk('https://alloutdoor.co.za/admin/login')).toBe(true);
  });

  it('refuses one captured on the shop', () => {
    // 🚨 THE BUG desk-manifest.ts EXISTS TO FIX, WEARING A BUTTON. The event
    // carries whichever app the browser resolved from the manifest linked when
    // it fired; a client-side navigation from the storefront into /admin does
    // not reload the document and does not re-fire it. Firing it from the
    // Health board would put the SHOP on the operator's home screen.
    expect(promptBelongsToDesk('https://alloutdoor.co.za/')).toBe(false);
    expect(promptBelongsToDesk('https://alloutdoor.co.za/listings/123')).toBe(false);
  });

  it('is conservative about anything it cannot read', () => {
    expect(promptBelongsToDesk(null)).toBe(false);
    expect(promptBelongsToDesk(undefined)).toBe(false);
    expect(promptBelongsToDesk('')).toBe(false);
  });

  it('reads the document URL out of the navigation entry, and null if it cannot', () => {
    vi.stubGlobal('performance', {
      getEntriesByType: () => [{ name: 'https://alloutdoor.co.za/admin/desk' }],
    });
    expect(documentNavigationUrl()).toBe('https://alloutdoor.co.za/admin/desk');
    vi.stubGlobal('performance', { getEntriesByType: () => [] });
    expect(documentNavigationUrl()).toBe(null);
    vi.stubGlobal('performance', undefined);
    expect(documentNavigationUrl()).toBe(null);
  });
});

describe('what the Install row may offer', () => {
  const base = {
    isInstalled: false,
    canInstall: false,
    isIosSafari: false,
    isIosNonSafari: false,
    promptBelongsToDesk: false,
  };

  it('offers nothing once it is installed', () => {
    expect(deskInstallOffer({ ...base, isInstalled: true, canInstall: true })).toBe('installed');
  });

  it('offers a real button only when the captured event is the Desk’s', () => {
    expect(deskInstallOffer({ ...base, canInstall: true, promptBelongsToDesk: true })).toBe('prompt');
    expect(deskInstallOffer({ ...base, canInstall: true, promptBelongsToDesk: false })).toBe('menu');
  });

  it('never offers a button on iOS, where the event does not exist', () => {
    // A button that cannot work is worse than an instruction: the operator
    // taps it, nothing happens, and they stop believing the row.
    expect(
      deskInstallOffer({ ...base, isIosSafari: true, canInstall: true, promptBelongsToDesk: true }),
    ).toBe('ios-safari');
    expect(
      deskInstallOffer({ ...base, isIosNonSafari: true, canInstall: true, promptBelongsToDesk: true }),
    ).toBe('ios-other');
  });

  it('separates iOS Safari from every other iOS browser', () => {
    // Chrome, Firefox, Edge and in-app webviews on iOS cannot install a PWA at
    // all. "Tap Share" is the wrong instruction there, not a shorter one.
    expect(deskInstallOffer({ ...base, isIosSafari: true })).toBe('ios-safari');
    expect(deskInstallOffer({ ...base, isIosNonSafari: true })).toBe('ios-other');
  });

  it('falls back to the browser’s own menu when nothing else is true', () => {
    expect(deskInstallOffer(base)).toBe('menu');
  });
});

describe('whether the stand-in document is actually stored', () => {
  it('looks past the revision query string serwist keys entries by', async () => {
    // ⚠️ LOAD-BEARING, NOT TIDINESS. A precache entry is keyed
    // `<url>?__WB_REVISION__=<revision>`, so a plain match on the bare URL
    // misses on a perfectly good install and the row would report a missing
    // page every time — a check that cries wolf is a check somebody deletes.
    const seen: Array<{ url: string; opts: unknown }> = [];
    g.caches = {
      match: (url: string, opts: unknown) => {
        seen.push({ url, opts });
        return Promise.resolve(opts && (opts as { ignoreSearch?: boolean }).ignoreSearch
          ? new Response('')
          : undefined);
      },
    };
    expect(await deskOfflineDocumentCached('/admin/offline')).toBe(true);
    expect(seen[0]).toEqual({ url: '/admin/offline', opts: { ignoreSearch: true } });
  });

  it('says false when the document is genuinely absent', async () => {
    g.caches = { match: () => Promise.resolve(undefined) };
    expect(await deskOfflineDocumentCached('/admin/offline')).toBe(false);
  });

  it('says null — a different answer from false — when there is no cache to look in', async () => {
    expect(await deskOfflineDocumentCached('/admin/offline')).toBe(null);
    g.caches = { match: () => Promise.reject(new Error('nope')) };
    expect(await deskOfflineDocumentCached('/admin/offline')).toBe(null);
  });
});
