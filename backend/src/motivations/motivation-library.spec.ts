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
    SAFE_PHOTO_CLOSED: 'Your safe, closed',
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
        upload({ id: 'u2', sha256: 'b', kind: 'SAFE_PHOTO_CLOSED' }),
      ],
      'current',
      label,
    );
    expect(items.map((i) => i.kind)).toEqual([
      'IDENTITY_DOCUMENT',
      'SAFE_PHOTO_CLOSED',
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

describe('libraryFor', () => {
  it('narrows to one slot', () => {
    const items = buildLibrary(
      [],
      [
        upload({ id: 'u1', sha256: 'a', kind: 'IDENTITY_DOCUMENT' }),
        upload({ id: 'u2', sha256: 'b', kind: 'SAFE_PHOTO_CLOSED' }),
      ],
      'current',
      label,
    );
    expect(libraryFor(items, 'IDENTITY_DOCUMENT').map((i) => i.sourceId)).toEqual(
      ['u1'],
    );
  });
});
