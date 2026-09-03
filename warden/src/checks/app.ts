// warden/src/checks/app.ts
//
// The application-level facts: which money and identity gates are open,
// whether any courier booking is stuck half-made, and how deep the four
// human queues are.
//
// ⚠️ THE COURIER CHECK IS THE ONE WITH TEETH. Every Bob Go booking starts
// UNCONFIRMED: shipmentBookingStartedAt is an idempotency claim taken
// before the call, shipmentBookedAt is the confirmation after it. A row
// with the first and neither of the other two is a booking that was
// claimed and never confirmed — the exact state the "branch on submission,
// never on 'it didn't throw'" rule is about. Seconds-old rows are normal;
// ten-minute-old ones are a carrier call that never came back.

import type { CheckModule, CheckOutcome, Evidence } from '../types.js';
import { bad, ev, notMeasured, ok, unknown, warn } from './result.js';
import { parseEnvPresence } from './lib/parse.js';
import { NON_SECRET_ENV_KEYS } from './env-manifest.data.js';

export const paymentGateCheck: CheckModule = {
  id: 'app-gates',
  title: 'Payment and identity gates',
  cost: 'cheap',
  cadenceMs: 15 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const backend = await ctx.readFile(ctx.config.backendEnvPath);
    if (!backend.ok) return unknown(`cannot read the backend env file — ${backend.error}`);
    // Only the allowlisted keys can yield a value here; everything else in
    // the file comes back as a length and is not touched by this check.
    const env = parseEnvPresence(backend.value, NON_SECRET_ENV_KEYS);
    const value = (k: string) => env.get(k)?.value ?? null;

    const nodeEnv = value('NODE_ENV');
    const paymentMode = value('PAYMENT_MODE');
    const paymentsLive = value('PAYMENTS_LIVE');
    const verifynowMode = value('VERIFYNOW_MODE');
    const allowLocal = value('ALLOW_LOCAL_ORIGINS');
    const production = nodeEnv === 'production';

    const evidence: Evidence[] = [
      ev('NODE_ENV', nodeEnv ?? 'unset', ctx.config.backendEnvPath),
      ev('PAYMENT_MODE', paymentMode ?? 'unset'),
      ev('PAYMENTS_LIVE', paymentsLive ?? 'unset'),
      ev('VERIFYNOW_MODE', verifynowMode ?? 'unset (defaults to sandbox)'),
      ev('ALLOW_LOCAL_ORIGINS', allowLocal ?? 'unset'),
    ];

    const frontend = await ctx.readFile(ctx.config.frontendEnvPath);
    let mirrorMismatch = false;
    if (frontend.ok) {
      const fe = parseEnvPresence(frontend.value, NON_SECRET_ENV_KEYS).get('NEXT_PUBLIC_PAYMENT_MODE')?.value ?? null;
      evidence.push(ev('NEXT_PUBLIC_PAYMENT_MODE', fe ?? 'unset', ctx.config.frontendEnvPath));
      // A mismatch shows the buyer a payment path the API will refuse.
      mirrorMismatch = Boolean(paymentMode && fe && paymentMode !== fe);
    } else {
      evidence.push(notMeasured('NEXT_PUBLIC_PAYMENT_MODE', frontend.error));
    }

    // Sandbox KYC in production passes fake identities, and the app only
    // WARNs about it at boot — nothing blocks it, which is why it is worth
    // a red row of its own here.
    if (production && (verifynowMode ?? 'sandbox').toLowerCase() !== 'production') {
      return {
        status: 'bad',
        gateKey: 'VERIFYNOW_MODE',
        verdict: `NODE_ENV is production but VERIFYNOW_MODE is ${verifynowMode ?? 'unset (sandbox)'} — identity checks pass fake identities.`,
        evidence,
      };
    }
    if (production && (allowLocal ?? '').toLowerCase() === 'true') {
      return { status: 'bad', gateKey: 'ALLOW_LOCAL_ORIGINS', verdict: 'ALLOW_LOCAL_ORIGINS is true in production — localhost origins are accepted by CORS.', evidence };
    }
    if (mirrorMismatch) {
      return warn(`PAYMENT_MODE and NEXT_PUBLIC_PAYMENT_MODE disagree — the UI offers a path the API refuses.`, evidence);
    }
    return ok(`Payment mode ${paymentMode ?? 'unset'}, payments ${paymentsLive === 'true' ? 'LIVE' : 'inert'}, KYC ${verifynowMode ?? 'sandbox'}.`, evidence);
  },
};

export const courierBookingCheck: CheckModule = {
  id: 'app-courier-bookings',
  title: 'Unconfirmed courier bookings',
  cost: 'cheap',
  cadenceMs: 10 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const sql = `select count(*)::text, coalesce(min("shipmentBookingStartedAt")::text, '') from "Transaction" where "shipmentBookingStartedAt" is not null and "shipmentBookedAt" is null and "shipmentFailureAt" is null and "shipmentBookingStartedAt" < now() - interval '10 minutes'`;
    const res = await ctx.queryDb(sql, { timeoutMs: 8_000 });
    if (!res.ok) return unknown(res.error);
    const count = Number(res.value[0]?.[0] ?? NaN);
    if (!Number.isFinite(count)) return unknown(`the booking count came back unreadable: ${JSON.stringify(res.value[0] ?? null)}`);
    const oldest = res.value[0]?.[1] || null;
    const evidence: Evidence[] = [
      ev('claimed but never confirmed, over 10 minutes old', String(count), `psql -c "${sql}"`),
      oldest ? ev('oldest', oldest) : notMeasured('oldest', 'no such row'),
    ];
    if (count >= 5) return bad(`${count} courier bookings were claimed and never confirmed.`, evidence);
    if (count > 0) return warn(`${count} courier booking${count === 1 ? ' was' : 's were'} claimed and never confirmed.`, evidence);
    return ok('No courier booking is stuck between claim and confirmation.', evidence);
  },
};

/**
 * ⚠️ SECOND IMPLEMENTATION WARNING. These four counts mirror
 * backend/src/admin/admin-health.service.ts::queueDepths(), thresholds
 * included. There is no secret-gated endpoint for queue depths the way
 * there is for crons, so this is a hand copy — and a hand copy is exactly
 * how this codebase previously ended up with a cron interval that was
 * wrong for half of every hour. If you edit queueDepths(), edit this; the
 * better fix is to expose queue depths behind HEALTH_PING_SECRET the way
 * cronStatuses() already is, and delete these queries.
 */
const QUEUES: { label: string; sql: string; warn: number; alarm: number }[] = [
  {
    label: 'Listings pending admin review',
    sql: `select count(*)::text from "Listing" where status = 'PENDING_REVIEW'`,
    warn: 10,
    alarm: 30,
  },
  {
    label: 'HELD payments past the 24h dispatch SLA',
    sql: `select count(*)::text from "Transaction" where "paymentStatus" = 'HELD' and "dispatchedAt" is null and "paidAt" < now() - interval '24 hours'`,
    warn: 5,
    alarm: 20,
  },
  {
    label: 'Users with KYC outstanding',
    sql: `select count(*)::text from "User" where "kycRequiredAt" is not null and "kycStatus" <> 'VERIFIED'`,
    warn: 20,
    alarm: 60,
  },
  {
    label: 'Listing questions awaiting a seller answer',
    sql: `select count(*)::text from "ListingQuestion" where status = 'AWAITING_SELLER_ANSWER'`,
    warn: 25,
    alarm: 75,
  },
];

export const queueDepthCheck: CheckModule = {
  id: 'app-queue-depth',
  title: 'Queue depth',
  cost: 'moderate',
  cadenceMs: 15 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const evidence: Evidence[] = [];
    let worst: 'ok' | 'warn' | 'bad' = 'ok';
    const notes: string[] = [];
    let measured = 0;

    for (const queue of QUEUES) {
      const res = await ctx.queryDb(queue.sql, { timeoutMs: 8_000 });
      if (!res.ok) {
        // One queue failing does not make the other three unknown, and it
        // certainly does not make this one zero.
        evidence.push(notMeasured(queue.label, res.error));
        continue;
      }
      const n = Number(res.value[0]?.[0] ?? NaN);
      if (!Number.isFinite(n)) {
        evidence.push(notMeasured(queue.label, 'the count came back unreadable'));
        continue;
      }
      measured += 1;
      evidence.push(ev(queue.label, `${n} (warn at ${queue.warn}, alarm at ${queue.alarm})`, `psql -c "${queue.sql}"`));
      if (n >= queue.alarm) {
        worst = 'bad';
        notes.push(`${queue.label}: ${n}`);
      } else if (n >= queue.warn && worst !== 'bad') {
        worst = 'warn';
        notes.push(`${queue.label}: ${n}`);
      }
    }

    if (measured === 0) return unknown('no queue count could be read from the database', evidence);
    if (worst === 'bad') return bad(`Queues past their alarm threshold — ${notes.join('; ')}.`, evidence);
    if (worst === 'warn') return warn(`Queues building — ${notes.join('; ')}.`, evidence);
    return ok(
      measured === QUEUES.length
        ? 'All four work queues are below their warning thresholds.'
        : `${measured} of ${QUEUES.length} queues read, all below their warning thresholds.`,
      evidence,
    );
  },
};

export const appChecks: CheckModule[] = [paymentGateCheck, courierBookingCheck, queueDepthCheck];
