// warden/src/checks/channels.ts
//
// The four ways the site reaches a person: email, SMS, web push, WhatsApp.
// Each check answers three separate questions and keeps them separate,
// because they fail independently: is it CONFIGURED, when did it last
// SUCCEED, and how many CONSECUTIVE FAILURES are there now.
//
// 🚨 THREE OF THESE HAVE A GENUINELY UNMEASURABLE ANSWER, AND SAY SO.
//   · Email: EmailOutbox has attempts/nextAttemptAt/lastError but NO
//     status or sentAt column — a sent mail is simply removed from the
//     table. So "last successful send" cannot be read, and an EMPTY
//     OUTBOX AND "NOTHING WAS EVER SENT" LOOK IDENTICAL. Inferring health
//     from an empty outbox would be the plausible zero in its purest form.
//   · Push: there is no send log at all, only PushSubscription. Whether
//     the VAPID pair still matches its subscriptions cannot be known
//     without attempting a real send, which would burn a live subscription
//     — Warden does not send to real people to satisfy a check.
//   · WhatsApp: there is no provider behind the flag yet. The honest
//     framing is "kill switch only", not a bare unknown.

import type { CheckModule, CheckOutcome, Evidence } from '../types.js';
import { ageWords, bad, ev, notMeasured, ok, parseDate, unknown, warn } from './result.js';
import { parseEnvPresence } from './lib/parse.js';

export const emailChannelCheck: CheckModule = {
  id: 'channel-email',
  title: 'Email (Resend)',
  cost: 'cheap',
  cadenceMs: 10 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const configured = await isConfigured(ctx, ['RESEND_API_KEY']);
    const stuck = await ctx.queryDb(
      `select count(*)::text from "EmailOutbox" where attempts > 3`,
      { timeoutMs: 8_000 },
    );
    const failing = await ctx.queryDb(
      `select count(*)::text from "EmailOutbox" where "lastError" is not null`,
      { timeoutMs: 8_000 },
    );

    const evidence: Evidence[] = [
      ev('configured', configured.text, ctx.config.backendEnvPath),
      // The gap, named every sweep so nobody reads the outbox counts as a
      // health signal.
      notMeasured('last successful send', 'EmailOutbox has no status/sentAt column — a sent mail is deleted, so success leaves no record'),
    ];

    if (!stuck.ok || !failing.ok) {
      return unknown(`cannot read the outbox — ${!stuck.ok ? stuck.error : failing.ok ? '' : failing.error}`, evidence);
    }
    const stuckCount = Number(stuck.value[0]?.[0] ?? NaN);
    const failingCount = Number(failing.value[0]?.[0] ?? NaN);
    if (!Number.isFinite(stuckCount) || !Number.isFinite(failingCount)) {
      return unknown('the outbox counts came back unreadable', evidence);
    }
    evidence.push(ev('past 3 attempts', String(stuckCount), 'psql -c "select count(*) from \\"EmailOutbox\\" where attempts > 3"'));
    evidence.push(ev('carrying a lastError', String(failingCount)));

    if (configured.state === 'unknown') return unknown(configured.text, evidence);
    if (configured.state === 'missing') return bad(`Email is not configured: ${configured.missing.join(', ')} unset.`, evidence);
    if (stuckCount > 0) return bad(`${stuckCount} queued email${stuckCount === 1 ? ' has' : 's have'} failed more than three attempts.`, evidence);
    if (failingCount > 0) return warn(`${failingCount} queued email${failingCount === 1 ? '' : 's'} carry a delivery error.`, evidence);
    return ok('Email is configured and nothing is stuck in the outbox.', evidence);
  },
};

export const smsChannelCheck: CheckModule = {
  id: 'channel-sms',
  title: 'SMS (SMSPortal)',
  cost: 'cheap',
  cadenceMs: 10 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const configured = await isConfigured(ctx, ['SMSPORTAL_CLIENT_ID', 'SMSPORTAL_API_SECRET']);
    const lastSent = await ctx.queryDb(`select max("createdAt")::text from "SmsLog" where status = 'SENT'`, { timeoutMs: 8_000 });
    // Newest first: the consecutive-failure streak is counted from the top
    // until a SENT breaks it. 'STUB' means the client id was unset at send
    // time — not-configured, NOT a delivery failure, and folding the two
    // together would blame the provider for a missing env var.
    const recent = await ctx.queryDb(`select status from "SmsLog" order by "createdAt" desc limit 50`, { timeoutMs: 8_000 });

    const evidence: Evidence[] = [ev('configured', configured.text, ctx.config.backendEnvPath)];
    if (!lastSent.ok || !recent.ok) {
      return unknown(`cannot read SmsLog — ${!lastSent.ok ? lastSent.error : recent.ok ? '' : recent.error}`, evidence);
    }

    const at = parseDate(lastSent.value[0]?.[0]);
    evidence.push(
      at
        ? ev('last success', `${at.toISOString()} (${ageWords(at, ctx.now())} ago)`, 'psql -c "select max(\\"createdAt\\") from \\"SmsLog\\" where status=\'SENT\'"')
        : notMeasured('last success', 'no SmsLog row has ever had status SENT'),
    );

    let streak = 0;
    for (const row of recent.value) {
      if (row[0] === 'FAILED') streak += 1;
      else break;
    }
    const stubs = recent.value.filter((r) => r[0] === 'STUB').length;
    evidence.push(ev('consecutive failures', String(streak), 'psql -c "select status from \\"SmsLog\\" order by \\"createdAt\\" desc limit 50"'));
    evidence.push(ev('STUB rows in the last 50', `${stubs} (logged, not sent — the client id was unset at send time)`));

    if (configured.state === 'unknown') return unknown(configured.text, evidence);
    if (configured.state === 'missing') return bad(`SMS is not configured: ${configured.missing.join(', ')} unset — sends are logged as STUB and nobody receives them.`, evidence);
    if (streak >= 5) return bad(`The last ${streak} SMS sends all failed.`, evidence);
    if (streak > 0) return warn(`The last ${streak} SMS send${streak === 1 ? '' : 's'} failed.`, evidence);
    return ok(at ? `SMS sending, last success ${ageWords(at, ctx.now())} ago.` : 'SMS is configured; nothing has been sent yet.', evidence);
  },
};

export const pushChannelCheck: CheckModule = {
  id: 'channel-push',
  title: 'Web push (VAPID)',
  cost: 'cheap',
  cadenceMs: 30 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const configured = await isConfigured(ctx, ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']);
    const subs = await ctx.queryDb('select count(*)::text from "PushSubscription"', { timeoutMs: 8_000 });

    const evidence: Evidence[] = [
      ev('configured', configured.text, ctx.config.backendEnvPath),
      notMeasured('last successful send', 'there is no push send log table — nothing records a success'),
      notMeasured(
        'keys still matched to subscriptions',
        'only a real send to a real subscription could prove it, and Warden does not send to a member to satisfy a check',
      ),
    ];
    if (subs.ok) {
      const n = Number(subs.value[0]?.[0] ?? NaN);
      evidence.push(
        Number.isFinite(n)
          ? ev('subscriptions', String(n), 'psql -c "select count(*) from \\"PushSubscription\\""')
          : notMeasured('subscriptions', 'the count came back unreadable'),
      );
    } else {
      evidence.push(notMeasured('subscriptions', subs.error));
    }

    if (configured.state === 'unknown') return unknown(configured.text, evidence);
    if (configured.state === 'missing') return bad(`Web push is not configured: ${configured.missing.join(', ')} unset.`, evidence);
    return ok('Both VAPID keys are present; delivery itself is not observable from here.', evidence);
  },
};

export const whatsappChannelCheck: CheckModule = {
  id: 'channel-whatsapp',
  title: 'WhatsApp',
  cost: 'cheap',
  cadenceMs: 60 * 60_000,
  async run(ctx): Promise<CheckOutcome> {
    const flag = await ctx.queryDb(`select value from "Setting" where key = 'whatsapp_enabled'`, { timeoutMs: 8_000 });
    if (!flag.ok) return unknown(flag.error);
    const value = flag.value[0]?.[0] ?? null;
    const evidence: Evidence[] = [
      ev('whatsapp_enabled', value ?? 'no Setting row', 'psql -c "select value from \\"Setting\\" where key=\'whatsapp_enabled\'"'),
      // Not a bare unknown: the reason is that there is nothing behind the
      // flag yet, which is a different fact from "we failed to look".
      ev('provider', 'none wired yet — the Setting row is a kill switch, not a channel'),
    ];
    return ok(`WhatsApp has no provider behind it; the kill switch reads ${value ?? 'unset'}.`, evidence);
  },
};

export const channelChecks: CheckModule[] = [emailChannelCheck, smsChannelCheck, pushChannelCheck, whatsappChannelCheck];

// ── helper ──────────────────────────────────────────────────────────────

/**
 * Presence, never values — the same rule as env-manifest.ts, reused here
 * so a channel check cannot become a second, looser way to read .env.
 *
 * ⚠️ THREE STATES, NOT TWO. An unreadable env file is 'unknown', never
 * 'missing': reporting "email is not configured" because Warden could not
 * open the file would be a fabricated fault, and an operator acting on it
 * would go looking for a variable that is already there.
 */
async function isConfigured(
  ctx: Parameters<CheckModule['run']>[0],
  keys: string[],
): Promise<{ state: 'set' | 'missing' | 'unknown'; missing: string[]; text: string }> {
  const read = await ctx.readFile(ctx.config.backendEnvPath);
  if (!read.ok) return { state: 'unknown', missing: [], text: `cannot tell — ${read.error}` };
  const present = parseEnvPresence(read.value);
  const missing = keys.filter((k) => !present.has(k));
  return {
    state: missing.length === 0 ? 'set' : 'missing',
    missing,
    text: missing.length === 0 ? `${keys.join(' + ')} set` : `missing ${missing.join(', ')}`,
  };
}
