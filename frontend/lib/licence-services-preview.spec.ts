import { afterEach, describe, expect, it } from 'vitest';
import {
  PACK_SCREEN_SHIPPED,
  canOpenPackScreen,
  clearPreviewOptIn,
  readPreviewOptIn,
} from './licence-services-preview';

// ────────────────────────────────────────────────────────────────────
// THE PREVIEW DOOR INTO AN UNFINISHED SCREEN.
//
// This decides whether somebody lands on a pack screen that cannot yet answer
// three areas of their application, or on the wizard that can. Getting it
// wrong in the permissive direction shows every member a half-built form;
// getting it wrong in the other direction means the operator cannot look at
// what was built for them.
//
// ⚠️ IT IS NOT A SECURITY CONTROL AND MUST NEVER BECOME ONE. The route is
// member-only at the middleware, and every read behind it is ownership-scoped
// server-side. This chooses a UI, never an audience.
// ────────────────────────────────────────────────────────────────────

function withSession(impl: Partial<Storage> | null) {
  const original = globalThis.sessionStorage;
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: impl as Storage,
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: original,
      configurable: true,
      writable: true,
    });
  };
}

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as Partial<Storage>;
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

describe('the build-time switch', () => {
  it('is OFF unless the env var is exactly "true"', () => {
    // The var is unset in every environment today. If this ever reads true in
    // a test run, something set it and every member is getting the unfinished
    // screen.
    expect(PACK_SCREEN_SHIPPED).toBe(false);
  });
});

describe('readPreviewOptIn', () => {
  it('is false with no opt-in and no query', () => {
    restore = withSession(memory());
    expect(readPreviewOptIn()).toBe(false);
    expect(readPreviewOptIn('')).toBe(false);
  });

  it('opts in on ?preview=1 and remembers it', () => {
    restore = withSession(memory());
    expect(readPreviewOptIn('?preview=1')).toBe(true);
    // Survives navigation within the tab — the query is gone, the opt-in is not.
    expect(readPreviewOptIn('')).toBe(true);
    expect(readPreviewOptIn()).toBe(true);
  });

  it('ignores anything that is not exactly 1', () => {
    // ⚠️ NO TRUTHINESS. "?preview=0" and "?preview=false" are people trying to
    // turn it OFF, and both are truthy strings.
    for (const q of ['?preview=0', '?preview=false', '?preview=', '?preview']) {
      restore?.();
      restore = withSession(memory());
      expect(readPreviewOptIn(q)).toBe(false);
    }
  });

  it('never throws where storage is blocked', () => {
    // Private windows and blocked site data throw on ACCESS, and the caller is
    // a page load.
    restore = withSession({
      getItem: () => {
        throw new DOMException('The operation is insecure.');
      },
      setItem: () => {
        throw new DOMException('The operation is insecure.');
      },
      removeItem: () => {},
    });
    expect(() => readPreviewOptIn('?preview=1')).not.toThrow();
    expect(readPreviewOptIn('?preview=1')).toBe(false);
  });
});

describe('clearPreviewOptIn', () => {
  it('is a real way out', () => {
    // Without this, opting in is a one-way door for the rest of the tab.
    restore = withSession(memory());
    expect(readPreviewOptIn('?preview=1')).toBe(true);
    clearPreviewOptIn();
    expect(readPreviewOptIn()).toBe(false);
  });

  it('never throws where storage is blocked', () => {
    restore = withSession({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new DOMException('nope');
      },
    });
    expect(() => clearPreviewOptIn()).not.toThrow();
  });
});

describe('canOpenPackScreen', () => {
  it('is closed by default — the wizard is what a member gets', () => {
    restore = withSession(memory());
    expect(canOpenPackScreen('')).toBe(false);
  });

  it('opens on an explicit opt-in', () => {
    restore = withSession(memory());
    expect(canOpenPackScreen('?preview=1')).toBe(true);
  });

  it('does not open on some other query string', () => {
    restore = withSession(memory());
    expect(canOpenPackScreen('?utm_source=whatsapp&ref=2')).toBe(false);
  });
});
