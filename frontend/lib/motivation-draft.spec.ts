import { afterEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_KEY, clearDraft, readDraft, writeDraft } from './motivation-draft';

// ────────────────────────────────────────────────────────────────────
// THE UNSENT DRAFT.
//
// Whatever a member types inside the 1200ms debounce window lives ONLY here.
// Every one of these tests is about the same failure: somebody's answers
// disappearing with nothing on screen to say so.
//
// ⚠️ THE THROWING CASES ARE NOT HYPOTHETICAL. `localStorage` throws on ACCESS,
// not just on write, in a private window on some browsers and wherever site
// data is blocked — and the caller is a page load. A member whose browser
// refuses storage must see their application, not a blank error page.
// ────────────────────────────────────────────────────────────────────

/** Replace localStorage for one test, then put it back. */
function withStorage(impl: Partial<Storage>) {
  const original = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    value: impl as Storage,
    configurable: true,
    writable: true,
  });
  return () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: original,
      configurable: true,
      writable: true,
    });
  };
}

/** A working in-memory store. */
function memory() {
  const map = new Map<string, string>();
  return {
    store: map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as Partial<Storage> & { store: Map<string, string> };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  vi.restoreAllMocks();
});

describe('DRAFT_KEY', () => {
  it('is per application', () => {
    expect(DRAFT_KEY('abc')).toBe('motivation-draft:abc');
    expect(DRAFT_KEY('abc')).not.toBe(DRAFT_KEY('abd'));
  });

  it('⚠️ has not changed', () => {
    // Two screens read this key and older drafts are already sitting under it
    // in members' browsers. Changing the string orphans every one of them, and
    // nothing fails — the answers are simply gone on the next reload.
    expect(DRAFT_KEY('x')).toBe('motivation-draft:x');
  });
});

describe('readDraft', () => {
  it('round-trips what was written', () => {
    const store = memory();
    restore = withStorage(store);
    writeDraft('m1', { full_name: 'Gerhard', id_number: '900101' });
    expect(readDraft('m1')).toEqual({
      full_name: 'Gerhard',
      id_number: '900101',
    });
  });

  it('returns {} when there is no draft', () => {
    restore = withStorage(memory());
    expect(readDraft('never-saved')).toEqual({});
  });

  it('never throws when storage throws on READ', () => {
    restore = withStorage({
      getItem: () => {
        throw new DOMException('The operation is insecure.');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(() => readDraft('m1')).not.toThrow();
    expect(readDraft('m1')).toEqual({});
  });

  it('survives corrupt JSON rather than taking the page down', () => {
    const store = memory();
    restore = withStorage(store);
    store.store.set(DRAFT_KEY('m1'), '{not json');
    expect(readDraft('m1')).toEqual({});
  });

  it('ignores a draft that is not an object', () => {
    const store = memory();
    restore = withStorage(store);
    for (const junk of ['[1,2,3]', '"a string"', '42', 'null']) {
      store.store.set(DRAFT_KEY('m1'), junk);
      expect(readDraft('m1')).toEqual({});
    }
  });

  it('keeps only string values', () => {
    // ⚠️ A FIELD RENDERER EXPECTS A STRING. Something that got in by mistake
    // must not reach one and blow up the whole screen mid-application.
    const store = memory();
    restore = withStorage(store);
    store.store.set(
      DRAFT_KEY('m1'),
      JSON.stringify({ good: 'yes', n: 7, nested: { a: 1 }, nil: null }),
    );
    expect(readDraft('m1')).toEqual({ good: 'yes' });
  });
});

describe('writeDraft', () => {
  it('never throws when storage is full or unavailable', () => {
    // Quota exceeded is the common one on a long application with a lot typed.
    restore = withStorage({
      getItem: () => null,
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
      removeItem: () => {},
    });
    expect(() => writeDraft('m1', { a: 'b' })).not.toThrow();
  });
});

describe('clearDraft', () => {
  it('removes the draft', () => {
    const store = memory();
    restore = withStorage(store);
    writeDraft('m1', { a: 'b' });
    expect(readDraft('m1')).toEqual({ a: 'b' });
    clearDraft('m1');
    expect(readDraft('m1')).toEqual({});
  });

  it('clears only the application it was asked to', () => {
    const store = memory();
    restore = withStorage(store);
    writeDraft('m1', { a: 'b' });
    writeDraft('m2', { c: 'd' });
    clearDraft('m1');
    expect(readDraft('m2')).toEqual({ c: 'd' });
  });

  it('never throws when storage is unavailable', () => {
    restore = withStorage({
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {
        throw new DOMException('The operation is insecure.');
      },
    });
    expect(() => clearDraft('m1')).not.toThrow();
  });
});
