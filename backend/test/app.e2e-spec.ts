/**
 * The health endpoint — what every uptime monitor and the deploy script hit.
 *
 * ⚠️ THIS FILE USED TO BE THE `nest new` SCAFFOLD, asserting that `GET /`
 * returns "Hello World!". It has been wrong since the global `api` prefix
 * landed, and nobody noticed because nothing invoked the e2e config — there
 * was no `test:e2e` script until the auth cut-over added one. A test nothing
 * runs is not a passing test.
 *
 * It runs against `gun_galore_e2e` for the same reason the other e2e specs do:
 * AppModule wants a real database to boot.
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
process.env.JWT_MEMBER_SECRET = 'e2e-member-secret-not-for-production';
process.env.JWT_ADMIN_SECRET = 'e2e-admin-secret-not-for-production';
process.env.ID_HASH_SECRET = 'e2e-id-hash-secret-not-for-production';

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';

describe('health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // main.ts sets this; without it every route in the app is at the wrong
    // path and this spec would be testing a 404.
    app.setGlobalPrefix('api');
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('answers on /api/health', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(Date.parse(res.body.timestamp)).not.toBeNaN();
  });

  // ⚠️ The deploy script curls this, and a rate-limited health check is a
  // health check that reports the site down under load — which is exactly
  // when somebody is reading it.
  it('is not rate limited', async () => {
    for (let i = 0; i < 70; i++) {
      await request(app.getHttpServer()).get('/api/health').expect(200);
    }
  }, 60_000);

  it('has no route at the un-prefixed root', async () => {
    await request(app.getHttpServer()).get('/').expect(404);
  });
});
