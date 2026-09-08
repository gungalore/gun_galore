import { MotivationLicenceType } from '@prisma/client';
import { decryptJson, encryptJson } from '../common/blob-crypto';
import {
  MemberProfileAnswersService,
  profileKeys,
  splitByScope,
} from './member-profile-answers.service';

// ────────────────────────────────────────────────────────────────────
// ANSWERS THAT BELONG TO THE PERSON, NOT TO ONE APPLICATION.
//
// The property this suite exists for is the one that is expensive to get
// wrong: MEMBER provenance is ABSORBING. Once a value is stamped as the
// member's own, nothing automatic may ever fill that field again — so a wrong
// stamp is permanent, and it is exactly what a whole-blob autosave produces if
// the comparison is done against the wrong "before".
// ────────────────────────────────────────────────────────────────────

const T = MotivationLicenceType.S13_SELF_DEFENCE;

// ⚠️ SET AND RESTORED, the same pattern motivations.service.spec.ts uses.
// blob-crypto reads ID_HASH_SECRET at call time and throws without it, and
// leaving it set would leak a fake key into whatever suite Jest runs next in
// this worker.
const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'test-secret-for-member-profile-answers';
});
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

function build(stored?: { answers?: Record<string, string>; provenance?: unknown }) {
  const upserts: any[] = [];
  const prisma = {
    memberProfileAnswers: {
      findUnique: jest.fn(async (): Promise<any> =>
        stored
          ? {
              answersEncrypted: encryptJson(stored.answers ?? {}),
              answerProvenance: stored.provenance ?? {},
            }
          : null,
      ),
      upsert: jest.fn(async (args: any) => {
        upserts.push(args);
        return {};
      }),
    },
  };
  return {
    svc: new MemberProfileAnswersService(prisma as never),
    prisma,
    upserts,
    /** The answers as they were actually written, decrypted. */
    written: () =>
      decryptJson<Record<string, string>>(
        upserts[upserts.length - 1].create.answersEncrypted,
      ),
    provenanceWritten: () => upserts[upserts.length - 1].create.answerProvenance,
  };
}

describe('which keys are profile-scoped', () => {
  it('reads the scope off the registry rather than a second list', () => {
    const keys = profileKeys(T);
    expect(keys.has('marital_status')).toBe(true);
    expect(keys.has('safe_present')).toBe(true);
    expect(keys.has('premises_enclosure')).toBe(true);
    expect(keys.has('existing_firearm_1_primary_use')).toBe(true);
    // An application fact stays with the application.
    expect(keys.has('firearm_make')).toBe(false);
    expect(keys.has('threat_circumstances')).toBe(false);
  });

  it('includes a key this licence type does not ask, because the person still answered it', () => {
    // ⚠️ allFieldsFor, NOT fieldsFor. The profile is shared across every
    // application a member makes, so a key a section 13 does not ask is still
    // a key their section 16 answered. Filtering here would make the premises
    // invisible across licence types, which is the entire thing this service
    // exists to prevent.
    for (const type of Object.values(MotivationLicenceType)) {
      expect(profileKeys(type).has('marital_status')).toBe(true);
    }
  });

  it('routes a mixed patch to the right side', () => {
    const { application, profile } = splitByScope(T, {
      firearm_make: 'CZ',
      marital_status: 'Married',
      premises_enclosure: 'Walled',
      threat_circumstances: 'Long story',
    });
    expect(Object.keys(application).sort()).toEqual([
      'firearm_make',
      'threat_circumstances',
    ]);
    expect(Object.keys(profile).sort()).toEqual([
      'marital_status',
      'premises_enclosure',
    ]);
  });
});

describe('reading', () => {
  it('returns nothing for a member who has no profile yet', async () => {
    const { svc } = build();
    await expect(svc.readFor('user-1')).resolves.toEqual({
      answers: {},
      provenance: {},
    });
  });

  it('survives an undecryptable blob instead of blocking the application', async () => {
    // ⚠️ FAILS SOFT, LIKE EVERY OTHER BLOB READ IN THIS MODULE. A profile we
    // cannot decrypt must degrade to "we hold nothing for you" — a few extra
    // questions — never to a 500 that stops somebody starting at all.
    const prisma = {
      memberProfileAnswers: {
        findUnique: jest.fn(async (): Promise<any> => ({
          answersEncrypted: 'not-actually-ciphertext',
          answerProvenance: {},
        })),
        upsert: jest.fn(),
      },
    };
    const svc = new MemberProfileAnswersService(prisma as never);
    await expect(svc.readFor('user-1')).resolves.toEqual({
      answers: {},
      provenance: {},
    });
  });
});

describe('writing the member own answers', () => {
  it('upserts rather than insert-if-missing', async () => {
    // Two saves landing together — the sheet autosaving while a vault
    // adoption fires — would otherwise both find nothing, both insert, and
    // the unique index would turn the second into a 500 on a keystroke.
    const { svc, prisma } = build();
    await svc.writeFor('user-1', { marital_status: 'Married' });
    expect(prisma.memberProfileAnswers.upsert).toHaveBeenCalledTimes(1);
  });

  it('merges into what is already there', async () => {
    const { svc, written } = build({ answers: { marital_status: 'Single' } });
    await svc.writeFor('user-1', { premises_enclosure: 'Walled' });
    expect(written()).toEqual({
      marital_status: 'Single',
      premises_enclosure: 'Walled',
    });
  });

  it('stamps only the value that actually changed', async () => {
    // ⚠️ THE WHOLE-BLOB AUTOSAVE TRAP. The sheet resends everything on every
    // save, so stamping the payload's keys would flip every prefilled profile
    // answer to MEMBER the first time anybody saved anything — permanently,
    // because MEMBER is absorbing.
    const { svc, provenanceWritten } = build({
      answers: { marital_status: 'Single', premises_enclosure: 'Walled' },
      provenance: {
        premises_enclosure: { source: 'PROFILE', from: 'your profile', at: '2026-09-01T00:00:00.000Z' },
      },
    });
    await svc.writeFor('user-1', {
      marital_status: 'Married',
      premises_enclosure: 'Walled',
    });
    const map = provenanceWritten() as any;
    expect(map.marital_status.source).toBe('MEMBER');
    expect(map.premises_enclosure.source).toBe('PROFILE');
  });

  it('does nothing at all for an empty patch', async () => {
    const { svc, prisma } = build();
    await svc.writeFor('user-1', {});
    expect(prisma.memberProfileAnswers.upsert).not.toHaveBeenCalled();
  });
});

describe('writing what we derived', () => {
  it('fills a field the member has not touched', async () => {
    const { svc, written } = build();
    await svc.writeDerived(
      'user-1',
      { existing_firearm_1_primary_use: 'plains_game' },
      { source: 'READ', from: 'your licence card', at: '' } as never,
    );
    expect(written().existing_firearm_1_primary_use).toBe('plains_game');
  });

  it('⚠️ REFUSES TO OVERWRITE WHAT THE MEMBER SAID', async () => {
    // The one invariant. An automatic pass may not touch a hand-edited field,
    // or a correction somebody made on application two is silently reverted
    // from what they said on application one.
    const { svc, prisma } = build({
      answers: { existing_firearm_1_primary_use: 'sport_competition' },
      provenance: {
        existing_firearm_1_primary_use: {
          source: 'MEMBER',
          from: 'you',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
    });
    await svc.writeDerived(
      'user-1',
      { existing_firearm_1_primary_use: 'plains_game' },
      { source: 'READ', from: 'your licence card', at: '' } as never,
    );
    // Nothing was written at all — there was nothing left to write.
    expect(prisma.memberProfileAnswers.upsert).not.toHaveBeenCalled();
  });
});
