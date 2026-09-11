// Load .env BEFORE Nest reads any provider. We pass `override: true`
// because some shell environments (Git Bash, Claude Code's terminal,
// PowerShell profiles) export ANTHROPIC_API_KEY / other secrets as an
// EMPTY string. Without override, dotenv sees the var as "already
// defined" and refuses to overwrite — leaving us with empty values
// that crash the Anthropic SDK + flip listings into HUMAN_REVIEW for
// the wrong reason. The .env file is the source of truth here.
import * as dotenv from 'dotenv';
dotenv.config({ override: true });

// ─── Prefer IPv4 for ALL outbound connections ─────────────────────────
// This VPS has NO global IPv6 address. Apple's Web Push endpoint
// (web.push.apple.com) — and other Akamai/Apple hosts — advertise AAAA
// (IPv6) records, and Node 20's happy-eyeballs (autoSelectFamily, on by
// default) was racing an IPv6 connection that can only hang → ETIMEDOUT.
// That silently broke iOS push notifications (offers, sales, etc.) while
// IPv4-only hosts kept working. Force IPv4-first + disable the parallel
// family auto-select so we connect straight to the reachable IPv4 address.
import * as dns from 'node:dns';
import * as net from 'node:net';
dns.setDefaultResultOrder('ipv4first');
(
  net as { setDefaultAutoSelectFamily?: (v: boolean) => void }
).setDefaultAutoSelectFamily?.(false);

import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import cookieParser from 'cookie-parser';
import { adminJwtSecret } from './admin/admin-jwt-secret';
import { memberJwtSecret } from './auth/member-jwt-secret';
import { RetryAfterFilter } from './common/filters/retry-after.filter';
import {
  BLOB_CRYPTO_SECRET_ENV,
  blobCryptoConfigured,
} from './common/blob-crypto';

/**
 * Fail-closed production config gate. Runs after dotenv has loaded .env.
 * HARD failures (throw → process exits, pm2 surfaces it) for anything
 * that silently downgrades security. WARN-only (loud, but boots) for
 * launch-readiness items the operator flips on at go-live so a deploy
 * never takes prod down before those credentials are wired.
 */
function assertProductionConfig() {
  const log = new Logger('Bootstrap');
  const isProd = process.env.NODE_ENV === 'production';

  // HARD: both session secrets must be strong, non-default values in prod.
  // Each throws on missing/empty/default when NODE_ENV=production, so a
  // misconfigured box fails at boot rather than on the first sign-in.
  //
  // ⚠️ TWO SECRETS, AND THEY MUST DIFFER. A member token signed with the
  // admin key verifies on an admin route.
  adminJwtSecret();
  memberJwtSecret();

  if (!isProd) return;

  // ⚠️ THE SANDBOX-IN-PRODUCTION WARNING IS NOW A HARD THROW, and it lives
  // in DiditService.onModuleInit rather than here. The old provider only
  // LOGGED this, which meant a production box could boot with sandbox
  // identity checks — every identity passing on canned data, with nobody
  // finding out until it mattered. Do not re-add a warning here; a second,
  // softer copy of the same gate is how the hard one gets deleted.
  // WARN: Peach credentials missing — checkout falls back to mock mode.
  if (
    !process.env.PEACH_CLIENT_ID ||
    !process.env.PEACH_CLIENT_SECRET ||
    !process.env.PEACH_ENTITY_ID ||
    !process.env.PEACH_SECRET
  ) {
    log.error(
      '⚠️  PEACH_CLIENT_ID / PEACH_CLIENT_SECRET / PEACH_MERCHANT_ID / PEACH_ENTITY_ID / PEACH_SECRET not all set — Peach checkout runs in MOCK mode (no real payments). Set them (+ PEACH_ENV=live and PAYMENT_MODE=paygate, PAYMENTS_LIVE=true) before taking payments.',
    );
  }
  // WARN: Peach webhook signing secret missing — webhook verification fails closed.
  if (!process.env.PEACH_SECRET) {
    log.error(
      '⚠️  PEACH_SECRET is not set — incoming Peach webhooks will be REJECTED (fail-closed). Set the webhook signing secret from the Peach Dashboard before relying on webhooks.',
    );
  }
  // NOTE: Peach Payouts + bank-account verification (BANV) ride the same
  // PEACH_CLIENT_ID/SECRET/MERCHANT_ID OAuth creds warned about above —
  // until those are set, run-payouts logs intent only and BANV is skipped
  // (the manual admin bank-ownership review remains the payout gate).
  // WARN: Didit webhook secret missing — verification outcomes arrive
  // UNVERIFIED and are dropped, so a seller who finishes on Didit's page
  // stays PENDING forever with nothing in any log saying why.
  if (!process.env.DIDIT_WEBHOOK_SECRET) {
    log.error(
      '⚠️  DIDIT_WEBHOOK_SECRET is not set — incoming Didit webhooks cannot be verified and will be DROPPED (seller verification never completes). Copy the destination secret from the Didit console.',
    );
  }
  // WARN (audit fix 2026-07-20; repointed at Gemini 2026-09-07): the model
  // key powers Ask Boet, KYC vision, listing/Q&A moderation, licence +
  // dealer + swap verification. Missing/empty = all of them silently degrade
  // to manual-review/blocked paths. The file-top comment always called this
  // out; the boot gate actually checks it.
  //
  // ⚠️ The gate follows LLM_PROVIDER, because warning about the key of a
  // provider that is not running is worse than not warning at all — it
  // trains the operator to ignore the line that matters. Gemini is the
  // provider (operator, 2026-09-07); anthropic is the rollback lever, and it
  // needs LLM_MODEL as well since no Anthropic model id is ever guessed.
  if (process.env.LLM_PROVIDER === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) {
      log.error(
        '⚠️  LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set — ALL AI features (Ask Boet, KYC, moderation, firearm-licence/dealer/swap verification) are degraded to manual-review or blocked paths.',
      );
    }
    if (!process.env.LLM_MODEL) {
      log.error(
        '⚠️  LLM_PROVIDER=anthropic but LLM_MODEL is not set — no Anthropic model id is guessed (snapshots retire), so every AI call fails as not_configured. Set LLM_MODEL to a current snapshot.',
      );
    }
  } else if (!process.env.GEMINI_API_KEY) {
    log.error(
      '⚠️  GEMINI_API_KEY is not set — ALL AI features (Ask Boet, KYC, moderation, firearm-licence/dealer/swap verification) are degraded to manual-review or blocked paths.',
    );
  }
  // WARN: ID_HASH_SECRET keys BOTH sensitive-data paths, and they fail in
  // OPPOSITE directions, which is what makes a missing value hard to notice.
  //
  //   id-crypto / blob-crypto  THROW at first use — encrypted SA IDs and the
  //                            motivation writer's stored ID scans 500.
  //   kyc.service              falls back to a hardcoded salt, so ID hashes
  //                            are computed and stored happily, and every one
  //                            of them stops matching the moment the real
  //                            secret is set.
  //
  // So "KYC still works" is NOT evidence the secret is configured. This check
  // exists because blob-crypto.ts said main.ts carried it before it did, and
  // the replatform is known to have left environment variables behind.
  if (!blobCryptoConfigured()) {
    log.error(
      `⚠️  ${BLOB_CRYPTO_SECRET_ENV} is not set — encrypted SA ID numbers and stored identity documents will FAIL, and KYC ID hashes will be written under a fallback salt that never matches once it is set. Nothing recovers data written in this state.`,
    );
  }
}

async function bootstrap() {
  // Fail-closed config gate — throws on dangerous misconfig (e.g. missing
  // admin secret) before the server starts accepting traffic.
  assertProductionConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // Trust the single nginx reverse-proxy hop in front of us so Express
  // derives req.ip from the FIRST X-Forwarded-For entry (the real client)
  // rather than nginx's loopback address. Without this, @nestjs/throttler
  // keys EVERY request to nginx's IP — collapsing all per-route rate
  // limits into one global bucket (no real throttling on auth, KYC,
  // action-tokens, or the paid AI endpoints). Fixed hop count (1), not
  // `true`, so a client can't spoof X-Forwarded-For to dodge limits.
  app.set('trust proxy', 1);

  // Bump the JSON body limit so the /listings/preview endpoint can accept
  // up to 5 base64-encoded photos for vision moderation. Each photo runs
  // ~1-2 MB base64; 15 MB gives us headroom for 5x large iPhone JPEGs.
  // Same limit applies to urlencoded bodies so the rare form-encoded
  // caller doesn't hit a different ceiling.
  app.useBodyParser('json', { limit: '15mb' });
  app.useBodyParser('urlencoded', { limit: '15mb', extended: true });

  // ⚠️ WITHOUT THIS, req.cookies DOES NOT EXIST and every cookie-carried
  // session silently reads as signed-out. Express's res.cookie() needs no
  // middleware, which is why the write half of the admin cookie worked for
  // months while nothing ever read it back.
  app.use(cookieParser());

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Global 429 Retry-After header (RFC 7231 §7.1.3). Covers throttler
  // ThrottlerException AND our custom HttpException 429s (e.g. Ask GG
  // fair-use cap). Without this, naive HTTP clients ignore the JSON
  // `retryAfterSec` and retry immediately, defeating fair-use.
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new RetryAfterFilter(httpAdapter));

  const corsLog = new Logger('CORS');

  // CORS — allow the configured production FRONTEND_URL plus any
  // localhost port for local development (next dev → 3000, prod
  // testing builds → typically 3002 or whatever we pick), PLUS the
  // Capacitor app schemes (capacitor:// on iOS, ionic:// on Android
  // legacy, https://localhost as some Android Capacitor builds use).
  // Function form lets us validate at request time without hard-
  // coding ports.
  app.enableCors({
    origin: (origin, callback) => {
      // Same-origin / curl / Postman → no Origin header → allow.
      if (!origin) return callback(null, true);
      const isProd = process.env.NODE_ENV === 'production';
      /**
       * Let a developer's machine talk to THIS server.
       *
       * ⚠️ OFF UNLESS THE SERVER'S OWN .env TURNS IT ON, AND IT MUST GO OFF
       * BEFORE REAL MEMBERS ARRIVE. With this set, any process on any machine
       * that can reach the API may make CREDENTIALED requests to it from a
       * localhost page — which is exactly the hole the production branch below
       * exists to close.
       *
       * It is here because the site is not carrying real members yet and the
       * alternative was worse: the Document Centre could not be exercised
       * against a real server at all. A developer's browser on localhost:3000
       * was refused by CORS, their local backend was not running, and its
       * database was 25 migrations behind — so every scan uploaded into
       * nothing, silently, and the documents simply never appeared.
       *
       * A flag rather than a code change, so switching it off at launch is one
       * line in the server's .env and needs no deploy of this file — and so
       * that it is VISIBLE in configuration instead of buried in a boolean
       * here. Default stays refuse: an unset variable behaves exactly as
       * before.
       *
       * ⚠️ REMOVE THIS WITH THE FIRST REAL SIGN-UP. See LAUNCH-CHECKLIST.md.
       */
      const allowLocalInProd = process.env.ALLOW_LOCAL_ORIGINS === 'true';
      const allowed = [
        process.env.FRONTEND_URL,
        // Capacitor (Hunt Ballistics iOS app + future Android). Each
        // platform serves the bundled web app under a custom scheme:
        //   iOS:     capacitor://localhost
        //   Android: https://localhost (or capacitor:// in newer Cap)
        //   legacy:  ionic://localhost
        // These are first-party app shells and must be trusted in prod too.
        /^capacitor:\/\/localhost$/,
        /^ionic:\/\/localhost$/,
        // Local dev / LAN origins are DEV-ONLY — never trusted (with
        // credentials) in production, where only FRONTEND_URL + the app
        // schemes above are valid. ALLOW_LOCAL_ORIGINS is the deliberate,
        // temporary exception while the site carries no real members; see the
        // note on it above.
        ...(isProd && !allowLocalInProd
          ? []
          : [
              /^https?:\/\/localhost(:\d+)?$/,
              /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
              /^https?:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
            ]),
      ].filter(Boolean);
      const ok = allowed.some((rule) =>
        rule instanceof RegExp ? rule.test(origin) : rule === origin,
      );
      if (ok) {
        callback(null, true);
        return;
      }
      // A disallowed origin is a REJECTED REQUEST, not a server fault.
      //
      // Passing an Error here propagates to Nest's ExceptionsHandler, which
      // logs it at ERROR and answers 500 — so a browser calling from the wrong
      // origin reads in the logs exactly like the API crashing, and it drowns
      // real faults. A stale tab polling once a minute filled hours of error
      // log this way before anyone looked at what was actually calling.
      //
      // Deny by returning `false` with no error: the browser still blocks the
      // request (no Access-Control-Allow-Origin header is sent, which is the
      // whole enforcement mechanism), but our logs stay honest. Logged at WARN
      // with the origin so a genuine misconfiguration is still discoverable.
      corsLog.warn(`CORS denied for origin: ${origin}`);
      callback(null, false);
    },
    credentials: true,
    /**
     * ⚠️ WITHOUT THIS, `Retry-After` IS INVISIBLE TO CROSS-ORIGIN CALLERS and
     * `res.headers.get('Retry-After')` returns null with no error. CORS only
     * exposes a handful of simple response headers by default; everything
     * else has to be named here.
     *
     * The web app is same-origin in production (nginx proxies /api/), so it
     * could always read it — but the CAPACITOR SHELLS are cross-origin, and
     * so is any developer running the frontend locally against this API.
     * `authErrorMessage()` in the frontend uses the value to tell a
     * rate-limited member how long to wait; without the header it can only
     * say "in a few minutes", on the two surfaces where it is hardest to
     * debug why.
     */
    exposedHeaders: ['Retry-After'],
  });

  // ⚠️ SAID EVERY BOOT, AT WARN, SO IT CANNOT BE FORGOTTEN. A temporary hole
  // that nobody is reminded of is a permanent hole.
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ALLOW_LOCAL_ORIGINS === 'true'
  ) {
    corsLog.warn(
      'ALLOW_LOCAL_ORIGINS=true — this PRODUCTION server is accepting ' +
        'credentialed requests from localhost and LAN origins. Intended only ' +
        'while the site carries no real members. Unset it before launch.',
    );
  }

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}/api`);
}
bootstrap();
