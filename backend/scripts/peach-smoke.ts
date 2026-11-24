/*
 * Peach Payments live/sandbox readiness probe.
 *
 *   cd backend && npm run peach:smoke
 *   cd backend && npm run peach:smoke -- --create     # also mints a real R1 checkout (no money moves)
 *
 * WHY THIS EXISTS: the unit specs mock fetch, so they cannot catch the three
 * things that actually broke the live rail on 2026-11-24 —
 *   • a wrong / not-enabled Checkout entity ID (404 "Channel not found"),
 *   • a body shape Peach does not parse (nested `authentication` object),
 *   • a secret token that does not produce a valid signature.
 * This probe talks to the real gateway. It never moves money: by default it
 * is read-only (OAuth, channel lookup, payout/BANV reachability, webhook
 * config) and the one refund request it sends references a random
 * non-existent payment id, so a valid signature can only be answered
 * "no such payment" — never "refunded".
 *
 * Exit code 0 = every REQUIRED check passed. 1 = at least one FAIL.
 */
import * as crypto from 'crypto';
import { signParams } from '../src/payments/peach-signature';

type Verdict = 'PASS' | 'FAIL' | 'WARN' | 'SKIP';

const LIVE = process.env.PEACH_ENV === 'live';
const AUTH_HOST = LIVE
  ? 'https://dashboard.peachpayments.com'
  : 'https://sandbox-dashboard.peachpayments.com';
const CHECKOUT_HOST = LIVE
  ? 'https://secure.peachpayments.com'
  : 'https://testsecure.peachpayments.com';
const REFUND_HOST = LIVE
  ? 'https://api.peachpayments.com'
  : 'https://testapi.peachpayments.com';
const PAYOUTS_HOST = LIVE
  ? 'https://payouts.peachpayments.com'
  : 'https://sandbox-payouts.peachpayments.com';

const checkoutClientId = process.env.PEACH_CLIENT_ID ?? '';
const checkoutClientSecret = process.env.PEACH_CLIENT_SECRET ?? '';
const merchantId = process.env.PEACH_MERCHANT_ID ?? '';
const entityId = process.env.PEACH_ENTITY_ID ?? '';
const classicSecret = process.env.PEACH_SECRET ?? '';
const payoutClientId = process.env.PEACH_PAYOUT_CLIENT_ID || checkoutClientId;
const payoutClientSecret =
  process.env.PEACH_PAYOUT_CLIENT_SECRET || checkoutClientSecret;
const payoutMerchantId = process.env.PEACH_PAYOUT_MERCHANT_ID || merchantId;

const argv = process.argv.slice(2);
const CREATE = argv.includes('--create');
const AMOUNT = (() => {
  const i = argv.indexOf('--amount');
  const n = i >= 0 ? Number(argv[i + 1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
})();

const FAILURES: string[] = [];
const results: { name: string; verdict: Verdict; detail: string }[] = [];

function record(name: string, verdict: Verdict, detail: string) {
  results.push({ name, verdict, detail });
  if (verdict === 'FAIL') FAILURES.push(name);
  const mark =
    verdict === 'PASS' ? 'PASS' : verdict === 'WARN' ? 'WARN' : verdict === 'SKIP' ? 'SKIP' : 'FAIL';
  console.log(`  [${mark}] ${name} — ${detail}`);
}

function mask(v: string): string {
  return v ? `${v.slice(0, 4)}…(${v.length})` : '(unset)';
}

async function oauth(clientId: string, clientSecret: string, mid: string) {
  const res = await fetch(`${AUTH_HOST}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret, merchantId: mid }),
  });
  const text = await res.text();
  let token: string | undefined;
  try {
    const j = JSON.parse(text);
    token = j.access_token || j.accessToken;
  } catch {
    /* non-JSON */
  }
  return { ok: res.ok && !!token, status: res.status, token, body: text };
}

/** Peach result codes come back either nested ({result:{code}}) or as a flat
 *  dotted key ("result.code"), depending on the V1/V2 surface. */
function resultCode(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const o = json as Record<string, unknown>;
  if (typeof o['result.code'] === 'string') return o['result.code'] as string;
  const nested = o.result as Record<string, unknown> | undefined;
  if (nested && typeof nested.code === 'string') return nested.code;
  return undefined;
}

async function jsonOf(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

async function main() {
  console.log(`\nPeach readiness probe — env=${process.env.PEACH_ENV ?? '(unset)'} mode=${LIVE ? 'LIVE' : 'SANDBOX'}`);
  console.log(`entity=${mask(entityId)} merchant=${mask(merchantId)}`);

  // ── 1. Configuration presence ─────────────────────────────────────
  const missing = [
    ['PEACH_CLIENT_ID', checkoutClientId],
    ['PEACH_CLIENT_SECRET', checkoutClientSecret],
    ['PEACH_MERCHANT_ID', merchantId],
    ['PEACH_ENTITY_ID', entityId],
  ].filter(([, v]) => !v);
  if (missing.length) {
    record('checkout credentials present', 'FAIL', `missing ${missing.map(([k]) => k).join(', ')}`);
  } else {
    record('checkout credentials present', 'PASS', 'all four set');
  }
  record(
    'refund secret token present',
    classicSecret ? 'PASS' : 'FAIL',
    classicSecret ? `PEACH_SECRET ${mask(classicSecret)}` : 'PEACH_SECRET is unset — refunds cannot be signed',
  );
  record(
    'checkout webhook signing secret',
    process.env.PEACH_WEBHOOK_SECRET ? 'PASS' : 'FAIL',
    process.env.PEACH_WEBHOOK_SECRET
      ? 'PEACH_WEBHOOK_SECRET set'
      : 'PEACH_WEBHOOK_SECRET unset — checkout webhooks will be REJECTED (fail-closed)',
  );

  // ── 2. OAuth ──────────────────────────────────────────────────────
  const checkoutAuth = await oauth(checkoutClientId, checkoutClientSecret, merchantId);
  record(
    'checkout OAuth',
    checkoutAuth.ok ? 'PASS' : 'FAIL',
    `HTTP ${checkoutAuth.status}${checkoutAuth.ok ? '' : ` — ${String((checkoutAuth.body ?? '').slice(0, 120))}`}`,
  );
  const payoutAuth = await oauth(payoutClientId, payoutClientSecret, payoutMerchantId);
  record(
    'payouts OAuth',
    payoutAuth.ok ? 'PASS' : 'FAIL',
    `HTTP ${payoutAuth.status}${payoutAuth.ok ? '' : ` — ${String((payoutAuth.body ?? '').slice(0, 120))}`}`,
  );
  if (!checkoutAuth.token) {
    finish();
    return;
  }
  const bearer = checkoutAuth.token;

  // ── 3. Checkout channel (the entity ID) ───────────────────────────
  const chan = await fetch(
    `${CHECKOUT_HOST}/v2/channels/${encodeURIComponent(entityId)}/payment-methods?currency=ZAR`,
    { headers: { Authorization: `Bearer ${bearer}` } },
  );
  if (chan.ok) {
    record('checkout channel', 'PASS', `entity ${mask(entityId)} is a valid ${LIVE ? 'live' : 'sandbox'} channel`);
  } else {
    record(
      'checkout channel',
      'FAIL',
      `HTTP ${chan.status} ${String(JSON.stringify(await jsonOf(chan))).slice(0, 160)} — the entity is not a Checkout channel for THIS merchant (wrong product/account value, or Checkout V2 not enabled). Copy Entity ID from Dashboard → Checkout → API keys.`,
    );
  }

  // ── 4. Optional real checkout create (no money) ───────────────────
  if (CREATE) {
    const ref = ('GG' + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString('hex').toUpperCase()).slice(0, 16);
    const res = await fetch(`${CHECKOUT_HOST}/v2/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
        Origin: 'https://alloutdoor.co.za',
        Referer: 'https://alloutdoor.co.za/',
      },
      body: JSON.stringify({
        'authentication.entityId': entityId,
        merchantTransactionId: ref,
        amount: AMOUNT,
        currency: 'ZAR',
        paymentType: 'DB',
        nonce: `${Date.now()}${crypto.randomBytes(3).toString('hex')}`,
        shopperResultUrl: 'https://alloutdoor.co.za/checkout/complete?smoke=1',
        notificationUrl: 'https://alloutdoor.co.za/api/payments/webhook/peach',
      }),
    });
    const body = (await jsonOf(res)) as Record<string, unknown>;
    if (res.ok && typeof body.checkoutId === 'string') {
      const redirect = typeof body.redirectUrl === 'string' ? body.redirectUrl : '';
      let host = '';
      try {
        host = new URL(redirect).host;
      } catch {
        /* ignore */
      }
      record(
        'create R' + AMOUNT + ' checkout',
        'PASS',
        `checkoutId=${String(body.checkoutId).slice(0, 12)}… redirectHost=${host || '(none)'} ref=${ref} (unpaid; expires on its own)`,
      );
    } else {
      record(
        'create R' + AMOUNT + ' checkout',
        'FAIL',
        `HTTP ${res.status} ${String(JSON.stringify(body)).slice(0, 200)}`,
      );
    }
  } else {
    record('create checkout', 'SKIP', 'read-only run — re-run with --create to mint an unpaid R' + AMOUNT + ' checkout');
  }

  // ── 5. Refund signature (auth probe; moves no money) ──────────────
  // A random payment id cannot be refunded. What we are testing is whether the
  // SIGNATURE is accepted: a bad secret answers 800.900.300 "invalid
  // authentication information"; an accepted signature answers a business
  // error (e.g. 700.400.200 "cannot refund …") or a 200 result code.
  const probeParams: Record<string, string> = {
    'authentication.entityId': entityId,
    amount: '1.00',
    currency: 'ZAR',
    id: crypto.randomBytes(16).toString('hex'),
    paymentType: 'RF',
  };
  probeParams.signature = signParams(probeParams, classicSecret);
  const refundRes = await fetch(`${REFUND_HOST}/v1/checkout/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(probeParams).toString(),
  });
  const refundBody = await jsonOf(refundRes);
  const refundCode = resultCode(refundBody);
  const refundText = JSON.stringify(refundBody);
  if (refundCode === '800.900.300' || /invalid authentication/i.test(refundText)) {
    record(
      'refund signature',
      'FAIL',
      `HTTP ${refundRes.status} — Peach rejected the signature (${refundCode ?? '?'}). PEACH_ENTITY_ID and PEACH_SECRET are not a matching live pair.`,
    );
  } else if (refundCode || refundRes.status === 200) {
    record(
      'refund signature',
      'PASS',
      `HTTP ${refundRes.status} code=${refundCode ?? '(none)'} — signature accepted (bogus payment id, nothing refunded)`,
    );
  } else {
    record('refund signature', 'WARN', `HTTP ${refundRes.status} ${refundText.slice(0, 160)}`);
  }

  // ── 6. Payouts + BANV reachability ────────────────────────────────
  if (!payoutAuth.token) {
    record('payouts API', 'FAIL', 'no payouts bearer token — cannot check Payouts/BANV');
  } else {
    const pToken = payoutAuth.token;
    const payoutProbe = await fetch(
      `${PAYOUTS_HOST}/api/merchants/${encodeURIComponent(payoutMerchantId)}/payouts/status?payoutId=${crypto.randomUUID()}`,
      { headers: { Authorization: `Bearer ${pToken}` } },
    );
    const payoutBody = await jsonOf(payoutProbe);
    const pcode = (payoutBody as Record<string, unknown>).code as string | undefined;
    record(
      'payouts API',
      payoutProbe.status === 404 && pcode?.startsWith('2900.004')
        ? 'PASS'
        : 'FAIL',
      `HTTP ${payoutProbe.status}${pcode ? ` code=${pcode}` : ''} — authenticated not-found is the healthy answer`,
    );

    const banvProbe = await fetch(
      `${PAYOUTS_HOST}/api/merchants/${encodeURIComponent(payoutMerchantId)}/banv/${crypto.randomUUID()}/status`,
      { headers: { Authorization: `Bearer ${pToken}` } },
    );
    const banvBody = await jsonOf(banvProbe);
    const bcode = (banvBody as Record<string, unknown>).code as string | undefined;
    record(
      'BANV API',
      banvProbe.status === 404 && bcode?.startsWith('2902.004')
        ? 'PASS'
        : 'FAIL',
      `HTTP ${banvProbe.status}${bcode ? ` code=${bcode}` : ''} — authenticated not-found is the healthy answer`,
    );

    const wh = await fetch(
      `${PAYOUTS_HOST}/api/merchants/${encodeURIComponent(payoutMerchantId)}/webhook`,
      { headers: { Authorization: `Bearer ${pToken}` } },
    );
    const whBody = (await jsonOf(wh)) as Record<string, unknown>;
    const payoutUrl = typeof whBody.webhookEndpoint === 'string' ? whBody.webhookEndpoint : '';
    const banvUrl = typeof whBody.banvEndpoint === 'string' ? whBody.banvEndpoint : '';
    const okUrls =
      /\/api\/payments\/webhook\/peach-payout$/.test(payoutUrl) &&
      /\/api\/payments\/webhook\/peach-banv$/.test(banvUrl);
    record(
      'payout/BANV webhooks registered',
      wh.ok && okUrls ? 'PASS' : 'FAIL',
      wh.ok
        ? `payout=${payoutUrl || '(none)'} banv=${banvUrl || '(none)'}`
        : `HTTP ${wh.status}`,
    );
    record(
      'payout webhook signing secret',
      process.env.PEACH_PAYOUT_WEBHOOK_SECRET
        ? 'PASS'
        : 'WARN',
      process.env.PEACH_PAYOUT_WEBHOOK_SECRET
        ? 'PEACH_PAYOUT_WEBHOOK_SECRET set'
        : 'unset — falls back to PEACH_SECRET; unsigned deliveries are re-confirmed via the Payouts API',
    );
  }

  // ── 7. Float (best-effort) ────────────────────────────────────────
  record(
    'Peach float funded',
    'SKIP',
    'cannot be read from here — confirm the Payouts balance in the Peach dashboard before enabling payouts',
  );

  finish();
}

function finish() {
  const failed = results.filter((r) => r.verdict === 'FAIL').length;
  const warned = results.filter((r) => r.verdict === 'WARN').length;
  console.log(
    `\n${failed === 0 ? 'READY' : 'NOT READY'} — ${results.length - failed - warned} pass, ${failed} fail, ${warned} warn, ${results.filter((r) => r.verdict === 'SKIP').length} skipped\n`,
  );
  if (FAILURES.length) console.log(`Failures: ${FAILURES.join(', ')}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Peach probe crashed:', (err as Error).message);
  process.exit(1);
});
