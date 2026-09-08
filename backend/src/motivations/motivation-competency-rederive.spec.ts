import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { MotivationsService } from './motivations.service';
import { MotivationSharedService } from './motivation-shared.service';
import { MemberProfileAnswersService } from './member-profile-answers.service';
import { MotivationPrefillService } from './motivation-prefill.service';
import { decryptJson, encryptJson } from '../common/blob-crypto';
import type { ProvenanceMap } from '../common/answer-provenance';

// ────────────────────────────────────────────────────────────────────
// THE COMPETENCY IS RE-DERIVED WHEN THE FIREARM ANSWER LANDS.
//
// Operator, 2026-09-07, driving a fresh section 13 (self-defence, handgun) on
// production: "the wrong competency chosen before it even knows which firearm
// is being applied for."
//
// That is an ORDERING fault, not a matching one. create() seeds the competency
// boxes from the vault at the moment the application is made — before
// `firearm_type` can exist — and the vault's tie-break is "longest-running
// expiry wins". So a member holding a rifle-and-shotgun certificate and a
// handgun certificate got whichever ran longest, and NOTHING EVER CAME BACK TO
// LOOK AGAIN: saveAnswers re-derived exactly one thing on a change, the police
// station, on an address edit. The wrong certificate then rode all the way to
// the eligibility check, which told a member holding the right competency that
// his competency did not cover his own handgun.
//
// Per CLAUDE.md "Automate It — Do Not Ask", the fix is not a confirm step in
// front of the competency box: it is to work it out again the moment we learn
// the thing that decides it, write it, and leave it editable.
// ────────────────────────────────────────────────────────────────────

// ⚠️ SET AT MODULE SCOPE, NOT IN beforeAll. The fixtures below encrypt their
// details blob as they are constructed, which happens while this file is being
// evaluated — long before any hook runs.
const ORIGINAL_SECRET = process.env.ID_HASH_SECRET;
process.env.ID_HASH_SECRET = 'test-secret-for-competency-rederive';
afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.ID_HASH_SECRET;
  else process.env.ID_HASH_SECRET = ORIGINAL_SECRET;
});

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** One vault row, in the shape credentialsFor selects and decrypts. */
function credential(over: {
  id: string;
  title: string;
  covers: string;
  number: string;
  expiresOn?: string | null;
  issuedOn?: string | null;
  /** 'read' off the card, or 'derived' — our own arithmetic. */
  dateSource?: string | null;
}) {
  return {
    id: over.id,
    kind: 'COMPETENCY_CERTIFICATE',
    title: over.title,
    expiresOn: over.expiresOn ? day(over.expiresOn) : null,
    issuedOn: over.issuedOn ? day(over.issuedOn) : null,
    confirmedAt: null,
    // ⚠️ A COMPETENCY CERTIFICATE PRINTS NO EXPIRY, so 'derived' is the
    // ORDINARY state of one of these rows, not a corner case.
    dateSource: over.dateSource ?? 'derived',
    extractionOk: true,
    detailsEncrypted: encryptJson({
      competency_number: over.number,
      covers: over.covers,
    }),
  };
}

const HANDGUN_CERT = credential({
  id: 'cred-handgun',
  title: 'My handgun competency',
  covers: 'HANDGUN',
  number: '2000/1111111/11',
  issuedOn: '2021-04-05',
  expiresOn: '2029-04-05',
});

// Runs LONGER than the handgun one, which is exactly why it used to win.
const RIFLE_CERT = credential({
  id: 'cred-rifle',
  title: 'My rifle and shotgun competency',
  covers: 'S/L-RIFLE/CARB/SHOTGUN',
  number: '2000/2222222/22',
  issuedOn: '2020-02-02',
  expiresOn: '2031-02-02',
});

const SHOTGUN_CERT = credential({
  id: 'cred-shotgun',
  title: 'My shotgun competency',
  covers: 'SHOTGUN',
  number: '2000/3333333/33',
  issuedOn: '2019-07-07',
  expiresOn: '2030-07-07',
});

function build(
  opts: {
    answers?: Record<string, string>;
    provenance?: ProvenanceMap;
    credentials?: ReturnType<typeof credential>[];
  } = {},
) {
  const updates: { data: Record<string, unknown> }[] = [];
  const prisma = {
    user: { findUnique: jest.fn(async () => ({ id: 'user-1' })) },
    // ⚠️ saveAnswers READS THE PROFILE STORE ON EVERY CALL now, so the model
    // has to exist on the double even here, where nothing is profile-scoped.
    // Absent, it reads as `undefined.findUnique` and fails every case in a way
    // that looks nothing like a missing mock.
    memberProfileAnswers: {
      findUnique: jest.fn(async () => null),
      upsert: jest.fn(async () => ({})),
    },
    motivation: {
      findFirst: jest.fn(async () => ({
        id: 'mo-1',
        licenceType: MotivationLicenceType.S13_SELF_DEFENCE,
        status: MotivationStatus.DRAFT,
        answersEncrypted: encryptJson(opts.answers ?? {}),
        answerProvenance: opts.provenance ?? {},
      })),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        updates.push(args);
        return {};
      }),
    },
    credential: {
      findMany: jest.fn(async () => opts.credentials ?? []),
    },
    motivationUpload: { findMany: jest.fn(async () => []) },
  };

  const quota = { assertEnabled: jest.fn(async () => undefined) };
  // Never reached: no test here edits `residential_address`, which is the only
  // answer that asks for a station.
  const crimeStats = {
    nearestStation: jest.fn(async () => ({ station: null })),
  };

  const shared = new MotivationSharedService(prisma as never);
  const prefill = new MotivationPrefillService(
    prisma as never,
    quota as never,
    shared,
    crimeStats as never,
  );
  const svc = new MotivationsService(
    prisma as never,
    quota as never,
    null as never,
    null as never,
    null as never,
    shared,
    prefill,
    null as never,
    null as never,
    null as never,
    null as never,
    // The profile store. Real rather than a stub, against the same `prisma`
    // double: nothing in this file writes a profile-scoped answer, so it is
    // exercised only as the empty read that saveAnswers now always does.
    new MemberProfileAnswersService(prisma as never),
  );

  /** The answers as they were actually written, decrypted. */
  const written = () =>
    decryptJson<Record<string, string>>(
      updates[updates.length - 1].data.answersEncrypted as string,
    ) ?? {};
  const provenanceWritten = () =>
    updates[updates.length - 1].data.answerProvenance as ProvenanceMap;

  return { svc, prisma, updates, written, provenanceWritten };
}

const PICKS_HANDGUN = {
  firearm_type: 'Handgun',
  firearm_action: 'Semi-automatic (self-loading)',
};

describe('re-deriving the competency when the firearm answer lands', () => {
  it('⚠️ chooses the certificate that COVERS the firearm, not the longest-dated', async () => {
    // The whole fault, end to end. Both certificates are the member's own and
    // both numbers look right, which is why a wrong pick reaches a signed form
    // unnoticed.
    const t = build({ credentials: [RIFLE_CERT, HANDGUN_CERT] });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(t.written().competency_number).toBe('2000/1111111/11');
    expect(t.written().competency_for).toContain('Handgun');
  });

  it('re-derives on a change to the ACTION too', async () => {
    // A member who fixes only the action has changed which certificate is
    // right — a self-loading rifle and a bolt-action rifle are two different
    // endorsements.
    const t = build({
      answers: { firearm_type: 'Handgun' },
      credentials: [HANDGUN_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', { firearm_action: 'Revolver' });
    expect(t.written().competency_number).toBe('2000/1111111/11');
  });

  it('does nothing at all when neither firearm key moved', async () => {
    const t = build({ credentials: [HANDGUN_CERT] });
    await t.svc.saveAnswers('clerk-1', 'mo-1', { firearm_make: 'Glock' });
    expect(t.written().competency_number).toBeUndefined();
    expect(t.prisma.credential.findMany).not.toHaveBeenCalled();
  });

  it('⚠️ REPLACES a value WE wrote — that is the fault being fixed', async () => {
    const t = build({
      answers: { competency_number: '2000/2222222/22' },
      provenance: {
        competency_number: {
          source: 'VAULT',
          sourceId: 'cred-rifle',
          from: 'My rifle and shotgun competency',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials: [RIFLE_CERT, HANDGUN_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(t.written().competency_number).toBe('2000/1111111/11');
    expect(t.provenanceWritten().competency_number.sourceId).toBe(
      'cred-handgun',
    );
  });

  it('⚠️ NEVER replaces a value the member typed', async () => {
    // MEMBER is absorbing everywhere else in this module and it is absorbing
    // here. A value the member corrected and the system silently corrected
    // back is worse than no prefill at all.
    const t = build({
      answers: { competency_number: 'THEIR OWN 1234' },
      provenance: {
        competency_number: {
          source: 'MEMBER',
          from: 'You entered this',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials: [HANDGUN_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(t.written().competency_number).toBe('THEIR OWN 1234');
  });

  it('⚠️ leaves a value of UNKNOWN provenance alone', async () => {
    // No provenance entry is not the same as ours. It predates the column, or
    // arrived some way nobody recorded — and claiming it as ours to overwrite
    // would be a guess told by a default.
    const t = build({
      answers: { competency_number: '2000/2222222/22' },
      credentials: [HANDGUN_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(t.written().competency_number).toBe('2000/2222222/22');
  });

  it('⚠️ CLEARS a certificate the new firearm rules out, and drops its chip', async () => {
    // Leaving a wrong certificate number on a SAPS 271 is worse than an empty
    // required box: the empty box is a question the member can answer, the
    // wrong number is one they would never think to check.
    const t = build({
      answers: {
        competency_number: '2000/2222222/22',
        competency_for:
          'Rifle or carbine — self-loading (includes pistol calibre carbine)',
      },
      provenance: {
        competency_number: {
          source: 'VAULT',
          sourceId: 'cred-rifle',
          from: 'My rifle and shotgun competency',
          at: '2026-09-01T00:00:00.000Z',
        },
        competency_for: {
          source: 'VAULT',
          sourceId: 'cred-rifle',
          from: 'My rifle and shotgun competency',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials: [RIFLE_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(t.written().competency_number).toBe('');
    expect(t.provenanceWritten().competency_number).toBeUndefined();
  });

  it('⚠️ fills a HANDGUN from the type alone — the action cannot change it', async () => {
    // Competency reference §2.2 and §12 #3: one unit standard covers handguns
    // whole (119649) and one covers shotguns whole (119652). Waiting for
    // `firearm_action` therefore withheld a certificate we already held for no
    // reason — and it withheld it from every RENEWAL, because a licence card
    // does not print an action and licence-renewal.ts cannot seed one.
    const t = build({ credentials: [HANDGUN_CERT] });
    await t.svc.saveAnswers('clerk-1', 'mo-1', { firearm_type: 'Handgun' });
    expect(t.written().competency_number).toBe('2000/1111111/11');
  });

  it('waits for the action on a RIFLE, where the action picks the certificate', async () => {
    // 119651 manual against 119650 self-loading — the one split with training
    // behind it. Choosing before the member has said which would be the same
    // coin toss this whole hook exists to end.
    const t = build({ credentials: [RIFLE_CERT] });
    await t.svc.saveAnswers('clerk-1', 'mo-1', { firearm_type: 'Rifle' });
    expect(t.written().competency_number).toBeUndefined();
  });

  it('⚠️ survives a vault it cannot read', async () => {
    // Fail-soft like every other prefill source: an unreadable vault costs the
    // member one box, never the answer they just typed.
    const t = build({ credentials: [HANDGUN_CERT] });
    t.prisma.credential.findMany.mockRejectedValueOnce(new Error('down'));
    await expect(
      t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN),
    ).resolves.toBeDefined();
    expect(t.written().firearm_type).toBe('Handgun');
  });
});

describe('a DERIVED expiry does not wear the "read off your document" pill', () => {
  it('⚠️ stamps the competency expiry as inferred, and the issue date as read', async () => {
    // A competency certificate carries NO printed expiry — SAPS does not put
    // one there. Ours is arithmetic over the member's own licences
    // (sa-competency-reference §5.2/§5.3). The vault records that honestly as
    // dateSource 'derived'; the prefill used to collapse it to a boolean, so
    // the wizard showed a worked-out date with a green "read off your
    // document" pill naming a document it is not printed on.
    const t = build({ credentials: [HANDGUN_CERT] });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);

    expect(t.written().competency_expiry).toBe('2029-04-05');
    expect(t.provenanceWritten().competency_expiry.inferred).toBe(true);
    // ⚠️ AND ONLY THE EXPIRY. The ISSUE date is printed on the certificate in
    // ink and was read off it; calling that inferred is the same lie pointing
    // the other way.
    expect(t.written().competency_issued).toBe('2021-04-05');
    expect(t.provenanceWritten().competency_issued.inferred).toBeUndefined();
  });

  it('leaves an expiry we actually READ alone', async () => {
    const t = build({
      credentials: [
        credential({
          id: 'cred-handgun',
          title: 'My handgun competency',
          covers: 'HANDGUN',
          number: '2000/1111111/11',
          issuedOn: '2021-04-05',
          expiresOn: '2029-04-05',
          dateSource: 'read',
        }),
      ],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(t.provenanceWritten().competency_expiry.inferred).toBeUndefined();
  });
});

describe('⚠️ "we cannot choose" CLEARS — it does not leave the last guess standing', () => {
  // The fail-open the first round shipped: `competencyOffer` opened with
  // `if (!requiredEndorsement(answers)) return null`, and requiredEndorsement
  // is null for a COMBINATION gun — one of the four choices SAPS 271 §E.1
  // offers and `firearm_type` accepts. So a member who had a rifle certificate
  // written in and then switched to Combination kept it, ticks and all, for
  // the life of the application. Null conflated "we have not been told" with
  // "we have been told and cannot map it", and only the first means leave it.

  const COMBINATION = {
    firearm_type: 'Combination',
    firearm_action: 'Break action',
  };

  const withRifleWritten = (credentials: ReturnType<typeof credential>[]) =>
    build({
      answers: {
        competency_number: '2000/2222222/22',
        competency_for:
          'Rifle or carbine — manually operated (bolt / lever / pump / single shot)',
      },
      provenance: {
        competency_number: {
          source: 'VAULT',
          sourceId: 'cred-rifle',
          from: 'My rifle and shotgun competency',
          at: '2026-09-01T00:00:00.000Z',
        },
        competency_for: {
          source: 'VAULT',
          sourceId: 'cred-rifle',
          from: 'My rifle and shotgun competency',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials,
    });

  it('⚠️ CLEARS when no certificate covers either barrel of a combination gun', async () => {
    // They hold a handgun certificate and nothing else. The rifle certificate
    // on the form was chosen for a firearm this is not.
    const t = withRifleWritten([HANDGUN_CERT]);
    await t.svc.saveAnswers('clerk-1', 'mo-1', COMBINATION);
    expect(t.written().competency_number).toBe('');
    expect(t.provenanceWritten().competency_number).toBeUndefined();
  });

  it('⚠️ CLEARS when the member holds only half of what it needs', async () => {
    // ⚠️ AND THE "WHICH CERTIFICATE" HALF OF THIS IS NOT DECIDED HERE. This
    // method decides WHETHER to act and WHAT it may replace; credentialOffer
    // decides which document answers the firearm, including the combination
    // gun's own rule. A second selection rule in this file would be two answers
    // to one question on the same screen, free to disagree over a signed form.
    // What is pinned here is the part this file owns: a combination gun is a
    // DECISION, not a silence, so a certificate chosen for some earlier answer
    // does not survive it.
    const t = withRifleWritten([SHOTGUN_CERT]);
    await t.svc.saveAnswers('clerk-1', 'mo-1', COMBINATION);
    expect(t.written().competency_number).toBe('');
    expect(t.provenanceWritten().competency_number).toBeUndefined();
  });

  it('⚠️ never leaves half a block behind', async () => {
    // Whatever the offer fills, it fills as a BLOCK: every key we were allowed
    // to replace is written and stamped together, so one screen can never cite
    // two different documents for one certificate.
    const t = withRifleWritten([SHOTGUN_CERT]);
    await t.svc.saveAnswers('clerk-1', 'mo-1', COMBINATION);
    const prov = t.provenanceWritten();
    const ids = new Set(
      [
        'competency_number',
        'competency_for',
        'competency_issued',
        'competency_expiry',
      ]
        .map((k) => prov[k]?.sourceId)
        .filter(Boolean),
    );
    expect(ids.size).toBeLessThanOrEqual(1);
  });

  it('⚠️ CLEARS on a firearm type the registry can no longer map', async () => {
    // ⚠️ THE STORED ANSWER, NOT THE PATCH, AND THAT IS THE ONLY WAY IN.
    // `firearm_type` is a `choice` field, so sanitiseAnswers refuses a value
    // outside its list — a member cannot send this. It is reachable exactly one
    // way: a choice added to or renamed in motivation-fields.ts without
    // endorsementNeed following it, sitting in a draft saved while the two
    // agreed. It is a decision, not a silence: whatever is on the form was
    // chosen against a firearm type we can no longer vouch for.
    const t = build({
      answers: {
        firearm_type: 'Trebuchet',
        competency_number: '2000/2222222/22',
      },
      provenance: {
        competency_number: {
          source: 'VAULT',
          sourceId: 'cred-rifle',
          from: 'My rifle and shotgun competency',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials: [RIFLE_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', {
      firearm_action: 'Break action',
    });
    expect(t.written().competency_number).toBe('');
    expect(t.provenanceWritten().competency_number).toBeUndefined();
  });

  it('leaves it alone when the type is CLEARED, which is a question not an answer', async () => {
    // Clearing `firearm_type` says nothing about the certificate — and the box
    // is required, so the member must answer it again, which re-derives. Wiping
    // four boxes mid-edit would cost them work to buy nothing: the wrong
    // certificate cannot reach a signed form without a firearm type beside it.
    const t = withRifleWritten([RIFLE_CERT]);
    await t.svc.saveAnswers('clerk-1', 'mo-1', {
      firearm_type: '',
      firearm_action: '',
    });
    expect(t.written().competency_number).toBe('2000/2222222/22');
  });
});

describe('⚠️ a box the member DELIBERATELY cleared stays cleared', () => {
  it('does not treat an empty MEMBER box as ours to fill', async () => {
    // `changedKeys` counts a clear as a change, by its own doc, so a member who
    // empties a prefilled box is stamped MEMBER over an empty value. The
    // replaceable filter used to read `!value || REPLACEABLE.has(source)` — the
    // first clause made ANY empty box ours regardless — so their deletion was
    // undone on the next firearm edit, and the refilled value then wore the
    // MEMBER chip: "You entered this", over a number they had just removed.
    const t = build({
      answers: { competency_number: '' },
      provenance: {
        competency_number: {
          source: 'MEMBER',
          from: 'You entered this',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials: [HANDGUN_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(t.written().competency_number).toBe('');
    // The rest of the block is still ours, and is still filled.
    expect(t.written().competency_issued).toBe('2021-04-05');
  });
});

describe('⚠️ the whole block is stamped together', () => {
  it('re-attributes an UNCHANGED key to the certificate that now supplies it', async () => {
    // Two certificates issued on the same day. When the handgun one takes over,
    // `competency_issued` does not move — and it used to keep the rifle
    // certificate's chip, so one screen cited two different documents for one
    // certificate.
    const SAME_DAY_RIFLE = credential({
      id: 'cred-rifle',
      title: 'My rifle and shotgun competency',
      covers: 'S/L-RIFLE/CARB/SHOTGUN',
      number: '2000/2222222/22',
      issuedOn: '2021-04-05',
      expiresOn: '2031-02-02',
    });
    const t = build({
      answers: { competency_issued: '2021-04-05' },
      provenance: {
        competency_issued: {
          source: 'VAULT',
          sourceId: 'cred-rifle',
          from: 'My rifle and shotgun competency',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials: [SAME_DAY_RIFLE, HANDGUN_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(t.written().competency_issued).toBe('2021-04-05');
    expect(t.provenanceWritten().competency_issued.sourceId).toBe(
      'cred-handgun',
    );
  });
});

describe('⚠️ what the server wrote is RETURNED, not written and forgotten', () => {
  // The autosave hook sends the WHOLE answers map on every save. A value the
  // client does not hold is a value it sends back stale on the next keystroke —
  // and `markMember` then stamps that stale value MEMBER, which is absorbing.
  // From that moment the wrong certificate is locked onto a signed declaration
  // wearing a "You entered this" chip the member never earned.

  it('names the values it wrote and the provenance for them', async () => {
    const t = build({ credentials: [HANDGUN_CERT] });
    const res = await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(res.derived.values.competency_number).toBe('2000/1111111/11');
    expect(res.derived.provenance.competency_number?.sourceId).toBe(
      'cred-handgun',
    );
  });

  it('reports a CLEAR as an empty string and a null chip', async () => {
    const t = build({
      answers: { competency_number: '2000/2222222/22' },
      provenance: {
        competency_number: {
          source: 'VAULT',
          sourceId: 'cred-rifle',
          from: 'My rifle and shotgun competency',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials: [RIFLE_CERT],
    });
    const res = await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(res.derived.values.competency_number).toBe('');
    expect(res.derived.provenance.competency_number).toBeNull();
    // ⚠️ AND THE OUTSTANDING LIST AGREES IN THE SAME RESPONSE. missingRequired
    // is computed after the write, so a box this emptied is named here — the
    // member cannot be shown an empty required box under a footer saying
    // nothing is outstanding.
    expect(res.missingRequired).toContain('competency_number');
  });

  it('is present and empty when the server wrote nothing', async () => {
    const t = build({ credentials: [HANDGUN_CERT] });
    const res = await t.svc.saveAnswers('clerk-1', 'mo-1', {
      firearm_make: 'Glock',
    });
    expect(res.derived).toEqual({ values: {}, provenance: {} });
  });
});

describe('⚠️ the hook also catches a firearm that arrived some other way', () => {
  it('fills an empty block even when neither firearm key moved on THIS save', async () => {
    // applyExtraction and the seller-consent path both write firearm_type and
    // firearm_action straight into the answers blob — the dealer-prefilled
    // SAPS 271 is "the common real-world case" in the routing spec. Since
    // create() no longer picks a certificate before the firearm is known,
    // keying only on `changed` would have left those members with four
    // permanently blank competency boxes.
    const t = build({
      answers: PICKS_HANDGUN,
      credentials: [HANDGUN_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', { firearm_make: 'Glock' });
    expect(t.written().competency_number).toBe('2000/1111111/11');
  });

  it('does not go looking on a save that changed nothing at all', async () => {
    const t = build({ answers: PICKS_HANDGUN, credentials: [HANDGUN_CERT] });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);
    expect(t.prisma.credential.findMany).not.toHaveBeenCalled();
  });

  it('stops asking once a box is filled', async () => {
    const t = build({
      answers: { ...PICKS_HANDGUN, competency_number: 'THEIRS' },
      provenance: {
        competency_number: {
          source: 'MEMBER',
          from: 'You entered this',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials: [HANDGUN_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', { firearm_make: 'Glock' });
    expect(t.prisma.credential.findMany).not.toHaveBeenCalled();
  });
});

describe('⚠️ a registry drift must not silently BLANK a competency box', () => {
  // saveAnswers treats a refusal as "a DEFECT UNTIL PROVEN OTHERWISE" and logs
  // it at error level, because a REGISTERED field refusing its own value means
  // the form and the validator have drifted — that is how `discipline`
  // silently discarded all fifty-nine of its options. The re-derivation used to
  // destructure `sanitiseAnswers` for its answers and throw the refused list
  // away, and the silent consequence was worse than the missing log line: the
  // refused key fell out of `clean`, which reads as "the vault has nothing",
  // which EMPTIES a required box on a form the applicant signs.
  //
  // ⚠️ SPIED RATHER THAN PROVOKED, BECAUSE IT CANNOT BE PROVOKED TODAY.
  // `competency_for` is a `multi` whose choices ARE ENDORSEMENT_LABELS, and
  // credentialOffer renders it through those same labels, so the two cannot
  // presently disagree. The whole point of the branch is the day they do.
  const fields = jest.requireActual<typeof import('./motivation-fields')>(
    './motivation-fields',
  );

  afterEach(() => jest.restoreAllMocks());

  it('leaves the box exactly as it was, and says so', async () => {
    const real = fields.sanitiseAnswers;
    const spy = jest
      .spyOn(
        require('./motivation-fields') as typeof import('./motivation-fields'),
        'sanitiseAnswers',
      )
      .mockImplementation((type, patch) => {
        const out = real(type, patch);
        if ('competency_number' in out.answers) {
          const { competency_number: _drop, ...rest } = out.answers;
          return {
            answers: rest,
            rejected: [...out.rejected, 'competency_number'],
            refused: [...out.refused, 'competency_number'],
          };
        }
        return out;
      });

    const t = build({
      answers: { competency_number: '2000/2222222/22' },
      provenance: {
        competency_number: {
          source: 'VAULT',
          sourceId: 'cred-rifle',
          from: 'My rifle and shotgun competency',
          at: '2026-09-01T00:00:00.000Z',
        },
      },
      credentials: [HANDGUN_CERT],
    });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);

    expect(spy).toHaveBeenCalled();
    // Untouched — not blanked, not replaced. A drift costs us the improvement,
    // never the member's box.
    expect(t.written().competency_number).toBe('2000/2222222/22');
    // The rest of the block still moves, because only one key was refused.
    expect(t.written().competency_issued).toBe('2021-04-05');
  });
});

describe('⚠️ and the chip names the arithmetic, not the card', () => {
  it('does not send the member to look for an expiry their certificate never prints', async () => {
    // `ProvenanceNote` renders exactly one string — "from {from}" — so the
    // amber "check this" used to sit beside the certificate's own title,
    // telling somebody to go and check a date against a card SAPS does not put
    // one on. They find nothing, and reasonably conclude we invented it. We
    // did — correctly — and should say so.
    const t = build({ credentials: [HANDGUN_CERT] });
    await t.svc.saveAnswers('clerk-1', 'mo-1', PICKS_HANDGUN);

    const expiry = t.provenanceWritten().competency_expiry;
    expect(expiry.inferred).toBe(true);
    expect(expiry.from).not.toContain('My handgun competency');
    expect(expiry.from).toContain('longest-running licence');
    // ⚠️ THE ROW IS STILL NAMED, because it is still true: there IS a vault
    // row and this IS its expiry. Only the sentence was wrong.
    expect(expiry.source).toBe('VAULT');
    expect(expiry.sourceId).toBe('cred-handgun');

    // The issue date is printed on the card and was read off it, so it keeps
    // the card's own name.
    expect(t.provenanceWritten().competency_issued.from).toBe(
      'My handgun competency',
    );
  });
});
