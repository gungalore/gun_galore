/**
 * End-to-end: sign-up, session, password reset, and the KYC pipeline.
 *
 * Runs against a REAL Postgres database — `gun_galore_e2e`, created and
 * migrated separately — because the thing worth proving here is not that the
 * services agree with their mocks. It is that the hand-written migration
 * produces a schema the code can actually use, and that cookies, guards and
 * the webhook behave over real HTTP.
 *
 * ⚠️ THE THROTTLER IS OVERRIDDEN HERE. Sign-up is capped at 5/hour per IP and
 * every request comes from the same loopback address, so the real caps fail
 * the run long before the flow does. throttle.e2e-spec.ts keeps the guard live
 * and asserts the cap instead, so the control is covered — just not in this
 * file.
 *
 * ⚠️ THE KYC POSTS ANSWER 201, NOT 200, and the assertions below say so on
 * purpose. Nest answers a POST with 201 unless the handler carries @HttpCode,
 * and the KYC controller never did — before this change or after it. The auth
 * controller sets 200 explicitly, which is why the two differ. A test that
 * demanded 200 here would get "fixed" by changing the API.
 *
 * ⚠️ DIDIT IS STUBBED, NOT CALLED. With no DIDIT_API_KEY the adapter prints an
 * OTP instead of sending one — see DiditService.stubbed, which cannot be true
 * in production because the boot throws there. So this exercises OUR half of
 * the email/phone flow and the webhook, and NOT the network call to Didit or
 * its hosted page.
 */

// ⚠️ BEFORE THE IMPORTS. AppModule and its providers read these at
// construction, and a value set after the import graph loads is a value the
// app never saw.
process.env.DATABASE_URL = (() => {
  const fs = require('fs') as typeof import('fs');
  const line = fs
    .readFileSync(__dirname + '/../.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='))!;
  const v = line
    .slice('DATABASE_URL='.length)
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\?.*$/, '');
  return v.replace(/\/[^/]+$/, '/gun_galore_e2e') + '?schema=public';
})();
process.env.NODE_ENV = 'test';
process.env.ID_HASH_SECRET = 'e2e-id-hash-secret-not-for-production';
process.env.JWT_MEMBER_SECRET = 'e2e-member-secret-not-for-production';
process.env.JWT_ADMIN_SECRET = 'e2e-admin-secret-not-for-production';
process.env.DIDIT_WEBHOOK_SECRET = 'e2e-didit-webhook-secret';
process.env.FRONTEND_URL = 'http://localhost:3000';
delete process.env.DIDIT_API_KEY;

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { createHmac } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';

const PASSWORD = 'a-long-enough-password-1';
/** Luhn-valid SA test ID, DOB 1980-01-01. */
const ID_NUMBER = '8001015009087';
const DOB = '1980-01-01';

/**
 * A DIFFERENT valid SA ID number each time.
 *
 * ⚠️ NEEDED BECAUSE THE DUP CHECK WORKS. One ID is one account — the hash is
 * unique at the database level — so a suite that reused a single number had
 * every test after the first refused with a 400. That is the rule doing its
 * job, not a fixture problem, and it is asserted on purpose further down.
 *
 * The YYMMDD prefix stays 800101 so the number keeps agreeing with DOB above:
 * the webhook cross-checks the two, and an ID whose digits disagreed with the
 * typed date of birth would park every seller in UNDER_REVIEW.
 */
let idSeq = 0;
function freshIdNumber(): string {
  idSeq += 1;
  // 800101 | SSSS (sequence) | C (citizen) | A | Z (Luhn check)
  const first12 = `800101${String(5000 + idSeq).padStart(4, '0')}08`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let d = Number(first12[11 - i]);
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return first12 + String((10 - (sum % 10)) % 10);
}

let app: INestApplication;
let prisma: PrismaService;
let auth: AuthService;
let http: ReturnType<typeof request>;

/** Cookie jar — supertest does not keep one across agents. */
function cookiesFrom(res: request.Response): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}
function cookieHeader(jar: string[]): string {
  return jar.map((c) => c.split(';')[0]).join('; ');
}
function cookieValue(jar: string[], name: string): string | undefined {
  const hit = jar.find((c) => c.startsWith(`${name}=`));
  if (!hit) return undefined;
  const v = hit.split(';')[0].slice(name.length + 1);
  return v.length ? v : undefined;
}

/**
 * The EMAIL code, which is ours again rather than the identity provider's.
 *
 * ⚠️ Read from AuthService, not from the Didit adapter — email verification
 * moved back in-house on 2026-09-11 and is delivered by Resend. With no
 * RESEND_API_KEY in the test env the service prints the code and records it
 * here, which is the same fallback that lets a fresh clone sign up at all.
 */
function emailCode(to: string): string {
  const code = auth.devEmailCode(to);
  if (!code) throw new Error(`no dev email code for ${to}`);
  return code;
}

let seq = 0;
function freshUser() {
  seq += 1;
  return {
    username: `e2euser${seq}`,
    email: `e2e-${seq}@example.test`,
    password: PASSWORD,
  };
}

async function registerAndVerify(user = freshUser()) {
  await http
    .post('/api/auth/register')
    .send({ ...user, terms: true, privacy: true, age: true })
    .expect(200);
  const res = await http
    .post('/api/auth/verify-email')
    .send({ email: user.email, code: emailCode(user.email) })
    .expect(200);
  return { user, jar: cookiesFrom(res), body: res.body };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // ⚠️ THE STORAGE, NOT THE GUARD. Two more obvious spellings do nothing
    // here, and both fail silently by leaving the real limiter running:
    // overrideGuard(ThrottlerGuard) only reaches guards attached with
    // @UseGuards, and overrideProvider(APP_GUARD) does not swap an enhancer
    // that was already registered at module scan. The guard injects its
    // storage, so replacing that is what actually lands — a counter that
    // never counts.
    .overrideProvider(ThrottlerStorage)
    .useValue({
      increment: async () => ({
        totalHits: 1,
        timeToExpire: 60,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
    })
    .compile();

  // rawBody is what the webhook signature is computed over; main.ts sets it
  // on the real app and the test app has to match or every delivery fails.
  app = moduleRef.createNestApplication({ rawBody: true });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  await app.init();

  prisma = app.get(PrismaService);
  auth = app.get(AuthService);
  http = request(app.getHttpServer());

  // A clean slate per run, so a re-run is not a different test.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "User" CASCADE');
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('sign-up', () => {
  it('creates an unverified account and does not hand back a session', async () => {
    const user = freshUser();
    const res = await http
      .post('/api/auth/register')
      .send({ ...user, terms: true, privacy: true, age: true })
      .expect(200);

    expect(res.body).toEqual({ email: user.email, next: 'verify-email' });
    expect(cookiesFrom(res)).toHaveLength(0);

    const row = await prisma.user.findUnique({ where: { email: user.email } });
    expect(row?.emailVerifiedAt).toBeNull();
    expect(row?.usernameLower).toBe(user.username.toLowerCase());
    // The credential is hashed, and recognisably by bcrypt.
    expect(row?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(row?.passwordHash).not.toContain(PASSWORD);
    // Consent is written in the same transaction as the account.
    expect(row?.termsAcceptedAt).toBeInstanceOf(Date);
  });

  it('refuses to sign in until the email is proved', async () => {
    const user = freshUser();
    await http
      .post('/api/auth/register')
      .send({ ...user, terms: true, privacy: true, age: true })
      .expect(200);

    const res = await http
      .post('/api/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(403);
    expect(res.body.code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('rejects a wrong code and accepts the right one', async () => {
    const user = freshUser();
    await http
      .post('/api/auth/register')
      .send({ ...user, terms: true, privacy: true, age: true })
      .expect(200);

    await http
      .post('/api/auth/verify-email')
      .send({ email: user.email, code: '000000' })
      .expect(400);

    const res = await http
      .post('/api/auth/verify-email')
      .send({ email: user.email, code: emailCode(user.email) })
      .expect(200);

    const jar = cookiesFrom(res);
    // ⚠️ httpOnly on both, or an XSS reads the session.
    expect(jar.find((c) => c.startsWith('ao_at='))).toMatch(/HttpOnly/i);
    expect(jar.find((c) => c.startsWith('ao_rt='))).toMatch(/HttpOnly/i);
    // The refresh cookie is scoped so it rides only the auth routes.
    expect(jar.find((c) => c.startsWith('ao_rt='))).toMatch(/Path=\/api\/auth/i);
    expect(res.body.accessToken).toBeTruthy();
  });

  it('refuses a username somebody already holds, case-insensitively', async () => {
    const { user } = await registerAndVerify();
    const clash = freshUser();
    await http
      .post('/api/auth/register')
      .send({
        ...clash,
        username: user.username.toUpperCase(),
        terms: true,
        privacy: true,
        age: true,
      })
      .expect(409);
  });
});

describe('sign-in', () => {
  it('accepts the email or the username, and sets a session', async () => {
    const { user } = await registerAndVerify();

    for (const identifier of [user.email, user.username.toUpperCase()]) {
      const res = await http
        .post('/api/auth/login')
        .send({ identifier, password: user.password })
        .expect(200);
      expect(cookieValue(cookiesFrom(res), 'ao_at')).toBeTruthy();
    }
  });

  it('gives the same answer for a wrong password and a missing account', async () => {
    const { user } = await registerAndVerify();
    const a = await http
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'wrong-password-entirely' })
      .expect(401);
    const b = await http
      .post('/api/auth/login')
      .send({ identifier: 'nobody@example.test', password: PASSWORD })
      .expect(401);
    expect(a.body.message).toBe(b.body.message);
  });

  // ⚠️ The counter is on the row precisely because the throttler is not
  // enough — its store is in-memory and every pm2 reload clears it.
  it('locks the account after repeated failures', async () => {
    const { user } = await registerAndVerify();
    for (let i = 0; i < 8; i++) {
      await http
        .post('/api/auth/login')
        .send({ identifier: user.email, password: 'wrong-password-entirely' })
        .expect(401);
    }
    const row = await prisma.user.findUnique({ where: { email: user.email } });
    expect(row?.failedLoginCount).toBe(8);
    expect(row?.lockedUntil).toBeInstanceOf(Date);

    // The RIGHT password is refused too, while the lock holds.
    await http
      .post('/api/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(401);
  });

  it('clears the counter on a good sign-in', async () => {
    const { user } = await registerAndVerify();
    await http
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'wrong-password-entirely' })
      .expect(401);
    await http
      .post('/api/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(200);
    const row = await prisma.user.findUnique({ where: { email: user.email } });
    expect(row?.failedLoginCount).toBe(0);
    expect(row?.lockedUntil).toBeNull();
  });
});

describe('the session', () => {
  it('answers /auth/me from the cookie alone, with no bearer header', async () => {
    const { user, jar } = await registerAndVerify();
    const res = await http
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(jar))
      .expect(200);
    expect(res.body.email).toBe(user.email);
    expect(res.body.username).toBe(user.username);
    // ⚠️ Never the hash, on any surface.
    expect(res.body.passwordHash).toBeUndefined();
  });

  it('refuses an anonymous caller', async () => {
    await http.get('/api/auth/me').expect(401);
  });

  it('rotates the refresh token, and the old one still works briefly', async () => {
    const { jar } = await registerAndVerify();
    const first = cookieValue(jar, 'ao_rt')!;

    const a = await http
      .post('/api/auth/refresh')
      .set('Cookie', cookieHeader(jar))
      .send({})
      .expect(200);
    const second = cookieValue(cookiesFrom(a), 'ao_rt')!;
    expect(second).not.toBe(first);

    // ⚠️ THE GRACE WINDOW. A second tab that woke at the same moment still
    // holds the FIRST token. Without this it is signed out.
    const b = await http
      .post('/api/auth/refresh')
      .set('Cookie', `ao_rt=${first}`)
      .send({})
      .expect(200);
    expect(b.body.accessToken).toBeTruthy();
  });

  it('signs out, and the refreshed session stops working', async () => {
    const { jar } = await registerAndVerify();
    const rt = cookieValue(jar, 'ao_rt')!;

    const out = await http
      .post('/api/auth/logout')
      .set('Cookie', cookieHeader(jar))
      .expect(200);
    // Both cookies cleared.
    for (const name of ['ao_at', 'ao_rt']) {
      expect(cookiesFrom(out).some((c) => c.startsWith(`${name}=;`))).toBe(true);
    }

    await http
      .post('/api/auth/refresh')
      .set('Cookie', `ao_rt=${rt}`)
      .send({})
      .expect(401);
  });
});

describe('passwords', () => {
  it('never reveals whether an address has an account', async () => {
    const { user } = await registerAndVerify();
    const known = await http
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);
    const unknown = await http
      .post('/api/auth/forgot-password')
      .send({ email: 'nobody-at-all@example.test' })
      .expect(200);
    expect(known.body).toEqual(unknown.body);
  });

  it('resets from the emailed token and kills every existing session', async () => {
    const { user, jar } = await registerAndVerify();

    await http
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    const row = await prisma.user.findUnique({ where: { email: user.email } });
    const token = await prisma.actionToken.findFirst({
      where: { authorisedUserId: row!.id, purpose: 'PASSWORD_RESET' },
      orderBy: { createdAt: 'desc' },
    });
    expect(token).toBeTruthy();

    const next = 'a-different-long-password-2';
    await http
      .post('/api/auth/reset-password')
      .send({ token: token!.token, password: next })
      .expect(200);

    // The session that existed before the reset is gone.
    await http
      .post('/api/auth/refresh')
      .set('Cookie', `ao_rt=${cookieValue(jar, 'ao_rt')}`)
      .send({})
      .expect(401);

    // Old password refused, new one accepted.
    await http
      .post('/api/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(401);
    await http
      .post('/api/auth/login')
      .send({ identifier: user.email, password: next })
      .expect(200);

    // Single use.
    await http
      .post('/api/auth/reset-password')
      .send({ token: token!.token, password: 'yet-another-password-3' })
      .expect(400);
  });

  it('requires the current password to change it, and signs other devices out', async () => {
    const { user, jar } = await registerAndVerify();
    // A second device.
    const other = await http
      .post('/api/auth/login')
      .send({ identifier: user.email, password: user.password })
      .expect(200);

    await http
      .post('/api/auth/change-password')
      .set('Cookie', cookieHeader(jar))
      .send({ currentPassword: 'not-it', newPassword: 'a-new-long-password-9' })
      .expect(400);

    await http
      .post('/api/auth/change-password')
      .set('Cookie', cookieHeader(jar))
      .send({
        currentPassword: user.password,
        newPassword: 'a-new-long-password-9',
      })
      .expect(200);

    await http
      .post('/api/auth/refresh')
      .set('Cookie', `ao_rt=${cookieValue(cookiesFrom(other), 'ao_rt')}`)
      .send({})
      .expect(401);
  });
});

describe('KYC', () => {
  async function verifiedSeller() {
    const { user, jar } = await registerAndVerify();
    const row = await prisma.user.findUnique({ where: { email: user.email } });
    return {
      user,
      jar,
      id: row!.id,
      auth: cookieHeader(jar),
      idNumber: freshIdNumber(),
    };
  }

  it('walks consent → details and reports the next step each time', async () => {
    const { auth, idNumber } = await verifiedSeller();

    let s = await http.get('/api/kyc/status').set('Cookie', auth).expect(200);
    expect(s.body.nextStep).toBe('consent');

    await http.post('/api/kyc/consent').set('Cookie', auth).send({}).expect(201);
    s = await http.get('/api/kyc/status').set('Cookie', auth).expect(200);
    expect(s.body.nextStep).toBe('details');

    await http
      .post('/api/kyc/details')
      .set('Cookie', auth)
      .send({ idNumber, dob: DOB })
      .expect(201);
    s = await http.get('/api/kyc/status').set('Cookie', auth).expect(200);
    expect(s.body.nextStep).toBe('verify');
    expect(s.body.steps).toEqual({
      consent: true,
      details: true,
      verification: false,
    });
  });

  it('refuses details before consent', async () => {
    const { auth, idNumber } = await verifiedSeller();
    await http
      .post('/api/kyc/details')
      .set('Cookie', auth)
      .send({ idNumber, dob: DOB })
      .expect(403);
  });

  it('refuses an ID number that fails the Luhn check', async () => {
    const { auth } = await verifiedSeller();
    await http.post('/api/kyc/consent').set('Cookie', auth).send({}).expect(201);
    await http
      .post('/api/kyc/details')
      .set('Cookie', auth)
      .send({ idNumber: '8001015009088', dob: DOB })
      .expect(400);
  });

  // ⚠️ ONE ID = ONE ACCOUNT, and this is the ONE test that deliberately hands
  // the same number to two members. Every other test mints its own, because
  // this rule is enforced by a unique index and a shared fixture would make
  // the rest of the suite fail for the right reason at the wrong moment.
  it('refuses an ID number already linked to another account', async () => {
    const shared = freshIdNumber();
    const a = await verifiedSeller();
    await http.post('/api/kyc/consent').set('Cookie', a.auth).send({}).expect(201);
    await http
      .post('/api/kyc/details')
      .set('Cookie', a.auth)
      .send({ idNumber: shared, dob: DOB })
      .expect(201);

    const b = await verifiedSeller();
    await http.post('/api/kyc/consent').set('Cookie', b.auth).send({}).expect(201);
    await http
      .post('/api/kyc/details')
      .set('Cookie', b.auth)
      .send({ idNumber: shared, dob: DOB })
      .expect(400);
  });

  it('stores the ID as a hash and encrypted, never in the clear', async () => {
    const { auth, id, idNumber } = await verifiedSeller();
    await http.post('/api/kyc/consent').set('Cookie', auth).send({}).expect(201);
    await http
      .post('/api/kyc/details')
      .set('Cookie', auth)
      .send({ idNumber, dob: DOB })
      .expect(201);

    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.kycIdHash).toBeTruthy();
    expect(row?.kycIdHash).not.toContain(idNumber);
    expect(row?.idNumberEncrypted).toBeTruthy();
    expect(row?.idNumberEncrypted).not.toContain(idNumber);
    expect(row?.kycStatus).toBe('PENDING');
    expect(row?.kycMethod).toBe('DIDIT');
  });
});

describe('the Didit webhook', () => {
  const SECRET = 'e2e-didit-webhook-secret';

  async function sellerWithSession() {
    const { user, jar } = await registerAndVerify();
    const auth = cookieHeader(jar);
    const row = await prisma.user.findUnique({ where: { email: user.email } });
    const idNumber = freshIdNumber();
    await http.post('/api/kyc/consent').set('Cookie', auth).send({}).expect(201);
    await http
      .post('/api/kyc/details')
      .set('Cookie', auth)
      .send({ idNumber, dob: DOB })
      .expect(201);

    // The hosted session would normally be created by POST /kyc/session, which
    // needs a real Didit key. The row it writes is what the webhook keys on,
    // so it is inserted directly here — everything downstream is ours.
    const sessionId = `e2e-sess-${row!.id}`;
    await prisma.diditVerification.create({
      data: {
        userId: row!.id,
        diditSessionId: sessionId,
        workflowId: 'e2e-workflow',
        status: 'In Progress',
      },
    });
    return { id: row!.id, sessionId, auth, idNumber };
  }

  function deliver(body: object, opts: { secret?: string; skew?: number } = {}) {
    const raw = JSON.stringify(body);
    const ts = Math.floor(Date.now() / 1000) + (opts.skew ?? 0);
    const sig = createHmac('sha256', opts.secret ?? SECRET)
      .update(raw)
      .digest('hex');
    return http
      .post('/api/webhooks/didit')
      .set('Content-Type', 'application/json')
      .set('x-timestamp', String(ts))
      .set('x-signature', sig)
      .send(raw);
  }

  function envelope(sessionId: string, status: string, idNum: string) {
    return {
      webhook_type: 'status.updated',
      session_id: sessionId,
      status,
      vendor_data: 'e2e',
      decision: {
        session_id: sessionId,
        status,
        id_verifications: [
          {
            status,
            personal_number: idNum,
            first_name: 'GERHARD',
            last_name: 'FOURIE',
            date_of_birth: DOB,
          },
        ],
        face_matches: [{ status: 'Approved', score: 92 }],
      },
    };
  }

  it('verifies the seller on Approved', async () => {
    const { id, sessionId, idNumber } = await sellerWithSession();
    await deliver(envelope(sessionId, 'Approved', idNumber)).expect(200);

    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.kycStatus).toBe('VERIFIED');
    expect(row?.kycVerifiedAt).toBeInstanceOf(Date);
    // The name came off the document Didit read.
    expect(row?.firstName).toBe('GERHARD');
  });

  it('is idempotent — a redelivery does not burn a second attempt', async () => {
    const { id, sessionId, idNumber } = await sellerWithSession();
    await deliver(envelope(sessionId, 'Approved', idNumber)).expect(200);
    const first = await prisma.user.findUnique({ where: { id } });

    await deliver(envelope(sessionId, 'Approved', idNumber)).expect(200);
    const second = await prisma.user.findUnique({ where: { id } });

    expect(second?.kycAttempts).toBe(first?.kycAttempts);
    expect(second?.kycVerifiedAt).toEqual(first?.kycVerifiedAt);
  });

  // ⚠️ The half Didit cannot do. It proves the document is genuine, not that
  // it belongs to the person holding this account.
  it('parks an Approved session for review when the document is another person', async () => {
    const { id, sessionId, idNumber } = await sellerWithSession();
    await deliver(envelope(sessionId, 'Approved', '9202204720082')).expect(200);

    const row = await prisma.user.findUnique({ where: { id } });
    expect(row?.kycStatus).toBe('UNDER_REVIEW');
  });

  it('rejects on Declined', async () => {
    const { id, sessionId, idNumber } = await sellerWithSession();
    await deliver(envelope(sessionId, 'Declined', idNumber)).expect(200);
    expect((await prisma.user.findUnique({ where: { id } }))?.kycStatus).toBe(
      'REJECTED',
    );
  });

  it('parks In Review rather than guessing', async () => {
    const { id, sessionId, idNumber } = await sellerWithSession();
    await deliver(envelope(sessionId, 'In Review', idNumber)).expect(200);
    expect((await prisma.user.findUnique({ where: { id } }))?.kycStatus).toBe(
      'UNDER_REVIEW',
    );
  });

  // ⚠️ 200 WITH THE HANDLER SKIPPED, never a 401 — the house convention. The
  // status must be unchanged.
  it('answers 200 and changes nothing on a bad signature', async () => {
    const { id, sessionId, idNumber } = await sellerWithSession();
    await deliver(envelope(sessionId, 'Approved', idNumber), {
      secret: 'not-the-secret',
    }).expect(200);
    expect((await prisma.user.findUnique({ where: { id } }))?.kycStatus).toBe(
      'PENDING',
    );
  });

  it('answers 200 and changes nothing on a stale timestamp', async () => {
    const { id, sessionId, idNumber } = await sellerWithSession();
    await deliver(envelope(sessionId, 'Approved', idNumber), { skew: -400 }).expect(200);
    expect((await prisma.user.findUnique({ where: { id } }))?.kycStatus).toBe(
      'PENDING',
    );
  });

  it('shrugs at a session it has never seen', async () => {
    await deliver(envelope('no-such-session', 'Approved', ID_NUMBER)).expect(200);
  });
});
