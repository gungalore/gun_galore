import { describe, expect, it } from 'vitest';
import { CredentialKind } from './licence-centre-api';
import {
  ReviewItem,
  expiryAnswer,
  mergeReviewQueue,
  needsALook,
  uncertaintyReason,
  refileNeedsPanel,
  settleableInBulk,
} from './document-review-rules';

// ────────────────────────────────────────────────────────────────────
// The rules the Document Centre's review screen files documents by.
//
// The first test is the one that matters. It pins a bug a pre-ship review
// caught, which would have confirmed a firearm licence with no expiry date and
// no way for any surface to ever ask about it again. Deleting it, or relaxing
// what it asserts, puts that back.
// ────────────────────────────────────────────────────────────────────

function doc(over: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'c1',
    kind: 'OTHER' as CredentialKind,
    title: 'A document',
    mimeType: 'image/jpeg',
    autoFiled: true,
    confident: true,
    neverExpires: false,
    issuedOnUnknown: false,
    proposed: {
      expiresOn: null,
      issuedOn: null,
      details: {},
      lowConfidence: [],
      derivedExpiry: null,
    },
    ...over,
  };
}

describe('correcting the type of a document', () => {
  it('⚠️ NEVER settles a licence misread as a photograph in one tap', () => {
    // The failure this exists for, start to finish:
    //
    // A firearm licence is misread and filed as SAFE_PHOTOGRAPHS. The server
    // pre-ticks "Never expires" for that kind, because a photograph has no
    // date, and skips the vision read entirely. The member spots it and taps
    // the type control to correct it.
    //
    // If that tap were allowed to post straight through, it would send the
    // photograph's tick under the licence's kind: confirmed, expiresOn null.
    // The reminder sweep requires confirmedAt AND expiresOn, so no renewal
    // reminder could ever fire — and because it is confirmed, no screen would
    // ask again. The member's own correction is what buries it.
    const misfiled = doc({
      kind: 'SAFE_PHOTOGRAPHS' as CredentialKind,
      neverExpires: true, // the server put this here, not the member
      confident: true, // and it was sure, which is why the tap is available
    });

    expect(refileNeedsPanel(misfiled, 'FIREARM_LICENCE' as CredentialKind)).toBe(
      true,
    );
  });

  it('⚠️ never carries a WORKED-OUT date across a change of type', () => {
    // A competency certificate prints no expiry; a statute supplies five years
    // from its issue date. That arithmetic is about the kind we guessed, so it
    // means nothing once the kind is corrected — and confirming it would put a
    // five-year expiry on, say, a club membership.
    const derived = doc({
      kind: 'COMPETENCY_CERTIFICATE' as CredentialKind,
      proposed: {
        ...doc().proposed,
        derivedExpiry: { on: '2029-04-01', why: 'five years from issue' },
      },
    });

    expect(
      refileNeedsPanel(derived, 'DEDICATED_DISCIPLINE' as CredentialKind),
    ).toBe(true);
  });

  it('DOES allow one tap when the date was read off the page', () => {
    // A date printed on the document is a fact about the document. It survives
    // being told the document is a different kind of thing, so the correction
    // needs nothing more from the member.
    const read = doc({
      kind: 'OTHER' as CredentialKind,
      proposed: { ...doc().proposed, expiresOn: '2032-11-28' },
    });

    expect(refileNeedsPanel(read, 'FIREARM_LICENCE' as CredentialKind)).toBe(
      false,
    );
  });

  it('confirming the SAME type needs no panel when there is an answer', () => {
    const photo = doc({
      kind: 'SAFE_PHOTOGRAPHS' as CredentialKind,
      neverExpires: true,
    });
    expect(refileNeedsPanel(photo, 'SAFE_PHOTOGRAPHS' as CredentialKind)).toBe(
      false,
    );
  });

  it('confirming the same type still needs the panel with no answer at all', () => {
    expect(refileNeedsPanel(doc(), 'OTHER' as CredentialKind)).toBe(true);
  });
});

describe('what the member has to look at', () => {
  it('always asks about a photograph we filed ourselves', () => {
    expect(
      needsALook(
        doc({ kind: 'SAFE_PHOTOGRAPHS' as CredentialKind, confident: true }),
      ),
    ).toBe(true);
  });

  it('does not ask about a photograph the MEMBER filed', () => {
    // They chose the box. There is no guess of ours to check.
    expect(
      needsALook(
        doc({ kind: 'SAFE_PHOTOGRAPHS' as CredentialKind, autoFiled: false }),
      ),
    ).toBe(false);
  });

  it('asks whenever we were unsure', () => {
    expect(needsALook(doc({ confident: false }))).toBe(true);
  });

  it('does not ask about a confident reading of an ordinary kind', () => {
    expect(
      needsALook(doc({ kind: 'FIREARM_LICENCE' as CredentialKind })),
    ).toBe(false);
  });
});

describe('what can be settled in bulk', () => {
  it('refuses a document with no date and no tick', () => {
    // The confirm panel disables its own button on exactly this, and the
    // server refuses it. A bulk button must not post what the panel will not.
    expect(settleableInBulk(doc())).toBe(false);
    expect(expiryAnswer(doc())).toBeNull();
  });

  it('refuses a date we worked out rather than read', () => {
    expect(
      settleableInBulk(
        doc({
          proposed: {
            ...doc().proposed,
            derivedExpiry: { on: '2029-04-01', why: 'five years from issue' },
          },
        }),
      ),
    ).toBe(false);
  });

  it('accepts a tick, which is a complete answer', () => {
    expect(settleableInBulk(doc({ neverExpires: true }))).toBe(true);
    // ⚠️ EMPTY STRING, NOT NULL. The tick IS the answer and the server checks
    // it before it parses anything; null would read as "unanswered".
    expect(expiryAnswer(doc({ neverExpires: true }))).toBe('');
  });

  it('accepts a date read off the page', () => {
    const read = doc({ proposed: { ...doc().proposed, expiresOn: '2032-11-28' } });
    expect(settleableInBulk(read)).toBe(true);
    expect(expiryAnswer(read)).toBe('2032-11-28');
  });
});

// ────────────────────────────────────────────────────────────────────
// Adding a second batch must not discard the first.
//
// ⚠️ THE BUG THIS PINS LOST FOUR DOCUMENTS OUT OF SIX, IN PRODUCTION.
// The Document Centre closes its add panel after every hand-off, so adding
// six licences is six separate uploads — and the page replaced the review
// queue on each one instead of adding to it. Every document uploaded fine;
// they just lost their place in the only screen that asks a human to confirm
// the type and the dates, so they sat unconfirmed and unfiled for ever.
// Operator, 2026-08-25: "took scans of 6 licenses. 2 made it through."
// ────────────────────────────────────────────────────────────────────
describe('mergeReviewQueue', () => {
  it('⚠️ KEEPS DOCUMENTS FROM EARLIER BATCHES — six added one at a time are six', () => {
    let queue = [] as ReviewItem[];
    for (let n = 1; n <= 6; n++) {
      queue = mergeReviewQueue(queue, [doc({ id: `c${n}` })]);
    }
    expect(queue).toHaveLength(6);
    expect(queue.map((d) => d.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  });

  it('de-duplicates by id, because the hand-off refresh names the same rows', () => {
    // queueHandoffArrivals seeds from every unconfirmed row on the server; a
    // desktop upload of one of those must not double it.
    const seeded = [doc({ id: 'c1' }), doc({ id: 'c2' })];
    const merged = mergeReviewQueue(seeded, [doc({ id: 'c2' }), doc({ id: 'c3' })]);
    expect(merged.map((d) => d.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('lets the later arrival win, as the fresher read of the same document', () => {
    const stale = doc({ id: 'c1', title: 'Scan 1', confident: false });
    const fresh = doc({ id: 'c1', title: 'Firearm licence', confident: true });
    const merged = mergeReviewQueue([stale], [fresh]);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Firearm licence');
    expect(merged[0].confident).toBe(true);
  });

  it('does not mutate what it was handed', () => {
    const waiting = [doc({ id: 'c1' })];
    mergeReviewQueue(waiting, [doc({ id: 'c2' })]);
    expect(waiting).toHaveLength(1);
  });
});

describe('mergeReviewQueue is shared with the Motivation Centre', () => {
  // The Motivation Centre keeps its confirm-queue in a DIFFERENT shape to the
  // Document Centre's ReviewItem, and had independently grown the same
  // wholesale-replace bug. Making the merge generic is what lets one tested
  // function protect both; this pins that, so nobody narrows it back.
  type MotivationRow = { id: string; name: string; kind: string; confident: boolean };
  const row = (id: string, name: string): MotivationRow => ({
    id, name, kind: 'OTHER', confident: false,
  });

  it('⚠️ KEEPS THE FIRST BATCH WHEN A SECOND ONE ARRIVES', () => {
    // Six documents added one at a time were six upload calls. Replacing the
    // queue each time is how five of them lost the only screen that asks a
    // human to confirm what they are.
    const first = [row('a', 'competency.jpg'), row('b', 'licence.jpg')];
    const second = [row('c', 'safe.jpg')];
    const merged = mergeReviewQueue(first, second);
    expect(merged.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('lets the fresher read of the same document win', () => {
    const before = [row('a', 'scan-0001.jpg')];
    const after = [{ ...row('a', 'competency.jpg'), confident: true }];
    const merged = mergeReviewQueue(before, after);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('competency.jpg');
    expect(merged[0].confident).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// SAYING WHICH FIELD, RATHER THAN SHRUGGING AT THE WHOLE DOCUMENT.
//
// The panel already said "(check this)" beside the type, which is honest and
// useless: a member with twelve documents and two doubtful ones cannot tell
// which two. These turn the reader's own field keys into the words on the
// paper in front of them.
// ────────────────────────────────────────────────────────────────────
describe('uncertaintyReason', () => {
  it('names one doubtful field in plain words', () => {
    const r = uncertaintyReason(doc({ readUncertain: ['id_number'] }));
    expect(r).toContain('the identity number');
    expect(r).toContain('check it');
  });

  it('lists several readably, not as a comma-separated dump', () => {
    const r = uncertaintyReason(
      doc({ readUncertain: ['covers', 'holder_name'] }),
    );
    expect(r).toBe(
      'We could not read what the certificate covers and the name clearly - please check them against the document.',
    );
  });

  // ⚠️ NEVER SHOW THE MEMBER OUR KEY NAMES. `frame_serial` means something
  // to the extractor and nothing to somebody holding a licence card. An
  // unlabelled key is dropped rather than printed raw.
  it('says nothing about a field it has no words for', () => {
    expect(uncertaintyReason(doc({ readUncertain: ['some_new_key'] }))).toBeNull();
  });

  it('collapses two keys that mean the same thing to a person', () => {
    // holder_name and full_name are both 'the name' on the paper.
    const r = uncertaintyReason(
      doc({ readUncertain: ['holder_name', 'full_name'] }),
    );
    expect(r).toBe(
      'We could not read the name clearly - please check it against the document.',
    );
  });

  // A row filed before this was stored has nothing recorded. Inventing a
  // reason for it would be worse than the shrug it replaces.
  it('is silent when nothing was recorded', () => {
    expect(uncertaintyReason(doc({}))).toBeNull();
    expect(uncertaintyReason(doc({ readUncertain: [] }))).toBeNull();
  });
});
