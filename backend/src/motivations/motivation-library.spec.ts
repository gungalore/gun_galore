import { MotivationUploadKind } from '@prisma/client';
import {
  LibraryCredentialRow,
  LibraryUploadRow,
  buildLibrary,
  libraryFor,
} from './motivation-library';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const label = (k: string) =>
  ({
    IDENTITY_DOCUMENT: 'A copy of your ID',
    COMPETENCY_CERTIFICATE: 'Your SAPS competency certificate',
    SAFE_PHOTOGRAPHS: 'Photographs of your safe',
    CURRENT_LICENCE: 'Your existing licence',
  })[k] ?? k;

const upload = (
  o: Partial<LibraryUploadRow> & { id: string; sha256: string },
): LibraryUploadRow => ({
  motivationId: 'old',
  kind: 'IDENTITY_DOCUMENT',
  createdAt: day('2026-01-01'),
  storageKey: 'motivations/2026/01/abc.enc',
  purgedAt: null,
  ...o,
});

const credential = (
  o: Partial<LibraryCredentialRow> & { id: string },
): LibraryCredentialRow => ({
  kind: 'COMPETENCY_CERTIFICATE',
  title: 'Competency 2024',
  createdAt: day('2026-02-01'),
  storageKey: 'credentials/2026/02/def.enc',
  purgedAt: null,
  sha256: null,
  ...o,
});

describe('buildLibrary', () => {
  it('⚠️ COVERS WHAT THE VAULT CANNOT — the ID and the safe photographs', () => {
    // The Licence Centre exists to chase EXPIRY, so it has no concept of an
    // ID copy or a photograph of a safe, and it should not — nothing about
    // them expires. They live only as uploads, which is exactly why the
    // library has to be a union rather than just the vault.
    const items = buildLibrary(
      [],
      [
        upload({ id: 'u1', sha256: 'a', kind: 'IDENTITY_DOCUMENT' }),
        upload({ id: 'u2', sha256: 'b', kind: 'SAFE_PHOTOGRAPHS' }),
      ],
      'current',
      label,
    );
    expect(items.map((i) => i.kind)).toEqual([
      'IDENTITY_DOCUMENT',
      'SAFE_PHOTOGRAPHS',
    ]);
  });

  it('⚠️ SHOWS ONE LINE PER DOCUMENT, not one per copy of it', () => {
    // A document reused onto a second motivation is a second row with its own
    // encrypted blob. Listing both would ask the member to choose between two
    // identical entries — which is the duplicate problem, just moved.
    const items = buildLibrary(
      [],
      [
        upload({ id: 'u1', sha256: 'same', motivationId: 'old' }),
        upload({ id: 'u2', sha256: 'same', motivationId: 'older' }),
      ],
      'current',
      label,
    );
    expect(items).toHaveLength(1);
  });

  it('⚠️ MARKS WHAT IS ALREADY ON THIS MOTIVATION, by content', () => {
    // The copy attached here has a different row id from the library entry it
    // came from. Matching on id would show it as an unused choice and invite
    // the member to attach it twice.
    const items = buildLibrary(
      [],
      [
        upload({ id: 'here', sha256: 'same', motivationId: 'current' }),
        upload({ id: 'there', sha256: 'other', motivationId: 'old' }),
      ],
      'current',
      label,
    );
    expect(items.find((i) => i.sourceId === 'here')?.alreadyHere).toBe(true);
    expect(items.find((i) => i.sourceId === 'there')?.alreadyHere).toBe(false);
  });

  it('maps vault documents onto the slot they fill', () => {
    const items = buildLibrary(
      [
        credential({ id: 'c1', kind: 'COMPETENCY_CERTIFICATE' }),
        credential({ id: 'c2', kind: 'FIREARM_LICENCE', title: 'Rifle' }),
      ],
      [],
      'current',
      label,
    );
    expect(items.map((i) => i.kind)).toEqual([
      'COMPETENCY_CERTIFICATE',
      'CURRENT_LICENCE',
    ]);
  });

  it('⚠️ KEEPS THE VAULT TITLE, because "competency certificate" is four documents', () => {
    // The whole reason there is a choice at all is that a member may hold
    // several. A list of four identical slot names is not a choice.
    const items = buildLibrary(
      [
        credential({ id: 'c1', title: 'Competency — handgun' }),
        credential({ id: 'c2', title: 'Competency — rifle' }),
      ],
      [],
      'current',
      label,
    );
    expect(items.map((i) => i.title)).toEqual([
      'Competency — handgun',
      'Competency — rifle',
    ]);
  });

  it('⚠️ NEVER OFFERS A DOCUMENT WHOSE BYTES ARE GONE', () => {
    // A purged row is a record that the document once existed. Offering it
    // would fail at the moment of copying — after the member had chosen it.
    const items = buildLibrary(
      [credential({ id: 'c1', purgedAt: day('2026-03-01') })],
      [
        upload({ id: 'u1', sha256: 'a', purgedAt: day('2026-03-01') }),
        upload({ id: 'u2', sha256: 'b', storageKey: null }),
      ],
      'current',
      label,
    );
    expect(items).toHaveLength(0);
  });

  it('skips a vault document with no motivation slot', () => {
    // A professional-hunter registration is kept and its expiry chased; it
    // evidences nothing on a section 16 application.
    const items = buildLibrary(
      [credential({ id: 'c1', kind: 'PROFESSIONAL_HUNTER' })],
      [],
      'current',
      label,
    );
    expect(items).toHaveLength(0);
  });

  it('prefers the copy already on this motivation when both stores hold it', () => {
    const items = buildLibrary(
      [credential({ id: 'c1', sha256: 'same', kind: 'COMPETENCY_CERTIFICATE' })],
      [
        upload({
          id: 'here',
          sha256: 'same',
          motivationId: 'current',
          kind: 'COMPETENCY_CERTIFICATE',
        }),
      ],
      'current',
      label,
    );
    expect(items).toHaveLength(1);
    expect(items[0].source).toBe('upload');
    expect(items[0].alreadyHere).toBe(true);
  });

  it('handles an empty library', () => {
    expect(buildLibrary([], [], 'current', label)).toEqual([]);
  });
});

describe('documents that belong to ONE application', () => {
  // ⚠️ THE LIVE BUG THIS FIXES. library() scopes its upload query to
  // `motivation: { userId }` — EVERY application the member has ever filed —
  // and takeUpload applied no kind filter, so a second section 16 was offered
  // last year's ASSOCIATION_ENDORSEMENT under the label "The association's
  // endorsement for this firearm". That endorsement names one firearm by
  // serial. The guard existed and was in the wrong place: it kept the
  // endorsement out of `suggested` and left it in `items`, which is the list
  // the member actually picks from.

  it.each([
    ['ASSOCIATION_ENDORSEMENT', 'names one firearm by serial'],
    ['FIREARM_SOURCE_PROOF', 'answers "whose firearm is this" for one application'],
    ['SELLER_LICENCE', "is another living person's licence"],
    ['PREVIOUS_MOTIVATION', 'is a past application for a past firearm'],
    ['OTHER', 'is unclassified, so we cannot say it is safe'],
    ['SAFE_PHOTO', 'predates all the guidance, so nobody can say what it shows'],
  ] as [MotivationUploadKind, string][])(
    'never carries %s across from another application (%s)',
    (kind) => {
    const items = buildLibrary(
      [],
      [upload({ id: 'u1', sha256: 'a', motivationId: 'last-year', kind })],
      'current',
      label,
    );
    expect(items).toEqual([]);
    },
  );

  it('STILL shows one already attached to THIS application', () => {
    // Or the slot it fills renders empty and the member is asked to photograph
    // a paper that is sitting right there. What must never happen is carrying
    // one across — not showing what is already here.
    const items = buildLibrary(
      [],
      [
        upload({
          id: 'u1',
          sha256: 'a',
          motivationId: 'current',
          kind: 'ASSOCIATION_ENDORSEMENT',
        }),
      ],
      'current',
      label,
    );
    expect(items).toHaveLength(1);
    expect(items[0].alreadyHere).toBe(true);
  });

  it('leaves the ordinary reusable documents alone', () => {
    const items = buildLibrary(
      [],
      [
        upload({ id: 'u1', sha256: 'a', motivationId: 'last-year', kind: 'IDENTITY_DOCUMENT' }),
        upload({ id: 'u2', sha256: 'b', motivationId: 'last-year', kind: 'ASSOCIATION_ENDORSEMENT' }),
        upload({ id: 'u3', sha256: 'c', motivationId: 'last-year', kind: 'SAFE_PHOTOGRAPHS' }),
      ],
      'current',
      label,
    );
    expect(items.map((i) => i.sourceId).sort()).toEqual(['u1', 'u3']);
  });
});

describe('libraryFor', () => {
  it('narrows to one slot', () => {
    const items = buildLibrary(
      [],
      [
        upload({ id: 'u1', sha256: 'a', kind: 'IDENTITY_DOCUMENT' }),
        upload({ id: 'u2', sha256: 'b', kind: 'SAFE_PHOTOGRAPHS' }),
      ],
      'current',
      label,
    );
    expect(libraryFor(items, 'IDENTITY_DOCUMENT').map((i) => i.sourceId)).toEqual(
      ['u1'],
    );
  });
});

// ────────────────────────────────────────────────────────────────────
// THE GOOD STANDING SLOT'S REUSE LIST WAS PERMANENTLY EMPTY.
//
// Operator, item 2 of twelve: "can't pull anything from there". Four
// association documents were folded into one CredentialKind on 2026-08-20, so
// a sworn good standing letter and a dedicated status card are both
// DEDICATED_DISCIPLINE — and the slot a credential was offered in came from
// primaryUploadKind(), which returns the FIRST covered kind and nothing else.
//
// Two consequences, both wrong: the "letter of good standing" slot offered
// nothing however many the member held, and a sworn letter reused from the
// vault attached as ASSOCIATION_CARD — so the pack captioned it "Your
// dedicated status certificate", the wrong document name on evidence in front
// of a DFO.
// ────────────────────────────────────────────────────────────────────
describe('which slot a folded association document is offered in', () => {
  it('⚠️ offers a sworn letter under GOOD_STANDING_LETTER, not the card slot', () => {
    const items = buildLibrary(
      [
        credential({
          id: 'c1',
          kind: 'DEDICATED_DISCIPLINE',
          disciplineType: 'GOOD_STANDING_LETTER',
          title: 'Good standing 2026',
        }),
      ],
      [],
      'current',
      label,
    );
    expect(items.map((i) => i.kind)).toEqual(['GOOD_STANDING_LETTER']);
  });

  it('still offers a status card under the card slot', () => {
    const items = buildLibrary(
      [
        credential({
          id: 'c1',
          kind: 'DEDICATED_DISCIPLINE',
          disciplineType: 'ASSOCIATION_CARD',
        }),
      ],
      [],
      'current',
      label,
    );
    expect(items.map((i) => i.kind)).toEqual(['ASSOCIATION_CARD']);
  });

  it('falls back to the primary kind for rows filed before this existed', () => {
    // Every credential adopted before 2026-08-24 has a null disciplineType.
    // They must keep working, just without the finer distinction.
    const items = buildLibrary(
      [credential({ id: 'c1', kind: 'DEDICATED_DISCIPLINE', disciplineType: null })],
      [],
      'current',
      label,
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('ASSOCIATION_CARD');
  });

  it('⚠️ ignores a disciplineType that is not a real upload kind', () => {
    // It is a free String column. A stale or hand-edited value must not become
    // a slot that does not exist.
    const items = buildLibrary(
      [
        credential({
          id: 'c1',
          kind: 'DEDICATED_DISCIPLINE',
          disciplineType: 'NOT_A_REAL_KIND',
        }),
      ],
      [],
      'current',
      label,
    );
    expect(items[0].kind).toBe('ASSOCIATION_CARD');
  });
});
