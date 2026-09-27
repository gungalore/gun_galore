import { ConflictException, HttpException } from '@nestjs/common';
import type { EnquiryRow, EnquiryParseResult } from './saps-enquiry-page';
import { EnquiryHandshakeError } from './saps-enquiry.client';
import {
  LicenceTrackerService,
  classifyEnquiry,
  hashReference,
  normaliseReference,
  parseSapsDate,
  rowSha256,
} from './licence-tracker.service';
import { FLAGS } from '../settings/settings.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { SettingsService } from '../settings/settings.service';

// ⚠️ SET BEFORE ANY ENCRYPT OR HASH CALL. blob-crypto has NO fallback key on
// purpose (a default key makes the data unrecoverable after the first real
// deploy), so every suite that touches it has to provide one.
beforeAll(() => {
  process.env.ID_HASH_SECRET = 'tracker-spec-secret-not-for-production';
});

// ─── the pure half ──────────────────────────────────────────────────

const row = (over: Partial<EnquiryRow> = {}): EnquiryRow => ({
  applicationType: 'Competency',
  applicationNumber: '10000001',
  calibre: '',
  make: '',
  serialNumber: '',
  statusDate: '2025/06/30',
  status: 'APPROVED',
  statusDescription: 'Competency approved',
  nextStep: 'Await card',
  ...over,
});

const parsed = (over: Partial<EnquiryParseResult> = {}): EnquiryParseResult => ({
  updatedOn: '2026-09-24',
  rows: [],
  noRecords: false,
  validationMessage: null,
  ...over,
});

describe('classifyEnquiry — the safety precedence', () => {
  it('prefers a record over everything else on the page', () => {
    // The real page prints the "no records" line in a template that is
    // always present; a record is the answer.
    const v = classifyEnquiry(
      parsed({ rows: [row()], noRecords: true, validationMessage: 'x' }),
    );
    expect(v.outcome).toBe('row');
  });

  it('reports no-records when the page says so and there is no row', () => {
    const v = classifyEnquiry(parsed({ noRecords: true }));
    expect(v).toEqual({
      outcome: 'no_records',
      updatedOn: '2026-09-24',
    });
  });

  it('treats the SAPS validation line as an error, and does NOT alarm', () => {
    // It is a rate-limit / missing-serial state, not a fault of ours.
    const v = classifyEnquiry(
      parsed({ validationMessage: 'Please supply a Serial Number' }),
    );
    expect(v.outcome).toBe('error');
    expect(v).toMatchObject({ alert: false });
  });

  it('calls an unreadable page an error AND an alarm', () => {
    // Matched nothing: a block page, a redesign, or an empty response. This
    // is the one that means we are blind, so it must never read as
    // "SAPS holds nothing".
    const v = classifyEnquiry(parsed());
    expect(v.outcome).toBe('error');
    expect(v).toMatchObject({ alert: true });
  });

  it('never lets an unreadable page become no-records', () => {
    const v = classifyEnquiry(parsed({ noRecords: false }));
    expect(v.outcome).not.toBe('no_records');
  });
});

describe('parseSapsDate', () => {
  it('reads both the slash form SAPS prints and an ISO date', () => {
    expect(parseSapsDate('2025/06/30')?.toISOString()).toBe(
      '2025-06-30T00:00:00.000Z',
    );
    expect(parseSapsDate('2025-06-30')?.toISOString()).toBe(
      '2025-06-30T00:00:00.000Z',
    );
  });

  it('refuses a date that does not exist rather than rolling it forward', () => {
    // new Date(Date.UTC(2025, 1, 31)) is 3 March and does not throw. Storing
    // it would print a day SAPS never said.
    expect(parseSapsDate('2025/02/31')).toBeNull();
    expect(parseSapsDate('2025/02/30')).toBeNull();
  });

  it('is null for anything it cannot read', () => {
    expect(parseSapsDate('')).toBeNull();
    expect(parseSapsDate(null)).toBeNull();
    expect(parseSapsDate('30/06/2025')).toBeNull();
    expect(parseSapsDate('June 2025')).toBeNull();
  });
});

describe('the reference is normalised, then never stored in the clear', () => {
  it('matches the same application however the member typed it', () => {
    const a = hashReference(normaliseReference('c 10 167 347'));
    const b = hashReference(normaliseReference('C10167347'));
    const c = hashReference(normaliseReference('  C10167347  '));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('gives an unguessable digest, not the number itself', () => {
    const h = hashReference('C10167347');
    expect(h).toHaveLength(64);
    expect(h).not.toContain('C10167347');
  });

  it('refuses to hash without the secret rather than hashing weakly', () => {
    const held = process.env.ID_HASH_SECRET;
    delete process.env.ID_HASH_SECRET;
    try {
      expect(() => hashReference('C10167347')).toThrow(/ID_HASH_SECRET/);
    } finally {
      process.env.ID_HASH_SECRET = held;
    }
  });

  it('digests a row, and NEVER the reference or the serial', () => {
    // The digest lands in logs and in an admin alert; a hash that could be
    // brute-forced back to the member's application number would undo the
    // whole point.
    const a = rowSha256(row());
    expect(a).toBe(rowSha256(row()));
    expect(rowSha256(row({ status: 'IN PROGRESS' }))).not.toBe(a);
    expect(rowSha256(row({ nextStep: 'Collect' }))).not.toBe(a);
  });
});

// ─── the service, against a fake store ──────────────────────────────

interface Row_ {
  [k: string]: unknown;
}

class FakeStore {
  trackers: Row_[] = [];
  events: Row_[] = [];
  alerts: Row_[] = [];
  users: Row_[] = [];
  private seq = 0;

  user = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.users.find((u) => u.id === where.id) ?? null,
  };

  trackedApplication = {
    create: async ({ data }: { data: Row_ }) => {
      // The unique index is (userId, referenceHash) — enforced here so the
      // service's P2002 branch is exercised against the real constraint.
      if (
        this.trackers.some(
          (t) =>
            t.userId === data.userId && t.referenceHash === data.referenceHash,
        )
      ) {
        const dup = Object.assign(new Error('unique'), { code: 'P2002' });
        Object.setPrototypeOf(
          dup,
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          require('@prisma/client').Prisma.PrismaClientKnownRequestError
            .prototype,
        );
        throw dup;
      }
      const created = {
        id: `t${++this.seq}`,
        kind: 'COMPETENCY',
        label: null,
        submittedOn: null,
        applicationType: null,
        applicationNumber: null,
        calibre: null,
        make: null,
        serialSeen: null,
        status: null,
        statusDate: null,
        sapsUpdatedOn: null,
        lastCheckedAt: null,
        lastOutcome: 'unknown',
        lastError: null,
        active: true,
        serialEncrypted: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      this.trackers.push(created);
      return created;
    },
    findFirst: async ({ where, include }: Row_ & { where?: Row_ }) => {
      const t = this.trackers.find(
        (x) =>
          (where?.id === undefined || x.id === where.id) &&
          (where?.userId === undefined || x.userId === where.userId),
      );
      if (!t) return null;
      if (include) {
        return { ...t, events: this.eventsFor(String(t.id)) };
      }
      return t;
    },
    findMany: async ({ where }: { where?: Row_ } = {}) =>
      this.trackers.filter(
        (t) => where?.active === undefined || t.active === where.active,
      ),
    update: async ({ where, data }: { where: { id: string }; data: Row_ }) => {
      const t = this.trackers.find((x) => x.id === where.id);
      if (!t) throw new Error('no row');
      Object.assign(t, data);
      return t;
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Row_;
      data: Row_;
    }) => {
      let count = 0;
      for (const t of this.trackers) {
        if (
          (where.id === undefined || t.id === where.id) &&
          (where.userId === undefined || t.userId === where.userId) &&
          (where.active === undefined || t.active === where.active)
        ) {
          Object.assign(t, data);
          count += 1;
        }
      }
      return { count };
    },
    count: async ({ where }: { where?: Row_ } = {}) =>
      this.trackers.filter(
        (t) => where?.active === undefined || t.active === where.active,
      ).length,
  };

  trackedApplicationEvent = {
    create: async ({ data }: { data: Row_ }) => {
      const e = { id: `e${++this.seq}`, observedAt: new Date(), ...data };
      this.events.push(e);
      return e;
    },
    findFirst: async ({
      where,
    }: {
      where: { trackedId: string; source?: string };
    }) => {
      const matching = this.events.filter(
        (e) =>
          e.trackedId === where.trackedId &&
          (where.source === undefined || e.source === where.source),
      );
      return matching[matching.length - 1] ?? null;
    },
    count: async ({ where }: { where: { trackedId: string } }) =>
      this.events.filter((e) => e.trackedId === where.trackedId).length,
  };

  adminAlert = {
    findFirst: async () => null,
    create: async ({ data }: { data: Row_ }) => {
      const a = { id: `a${++this.seq}`, resolved: false, ...data };
      this.alerts.push(a);
      return a;
    },
  };

  setting = { upsert: async () => ({}) };

  eventsFor(trackedId: string): Row_[] {
    return this.events.filter((e) => e.trackedId === trackedId);
  }
}

interface Built {
  svc: LicenceTrackerService;
  store: FakeStore;
  client: { fetch: jest.Mock };
  notifications: { trackedApplicationChanged: jest.Mock };
}

function build(flags: Record<string, unknown> = {}): Built {
  const store = new FakeStore();
  const client = {
    fetch: jest.fn(async () => ({ httpStatus: 200, html: '<html></html>' })),
  };
  const notifications = { trackedApplicationChanged: jest.fn(async () => {}) };
  const values: Record<string, unknown> = {
    [FLAGS.licenceTrackerEnabled.key]: true,
    [FLAGS.licenceTrackerCheckCooldownHours.key]: 6,
    [FLAGS.licenceTrackerSweepMax.key]: 50,
    ...flags,
  };
  const settings = {
    get: jest.fn(async (flag: { key: string; default: unknown }) =>
      flag.key in values ? values[flag.key] : flag.default,
    ),
  };

  const svc = new LicenceTrackerService(
    store as unknown as PrismaService,
    client as never,
    notifications as unknown as NotificationsService,
    settings as unknown as SettingsService,
  );
  // No sleeping in specs; the delay is timing, not behaviour.
  (svc as unknown as { delayMs: number }).delayMs = 0;

  return { svc, store, client, notifications };
}

/**
 * Put a row in the store that already holds a status, so the "a failed poll
 * must not clear it" tests are testing the interesting case rather than a
 * blank row that has nothing to lose.
 */
function seed(
  store: FakeStore,
  over: Row_ = {},
): Row_ {
  const t = {
    id: 't1',
    userId: 'u1',
    kind: 'COMPETENCY',
    label: null,
    referenceEncrypted: '',
    referenceHash: 'h',
    serialEncrypted: null,
    status: 'APPROVED',
    statusDate: new Date('2025-06-30T00:00:00.000Z'),
    sapsUpdatedOn: new Date('2025-06-30T00:00:00.000Z'),
    applicationType: null,
    applicationNumber: null,
    calibre: null,
    make: null,
    serialSeen: null,
    lastCheckedAt: null,
    lastOutcome: 'row',
    lastError: null,
    active: true,
    submittedOn: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
  store.trackers.push(t);
  // A member to notify. Without one the service correctly returns early, and
  // the "did we tell them" assertions would pass for the wrong reason.
  store.users.push({
    id: 'u1',
    email: 'member@example.test',
    firstName: 'Member',
    notifyEmailEnabled: true,
  });
  return t;
}

/** An encrypted reference so `pollAndApply` can get as far as the client. */
function enc(text: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('../common/blob-crypto').encryptText(text);
}

describe('a poll that did not produce a record never clears a known status', () => {
  it('keeps the last status when SAPS could not be reached', async () => {
    const { svc, store, client } = build();
    seed(store, { referenceEncrypted: enc('C00000001') });
    client.fetch.mockRejectedValueOnce(new Error('timed out'));

    const view = await svc.check('u1', 't1');

    expect(view.status).toBe('APPROVED');
    expect(view.lastOutcome).toBe('error');
    expect(view.lastError).toBe('timed out');
  });

  it('keeps the last status when SAPS says it holds no record', async () => {
    const { svc, store, client } = build();
    seed(store, { referenceEncrypted: enc('C00000001') });
    client.fetch.mockResolvedValueOnce({
      httpStatus: 200,
      html: '<div>No records to retrieve</div>',
    });

    const view = await svc.check('u1', 't1');

    // ⚠️ THIS IS THE WHOLE POINT OF `lastOutcome`. A record that fell off the
    // page for an hour has not been un-approved.
    expect(view.status).toBe('APPROVED');
    expect(view.statusDate).toEqual(new Date('2025-06-30T00:00:00.000Z'));
    expect(view.lastOutcome).toBe('no_records');
  });

  it('alerts an operator only when the page is one we cannot read', async () => {
    const unreadable = build();
    seed(unreadable.store, { referenceEncrypted: enc('C00000001') });
    unreadable.client.fetch.mockResolvedValueOnce({
      httpStatus: 200,
      html: '<html><body>403 Forbidden</body></html>',
    });
    await unreadable.svc.check('u1', 't1');
    expect(unreadable.store.alerts).toHaveLength(1);
    expect(unreadable.store.alerts[0]).toMatchObject({
      type: 'SAPS_TRACKER_UNREADABLE',
    });

    // A rate-limit line is a SAPS state, not our fault. No alarm.
    const throttled = build();
    seed(throttled.store, { referenceEncrypted: enc('C00000001') });
    throttled.client.fetch.mockResolvedValueOnce({
      httpStatus: 200,
      html: '<div>Please supply a Serial Number</div>',
    });
    await throttled.svc.check('u1', 't1');
    expect(throttled.store.alerts).toHaveLength(0);
  });

  it('alerts when the handshake failed, because that is a fault of ours', async () => {
    const { svc, store, client } = build();
    seed(store, { referenceEncrypted: enc('C00000001') });
    client.fetch.mockRejectedValueOnce(
      new EnquiryHandshakeError('the enquiry page set no csrf_token cookie'),
    );

    await svc.check('u1', 't1');

    expect(store.alerts).toHaveLength(1);
  });
});

describe('the diff is against the last SAPS observation, not the row', () => {
  const CELLS = {
    applicationType: 'Competency',
    applicationNumber: '10000001',
    calibre: '',
    make: '',
    serialNumber: '',
    statusDate: '2025/06/30',
    status: 'APPROVED',
    statusDescription: 'Competency approved',
    nextStep: 'Await card',
  };
  const html = (over: Partial<typeof CELLS> = {}) => {
    const c = { ...CELLS, ...over };
    const cells = [
      c.applicationType,
      c.applicationNumber,
      c.calibre,
      c.make,
      c.serialNumber,
      c.statusDate,
      c.status,
      c.statusDescription,
      c.nextStep,
    ];
    return `<div class="pagSelMed"><table><tr class="active">${cells
      .map((v) => `<td>${v}</td>`)
      .join('')}</tr></table></div>`;
  };

  it('records a baseline without telling the member anything moved', async () => {
    const { svc, store, client, notifications } = build();
    seed(store, { referenceEncrypted: enc('C00000001') });
    client.fetch.mockResolvedValue({ httpStatus: 200, html: html() });

    await svc.check('u1', 't1');

    expect(store.eventsFor('t1')).toHaveLength(1);
    // The member just added this; telling them it "changed" to the status
    // already on their screen is a notification about nothing.
    expect(notifications.trackedApplicationChanged).not.toHaveBeenCalled();
  });

  it('writes nothing on a second identical poll', async () => {
    const { svc, store, client, notifications } = build();
    seed(store, { referenceEncrypted: enc('C00000001') });
    client.fetch.mockResolvedValue({ httpStatus: 200, html: html() });

    await svc.check('u1', 't1');
    store.trackers[0].lastCheckedAt = null; // step past the cooldown
    await svc.check('u1', 't1');

    expect(store.eventsFor('t1')).toHaveLength(1);
    expect(notifications.trackedApplicationChanged).not.toHaveBeenCalled();
  });

  it('notices a change the tracker row could not see on its own', async () => {
    // ⚠️ SAME `status`, DIFFERENT prose. The tracker has no
    // `statusDescription` column, so a row-only diff would miss this — and it
    // is the commonest real move there is.
    const { svc, store, client, notifications } = build();
    seed(store, { referenceEncrypted: enc('C00000001') });
    client.fetch.mockResolvedValueOnce({ httpStatus: 200, html: html() });
    await svc.check('u1', 't1');

    store.trackers[0].lastCheckedAt = null;
    client.fetch.mockResolvedValueOnce({
      httpStatus: 200,
      html: html({ statusDescription: 'Card ready for collection' }),
    });
    await svc.check('u1', 't1');

    expect(store.eventsFor('t1')).toHaveLength(2);
    expect(notifications.trackedApplicationChanged).toHaveBeenCalledTimes(1);
  });
});

describe('what the enquiry is actually asked', () => {
  it('sends NO serial for a competency', async () => {
    const { svc, store, client } = build();
    seed(store, { kind: 'COMPETENCY', referenceEncrypted: enc('C00000001') });
    await svc.check('u1', 't1');
    expect(client.fetch).toHaveBeenCalledWith('C00000001', null);
  });

  it('sends the serial for a licence', async () => {
    const { svc, store, client } = build();
    seed(store, {
      kind: 'FIREARM_LICENCE',
      referenceEncrypted: enc('10000001'),
      serialEncrypted: enc('ZDEMO0001'),
    });
    await svc.check('u1', 't1');
    expect(client.fetch).toHaveBeenCalledWith('10000001', 'ZDEMO0001');
  });

  it('drops a serial typed against a competency, at the write', async () => {
    // The frontend hides the field for a competency; this is the copy that
    // actually refuses, because a hidden input is not a rule.
    const { svc, store } = build();
    await svc.create('u1', {
      kind: 'COMPETENCY',
      reference: 'C00000001',
      serial: 'ZDEMO0001',
    });
    expect(store.trackers[0].serialEncrypted).toBeNull();
  });
});

describe('the member surface', () => {
  it('refuses a blank reference', async () => {
    const { svc } = build();
    await expect(
      svc.create('u1', { kind: 'COMPETENCY', reference: '   ' }),
    ).rejects.toThrow(/reference/i);
  });

  it('refuses an unknown kind', async () => {
    const { svc } = build();
    await expect(
      svc.create('u1', { kind: 'WILDLIFE_PERMIT', reference: 'X1' }),
    ).rejects.toThrow(/type/i);
  });

  it('answers a duplicate with 409, not a raw Prisma error', async () => {
    const { svc } = build();
    await svc.create('u1', { kind: 'COMPETENCY', reference: 'C00000001' });
    await expect(
      svc.create('u1', { kind: 'COMPETENCY', reference: 'c 00 000 001' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('lets two members track the same reference', async () => {
    const { svc, store } = build();
    await svc.create('u1', { kind: 'COMPETENCY', reference: 'C00000001' });
    await svc.create('u2', { kind: 'COMPETENCY', reference: 'C00000001' });
    expect(store.trackers).toHaveLength(2);
  });

  it('never puts the ciphertext, the hash or the serial bytes on the wire', async () => {
    const { svc } = build();
    const view = await svc.create('u1', {
      kind: 'FIREARM_LICENCE',
      reference: '10000001',
      serial: 'ZDEMO0001',
    });
    expect(view.reference).toBe('10000001');
    expect(view.serial).toBe('ZDEMO0001');
    for (const leak of [
      'referenceEncrypted',
      'referenceHash',
      'serialEncrypted',
    ]) {
      expect(leak in view).toBe(false);
    }
  });

  it('is not enabled at all while the flag is off', async () => {
    const { svc } = build({
      [FLAGS.licenceTrackerEnabled.key]: false,
    });
    await expect(svc.list('u1')).rejects.toThrow();
    await expect(svc.create('u1', { kind: 'COMPETENCY', reference: 'C1' })).rejects.toThrow();
    // …but the status route still answers, or the screen cannot know.
    await expect(svc.status()).resolves.toEqual({ enabled: false });
  });
});

describe('the cooldown is about SAPS, not about the member', () => {
  it('refuses a second check inside the window with 429 and a retry time', async () => {
    const { svc, store } = build();
    seed(store, {
      referenceEncrypted: enc('C00000001'),
      lastCheckedAt: new Date(),
    });

    const err = await svc.check('u1', 't1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    const body = (err as HttpException).getResponse() as { retryAfter: string };
    expect(new Date(body.retryAfter).getTime()).toBeGreaterThan(Date.now());
  });

  it('allows the check once the window has passed', async () => {
    const { svc, store, client } = build();
    seed(store, {
      referenceEncrypted: enc('C00000001'),
      lastCheckedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
    });
    client.fetch.mockResolvedValueOnce({
      httpStatus: 200,
      html: '<div>No records to retrieve</div>',
    });
    await expect(svc.check('u1', 't1')).resolves.toBeTruthy();
  });
});

describe('the flags this module ships behind', () => {
  it('is ON by default, which is an operator decision for local testing', () => {
    // ⚠️ THE ONE FLAG IN THE FEATURE THAT DEFAULTS TRUE. Flip it to `false`
    // before a production deploy.
    expect(FLAGS.licenceTrackerEnabled.default).toBe(true);
    expect(FLAGS.licenceTrackerEnabled.parse('true')).toBe(true);
    expect(FLAGS.licenceTrackerEnabled.parse('')).toBe(false);
  });

  it('leaves the unattended sweep OFF by default', () => {
    expect(FLAGS.licenceTrackerSweepEnabled.default).toBe(false);
    expect(FLAGS.licenceTrackerSweepEnabled.parse('true')).toBe(true);
    expect(FLAGS.licenceTrackerSweepEnabled.parse('1')).toBe(true);
    expect(FLAGS.licenceTrackerSweepEnabled.parse('on')).toBe(false);
  });

  it('clamps the numbers rather than trusting the field', () => {
    const hours = FLAGS.licenceTrackerCheckCooldownHours.parse;
    expect(hours('6')).toBe(6);
    expect(hours('0')).toBe(6);
    expect(hours('-3')).toBe(6);
    expect(hours('banana')).toBe(6);
    expect(hours('99999')).toBe(168);

    const max = FLAGS.licenceTrackerSweepMax.parse;
    expect(max('50')).toBe(50);
    expect(max('0')).toBe(50);
    expect(max('99999')).toBe(500);
  });
});
