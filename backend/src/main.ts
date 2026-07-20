// Load .env BEFORE Nest reads any provider. We pass `override: true`
// because some shell environments (Git Bash, Claude Code's terminal,
// PowerShell profiles) export ANTHROPIC_API_KEY / other secrets as an
// EMPTY string. Without override, dotenv sees the var as "already
// defined" and refuses to overwrite — leaving us with empty values
// that crash the Anthropic SDK + flip listings into HUMAN_REVIEW for
// the wrong reason. The .env file is the source of truth here.
import * as dotenv from 'dotenv';
dotenv.config({ override: true });

import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { adminJwtSecret } from './admin/admin-jwt-secret';
import { RetryAfterFilter } from './common/filters/retry-after.filter';

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

  // HARD: admin JWT secret must be a strong, non-default value in prod.
  // adminJwtSecret() throws on missing/empty/default when NODE_ENV=production.
  adminJwtSecret();

  if (!isProd) return;

  // WARN: KYC running against sandbox in production = identity checks pass
  // on canned data. Operator flips VERIFYNOW_MODE=production at launch.
  // (Hard-throw deferred to launch — see decision 2026-06-01.)
  if ((process.env.VERIFYNOW_MODE ?? 'sandbox') !== 'production') {
    log.error(
      '⚠️  VERIFYNOW_MODE is not "production" — KYC identity checks are running against SANDBOX data. Set VERIFYNOW_MODE=production before going live.',
    );
  }
  // WARN: Stitch credentials missing — checkout falls back to mock mode.
  if (!process.env.STITCH_CLIENT_ID || !process.env.STITCH_CLIENT_SECRET) {
    log.error(
      '⚠️  STITCH_CLIENT_ID / STITCH_CLIENT_SECRET not set — checkout runs in MOCK mode (no real payments). Set them before taking payments.',
    );
  }
  // WARN: Stitch webhook secret missing — webhook verification fails closed.
  if (!process.env.STITCH_WEBHOOK_SECRET) {
    log.error(
      '⚠️  STITCH_WEBHOOK_SECRET is not set — incoming Stitch webhooks will be REJECTED (fail-closed). Register the webhook (POST /api/v1/webhook) and set the returned Svix secret before relying on webhooks.',
    );
  }
  // WARN: Clerk webhook secret missing — user.created/updated/deleted sync
  // events arrive UNVERIFIED and are dropped (the handler fails closed and
  // does not process them), so new signups won't land in our DB.
  if (!process.env.CLERK_WEBHOOK_SECRET) {
    log.error(
      '⚠️  CLERK_WEBHOOK_SECRET is not set — incoming Clerk webhooks cannot be verified and will be DROPPED (user sync breaks). Set the Svix signing secret from the Clerk dashboard.',
    );
  }
  // WARN: TCG shipping webhook secret missing — without it the TCG webhook
  // can't authenticate callers; it fails closed in production (rejects).
  if (!process.env.TCG_WEBHOOK_SECRET) {
    log.error(
      '⚠️  TCG_WEBHOOK_SECRET is not set — TCG shipping webhooks will be REJECTED in production (fail-closed). Set the shared secret agreed with The Courier Guy.',
    );
  }
  // WARN (audit fix 2026-07-20): the Anthropic key powers Ask Boet, KYC
  // vision, listing/Q&A moderation, licence + dealer + swap verification.
  // Missing/empty = all of them silently degrade to manual-review/blocked
  // paths. The file-top comment always called this out; now the boot gate
  // actually checks it.
  if (!process.env.ANTHROPIC_API_KEY) {
    log.error(
      '⚠️  ANTHROPIC_API_KEY is not set — ALL AI features (Ask Boet, Claude KYC, moderation, firearm-licence/dealer/swap verification) are degraded to manual-review or blocked paths.',
    );
  }
  if (!process.env.ANTHROPIC_ADMIN_API_KEY) {
    log.error(
      '⚠️  ANTHROPIC_ADMIN_API_KEY is not set — the AI spend monitor on /admin/credits cannot poll usage (no spend alerts).',
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
        // schemes above are valid.
        ...(isProd
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
      callback(ok ? null : new Error(`CORS blocked: ${origin}`), ok);
    },
    credentials: true,
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`Backend running on http://localhost:${port}/api`);
}
bootstrap();
