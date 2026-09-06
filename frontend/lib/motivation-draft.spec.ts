import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_KEY,
  clearDraft,
  readDraft,
  readFlag,
  readReview,
  writeDraft,
  writeFlag,
  writeReview,
} from './motivation-draft';

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

// ────────────────────────────────────────────────────────────────────
// THE REVIEW QUEUES.
//
// "What we filed each document as" and "what we read that disagrees with what
// you typed" are both questions only the member can settle, and both used to
// live in component state — so a refresh threw the questions away while
// leaving the consequences (a required-documents line ticked by a document
// filed as something it is not) in place.
// ────────────────────────────────────────────────────────────────────

describe('the review queues', () => {
  it('survives a reload, per application', () => {
    const store = memory();
    restore = withStorage(store);
    writeReview('m1', {
      filed: [{ id: 'u1', name: 'scan.jpg', kind: 'ID_DOCUMENT', confident: false }],
      suggestions: [
        { key: 'id_number', value: '8001015009087', label: 'ID number', from: 'your ID' },
      ],
    });
    writeReview('m2', { filed: [], suggestions: [] });

    expect(readReview('m1').filed).toEqual([
      { id: 'u1', name: 'scan.jpg', kind: 'ID_DOCUMENT', confident: false },
    ]);
    expect(readReview('m1').suggestions[0].key).toBe('id_number');
    expect(readReview('m2').filed).toEqual([]);
  });

  it('is not wiped by the next keystroke', () => {
    // ⚠️ THE WHOLE POINT. writeDraft fires on every character typed; a blind
    // overwrite would drop a batch of documents awaiting review on the first
    // one — the Document Centre's wholesale-replace bug, in a second costume.
    const store = memory();
    restore = withStorage(store);
    writeReview('m1', {
      filed: [{ id: 'u1', name: 'a.jpg', kind: 'SAFE_PHOTO', confident: true }],
    });
    writeDraft('m1', { full_name: 'A' });
    writeDraft('m1', { full_name: 'Ab' });
    expect(readReview('m1').filed).toHaveLength(1);
    expect(readDraft('m1')).toEqual({ full_name: 'Ab' });
  });

  it('keeps the answers when the queues are rewritten', () => {
    const store = memory();
    restore = withStorage(store);
    writeDraft('m1', { full_name: 'Abel' });
    writeReview('m1', { filed: [] });
    expect(readDraft('m1')).toEqual({ full_name: 'Abel' });
  });

  it('reads a legacy flat draft as answers', () => {
    // Written by the version before the record had a shape. A member mid
    // sentence across the deploy keeps their sentence.
    const store = memory();
    restore = withStorage(store);
    store.store.set(DRAFT_KEY('m1'), JSON.stringify({ full_name: 'Abel' }));
    expect(readDraft('m1')).toEqual({ full_name: 'Abel' });
    expect(readReview('m1')).toEqual({ filed: [], suggestions: [] });
  });

  it('drops rows that are not shaped like rows', () => {
    const store = memory();
    restore = withStorage(store);
    store.store.set(
      DRAFT_KEY('m1'),
      JSON.stringify({
        answers: { a: 'b' },
        filed: [null, 7, { id: 'u1', kind: 'ID_DOCUMENT' }, { name: 'no id' }],
        suggestions: 'not an array',
      }),
    );
    const r = readReview('m1');
    // ⚠️ AN ABSENT `confident` MEANS NOT SURE. Defaulting the other way would
    // restore a row as confirmed that nobody ever confirmed.
    expect(r.filed).toEqual([
      { id: 'u1', kind: 'ID_DOCUMENT', name: '', confident: false },
    ]);
    expect(r.suggestions).toEqual([]);
  });

  it('never throws when storage is unavailable', () => {
    restore = withStorage({
      getItem: () => {
        throw new DOMException('The operation is insecure.');
      },
      setItem: () => {
        throw new DOMException('QuotaExceededError');
      },
      removeItem: () => {},
    });
    expect(() => readReview('m1')).not.toThrow();
    expect(readReview('m1')).toEqual({ filed: [], suggestions: [] });
    expect(() => writeReview('m1', { filed: [] })).not.toThrow();
  });
});

describe('one-shot flags', () => {
  it('remembers an acknowledgement across a reload, per application', () => {
    // ⚠️ THE SELLER CARD IS THE CASE. Adoption was component state, so a
    // reload re-offered "use these details" to somebody who had used them —
    // an invitation to overwrite their own corrections with the same card.
    const store = memory();
    restore = withStorage(store);
    expect(readFlag('m1', 'sellerCardAdopted')).toBe(false);
    writeFlag('m1', 'sellerCardAdopted');
    expect(readFlag('m1', 'sellerCardAdopted')).toBe(true);
    expect(readFlag('m2', 'sellerCardAdopted')).toBe(false);
  });

  it('survives the answers and the review queues being rewritten', () => {
    const store = memory();
    restore = withStorage(store);
    writeFlag('m1', 'sellerCardAdopted');
    writeDraft('m1', { full_name: 'Abel' });
    writeReview('m1', { filed: [] });
    expect(readFlag('m1', 'sellerCardAdopted')).toBe(true);
    expect(readDraft('m1')).toEqual({ full_name: 'Abel' });
  });

  it('never throws when storage is unavailable', () => {
    restore = withStorage({
      getItem: () => {
        throw new DOMException('The operation is insecure.');
      },
      setItem: () => {},
      removeItem: () => {},
    });
    expect(() => writeFlag('m1', 'x')).not.toThrow();
    expect(readFlag('m1', 'x')).toBe(false);
  });
});
