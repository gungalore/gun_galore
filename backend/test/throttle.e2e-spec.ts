/**
 * The brute-force caps, with the real guard running.
 *
 * Separate from auth-kyc.e2e-spec.ts because the two want opposite things: a
 * flow test needs the caps out of the way, and this needs them in the way.
 * One module per file is the cheapest way to have both.
 *
 * ⚠️ THIS IS HALF THE PROTECTION, AND THE HALF THAT DOES NOT SURVIVE A DEPLOY.
 * The throttler store is in memory, so every `pm2 reload` resets it — which is
 * exactly why AuthService also counts failures on the User row. The row half
 * is covered in auth-kyc.e2e-spec.ts.
 */

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
delete process.env.DIDIT_API_KEY;

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

let app: INestApplication;
let http: ReturnType<typeof request>;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication({ rawBody: true });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  http = request(app.getHttpServer());
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('the brute-force caps', () => {
  // Each sign-up costs a Didit email credit, so this cap is a spend limit as
  // much as an abuse limit.
  it('stops sign-up at 5 in an hour from one address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await http.post('/api/auth/register').send({
        username: `throttle${i}${Date.now()}`,
        email: `throttle-${i}-${Date.now()}@example.test`,
        password: 'a-long-enough-password-1',
        terms: true,
        privacy: true,
        age: true,
      });
      codes.push(res.status);
    }
    // The sixth and seventh are refused; the first five are not 429.
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes[5]).toBe(429);
    expect(codes[6]).toBe(429);
  }, 60_000);

  it('stops sign-in at 10 a minute from one address', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await http
        .post('/api/auth/login')
        .send({ identifier: 'nobody@example.test', password: 'wrong-password' });
      codes.push(res.status);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    // ⚠️ And the ones before the cap are 401, not 200 — a throttle that only
    // fired after a successful guess would be no protection at all.
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
  }, 60_000);
});
