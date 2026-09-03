/**
 * THE DESK — Send: the blast, and the campaign key it is attributed by.
 *
 * The replacement for /admin/broadcast AND /admin/campaigns. They merge
 * because they are one job done in two places: an operator pays for an SMS
 * blast, puts a `?c=` link in it, and then wants to know whether the blast
 * pulled. Splitting the key from the message across two pages is why the
 * legacy panel could show a campaign with 4,000 hits and no way to see what
 * was actually said to earn them.
 *
 * 🚨 THIS IS THE MOST DANGEROUS THING THE DESK CAN DO. Everything else on
 * this surface changes a row. This puts words in front of real people, on
 * their phone, and there is no recall — no draft state on the server, no
 * pending queue to cancel, no undo window. The whole module is written so a
 * confirm can restate the truth rather than a hopeful summary of it.
 *
 * ⚠️ THE COUNT IS A PROMISE, AND FOR SMS IT IS OFTEN AN UPPER BOUND.
 * AdminBroadcastService.resolveRecipients filters on a verified phone for
 * `all-users` and `dormant` ONLY. Every other segment — and the individual
 * path — resolves the audience with no phone filter at all, and then
 * `send()` skips the ones with no number. So "1,284" on an SMS blast to
 * all-active-sellers is the size of the SEGMENT, not the number of phones it
 * will reach. The legacy page printed that number under the words "1,284
 * recipients will receive this sms". describeCount below is the one place
 * that difference is spelled out, so no surface has to remember it.
 *
 * ⚠️ AND NO COUNT ON EITHER CHANNEL IS A DELIVERY FIGURE, BECAUSE OF THE MUTE.
 * NotificationsService gates every outbound message on the member's own
 * notifyEmailEnabled / notifySmsEnabled and returns quietly when it is off.
 * Only the Dormant SMS query filters on that column, so on every other
 * audience a muted member is counted in the preview, is counted in `sent`,
 * never appears in `skipped`, and receives nothing. There is no frontend fix
 * for it — the preview endpoint cannot see the column and the send does not
 * report it — which is why buildPlan raises it as a caution the confirm
 * prints rather than letting the number imply otherwise.
 *
 * ⚠️ NO PERSONAL DATA CROSSES THIS BOUNDARY. Preview returns a count and
 * nothing else; the campaign list is aggregate. The individual path takes a
 * user id the operator already has and never asks the server who that is —
 * an audience picker that resolved ids to names would put a name on screen
 * for a decision that does not need one.
 */
import { DeskFetchError, deskFetch } from './desk-auth';
// One spelling of a timestamp across the Desk — the Site board's, because
// this drawer lives on it.
import { stamp } from './desk-site';
// ⚠️ NOT A HARD-CODED HOST. The campaign link is the thing that rides in a
// paid SMS; brand.ts exists because the origin lived in two places at the
// domain move and one of them was missed. A wrong host here is money spent
// on a link that 410s.
import { SITE_URL } from './brand';

export type SendChannel = 'email' | 'sms';

export type SendSegment =
  | 'all-sellers'
  | 'all-active-sellers'
  | 'kyc-pending'
  | 'kyc-stalled'
  | 'all-buyers'
  | 'dormant';

export type Audience =
  | { kind: 'individual'; userId: string }
  | { kind: 'segment'; segment: SendSegment }
  | { kind: 'all-users' };

export type AudienceKind = Audience['kind'];

/* ────────────────────────────────────────────────────────────────────────
 * What the server will actually do
 * ──────────────────────────────────────────────────────────────────────── */

/** AdminBroadcastService throws above this. A preview over it is a dead send. */
export const RECIPIENT_CAP = 5000;
export const BODY_MIN = 5;
export const SUBJECT_MIN = 3;
export const SMS_MAX = 320;
export const EMAIL_MAX = 5000;
/** Long enough that "x" will not do, short enough to type before a send. */
export const REASON_MIN = 8;

export interface SegmentSpec {
  value: SendSegment;
  label: string;
  /** How the server defines it, not how marketing describes it. */
  definition: string;
  /**
   * Whether resolveRecipients filters this segment down to verified phones
   * when the channel is SMS.
   *
   * ⚠️ ONLY `dormant` DOES. Everything else hands the sender the whole
   * segment and lets it skip the numberless ones one at a time.
   */
  smsFiltersOnPhone: boolean;
  /**
   * Whether the segment requires marketingConsentAt.
   *
   * ⚠️ ALSO ONLY `dormant`. The others are service audiences: the server will
   * happily send them a marketing message, because the server cannot tell the
   * difference. The operator can.
   */
  requiresMarketingConsent: boolean;
}

export const SEND_SEGMENTS: SegmentSpec[] = [
  {
    value: 'all-active-sellers',
    label: 'Active sellers',
    definition: 'At least one ACTIVE listing. Not banned, not closed.',
    smsFiltersOnPhone: false,
    requiresMarketingConsent: false,
  },
  {
    value: 'all-sellers',
    label: 'All sellers',
    definition: 'At least one listing in any status, live or not.',
    smsFiltersOnPhone: false,
    requiresMarketingConsent: false,
  },
  {
    value: 'all-buyers',
    label: 'All buyers',
    definition: 'At least one transaction as the buyer.',
    smsFiltersOnPhone: false,
    requiresMarketingConsent: false,
  },
  {
    value: 'kyc-pending',
    label: 'Verification outstanding',
    definition: 'Verification required and not yet passed. Any age.',
    smsFiltersOnPhone: false,
    requiresMarketingConsent: false,
  },
  {
    value: 'kyc-stalled',
    label: 'Verification stalled',
    definition: 'The same, but required more than 24 hours ago.',
    smsFiltersOnPhone: false,
    requiresMarketingConsent: false,
  },
  {
    value: 'dormant',
    label: 'Dormant · re-engagement',
    definition:
      'Account over 14 days old, no login in 14 days, and a marketing opt-in on file. The only consent-filtered segment.',
    smsFiltersOnPhone: true,
    requiresMarketingConsent: true,
  },
];

export function segmentSpec(segment: SendSegment): SegmentSpec {
  // The list above is exhaustive over the union, so this never falls through
  // in practice; the fallback keeps a bad key from blanking the drawer.
  return SEND_SEGMENTS.find((s) => s.value === segment) ?? SEND_SEGMENTS[0];
}

/** "Active sellers" · "One member" · "Everyone on the site". */
export function describeAudience(audience: Audience): string {
  if (audience.kind === 'all-users') return 'Everyone on the site';
  if (audience.kind === 'individual') return 'One member';
  return segmentSpec(audience.segment).label;
}

/* ────────────────────────────────────────────────────────────────────────
 * The wire
 * ──────────────────────────────────────────────────────────────────────── */

export function previewRecipients(
  audience: Audience,
  channel: SendChannel,
): Promise<{ count: number }> {
  return deskFetch<{ count: number }>('/admin/broadcast/preview', {
    method: 'POST',
    body: JSON.stringify({ audience, channel }),
  });
}

export interface SendResult {
  sent: number;
  skipped: number;
  total: number;
}

/**
 * Fire the blast.
 *
 * ⚠️ NO `reason` FIELD ON THE WIRE, AND THAT IS NOT AN OVERSIGHT. The
 * controller reads channel / audience / subject / body and nothing else, and
 * AdminBroadcastService writes its own audit reason from those. The drawer
 * still demands a typed reason before it will arm — see REASON_MIN — but it
 * says out loud that the line is a pause, not a record. Sending a field the
 * server drops, and telling the operator it landed, is the exact class of lie
 * this rebuild exists to stop. The fix is a backend field.
 */
export function sendBroadcast(dto: {
  channel: SendChannel;
  audience: Audience;
  subject?: string;
  body: string;
}): Promise<SendResult> {
  return deskFetch<SendResult>('/admin/broadcast/send', {
    method: 'POST',
    body: JSON.stringify(dto),
  });
}

/**
 * The failure text, with the right verb on it.
 *
 * ⚠️ describeFailure IN desk-auth PRINTS "GET" FOR EVERY REQUEST. Harmless on
 * a board that only reads; on this surface the difference between "the count
 * failed" and "the send failed" is the whole question, and an operator
 * reading `GET /admin/broadcast/send` cannot tell whether anything went out.
 */
export function describeSendFailure(verb: 'POST' | 'GET', err: unknown): string {
  if (err instanceof DeskFetchError) {
    return `${verb} ${err.path}\n${err.message}${err.body ? `\n\n${err.body}` : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/* ────────────────────────────────────────────────────────────────────────
 * SMS: what it costs, and what is left
 * ──────────────────────────────────────────────────────────────────────── */

/** Billed as two septets each. A curly quote pasted from Word is not here. */
const GSM_EXTENDED = new Set(['\f', '^', '{', '}', '\\', '[', '~', ']', '|', '€']);

/**
 * GSM-03.38, basic table AND the extension table. A body made only of these
 * bills at 160 characters for a single part and 153 per part once it splits;
 * anything outside it drops the whole message to UCS-2 at 70 / 67.
 *
 * ⚠️ THE EXTENSION CHARACTERS BELONG IN HERE, NOT ONLY IN THE SET ABOVE. They
 * were left out once, and because the unicode test runs first that made
 * GSM_EXTENDED unreachable: `{`, `}`, `[`, `]`, `~`, `|`, `^`, `\` and `€` all
 * failed this test, so a perfectly sendable body carrying a euro sign was
 * reported as UCS-2 and priced at 70 characters a part. A 100-character SMS
 * with one `€` in it is one credit per recipient; the drawer showed two, and
 * told the operator to go and hunt for a curly quote that was not there. On a
 * surface whose whole job is to price a blast honestly, that is the number
 * being wrong in the direction that stops a legitimate send.
 */
const GSM_BASIC =
  /^[@£$¥èéùìòÇ\n\rØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,\-./0-9:;<=>?¡A-ZÄÖÑÜ§¿a-zäöñüà\f^{}\\[~\]|€]*$/;

export interface SmsShape {
  /** How many messages SMSPortal will bill for one recipient. */
  parts: number;
  /** Characters used out of the current part's budget. */
  used: number;
  /** The budget for the current part. */
  perPart: number;
  /** True when one non-GSM character has collapsed the whole body to 70s. */
  unicode: boolean;
}

/**
 * ⚠️ ONE CURLY APOSTROPHE COSTS HALF THE MESSAGE. A body pasted out of a
 * document is usually unicode without anyone meaning it, and the count goes
 * from 160 characters to 70 for every recipient. The drawer shows this
 * because the operator can fix it in one keystroke — but only if told.
 */
export function smsShape(body: string): SmsShape {
  const unicode = !GSM_BASIC.test(body);
  if (unicode) {
    // UTF-16 units, which is what a UCS-2 message is measured in — an emoji
    // is two, exactly as the vendor counts it.
    const units = body.length;
    const parts = units <= 70 ? 1 : Math.ceil(units / 67);
    return { parts, used: units, perPart: parts <= 1 ? 70 : 67, unicode };
  }
  let septets = 0;
  for (const ch of body) septets += GSM_EXTENDED.has(ch) ? 2 : 1;
  const parts = septets <= 160 ? 1 : Math.ceil(septets / 153);
  return { parts, used: septets, perPart: parts <= 1 ? 160 : 153, unicode };
}

export interface CreditReading {
  /** Credits SMSPortal reported. Null when it could not be read. */
  balance: number | null;
  unit: string | null;
  /** The vendor's own words when the read failed. */
  error?: string;
  /** When we asked. A balance is only true as of a moment. */
  fetchedAt: string | null;
}

/**
 * The SMS credit balance, live from the vendor.
 *
 * ⚠️ /admin/credits/snapshot HITS EVERY VENDOR, not just this one, and each
 * has a 5s ceiling — so this can take a couple of seconds and must never
 * block the drawer opening. It also NEVER throws server-side: a vendor that
 * is down comes back as `{ balance: null, error }`, which is why the failure
 * case here is a reading, not an exception.
 */
export async function fetchSmsCredit(): Promise<CreditReading> {
  const rows = await deskFetch<
    {
      service: string;
      balance: number | null;
      unit: string | null;
      fetchedAt: string;
      error?: string;
    }[]
  >('/admin/credits/snapshot');
  const sms = Array.isArray(rows) ? rows.find((r) => r.service === 'smsportal') : undefined;
  if (!sms) {
    return { balance: null, unit: 'credits', error: 'smsportal not in the snapshot', fetchedAt: null };
  }
  return {
    balance: sms.balance,
    unit: sms.unit ?? 'credits',
    error: sms.error,
    fetchedAt: sms.fetchedAt ?? null,
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The plan — everything the confirm restates
 * ──────────────────────────────────────────────────────────────────────── */

export interface CountReading {
  count: number;
  /** ISO. A count is true as of a moment and the send re-counts. */
  at: string;
}

export interface SendPlan {
  channel: SendChannel;
  who: string;
  /** "1,284". */
  countLabel: string;
  count: number;
  /** False when the number is a ceiling rather than a headcount. */
  exact: boolean;
  /** What the number means, in words the confirm prints verbatim. */
  countNote: string;
  countedAt: string | null;
  subject: string | null;
  body: string;
  /** Everything the send does besides delivering the message. */
  alsoDoes: string;
  /** What the operator is left with afterwards. */
  then: string;
  /** The server will refuse the send while any of these stand. */
  blockers: string[];
  /** True, not blocking, and worth reading before pressing. */
  cautions: string[];
  /** Estimated SMS credits for the whole blast. Null on email. */
  creditsNeeded: number | null;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-ZA');
}

/**
 * What the previewed count actually promises.
 *
 * ⚠️ THIS IS THE FUNCTION THE WHOLE MODULE EXISTS FOR. Read the header note:
 * on SMS, every audience except `all-users` and `dormant` counts members, not
 * phones. Saying "1,284 will receive this" there is a number the send will
 * not match, and the operator finds out from the skipped counter afterwards.
 */
export function describeCount(
  audience: Audience,
  channel: SendChannel,
  count: number,
): { exact: boolean; note: string } {
  const n = formatCount(count);
  if (channel === 'email') {
    // Every account row carries an email — the column is non-null and unique,
    // and closed accounts are excluded before the count. So the count matches
    // the number of addresses the send will WALK. It is not a delivery figure;
    // see the mute caution in buildPlan.
    return {
      exact: true,
      note: `${n} ${count === 1 ? 'address' : 'addresses'}. Every account has one, so nobody drops out of this number for want of a way to reach them.`,
    };
  }
  if (audience.kind === 'all-users') {
    // ⚠️ FILTERED ON A VERIFIED PHONE, NOT ON THE MEMBER'S SMS PREFERENCE.
    // resolveRecipients uses { phone: not null, phoneVerified: true } here and
    // stops there — only `dormant` also checks notifySmsEnabled. Saying this
    // audience is "filtered to who can be texted" read as a delivery promise
    // it does not make.
    return {
      exact: true,
      note: `${n} verified ${count === 1 ? 'phone' : 'phones'}. This audience is filtered to members with a verified number — but not, unlike Dormant, to members who still have SMS switched on.`,
    };
  }
  if (audience.kind === 'segment' && segmentSpec(audience.segment).smsFiltersOnPhone) {
    return {
      exact: true,
      note: `${n} verified ${count === 1 ? 'phone' : 'phones'} with SMS notifications on. This segment is filtered to who can lawfully be texted.`,
    };
  }
  // The upper-bound case: the count is the size of the audience, and the
  // sender drops the numberless ones as it goes.
  return {
    exact: false,
    note: `At most ${n}. This is the size of the audience, not a count of phones — members with no number on file are skipped at send, and members with an UNVERIFIED number are texted anyway. The real figure lands in the result.`,
  };
}

export function buildPlan(input: {
  channel: SendChannel;
  audience: Audience;
  subject: string;
  body: string;
  reading: CountReading | null;
  credit: CreditReading | null;
}): SendPlan {
  const { channel, audience, reading, credit } = input;
  const body = input.body.trim();
  const subject = input.subject.trim();
  const count = reading?.count ?? 0;
  const { exact, note } = describeCount(audience, channel, count);

  const blockers: string[] = [];
  const cautions: string[] = [];

  if (!reading) blockers.push('The recipient count has not been read yet.');
  if (reading && count === 0) {
    blockers.push('The audience resolves to nobody. The server refuses a send with 0 recipients.');
  }
  if (count > RECIPIENT_CAP) {
    blockers.push(
      `${formatCount(count)} is over the ${formatCount(RECIPIENT_CAP)} cap. The server refuses the whole send — it does not send the first ${formatCount(RECIPIENT_CAP)}. Narrow the audience.`,
    );
  }
  if (body.length < BODY_MIN) blockers.push(`The body must be at least ${BODY_MIN} characters.`);
  if (channel === 'email' && subject.length < SUBJECT_MIN) {
    blockers.push(`An email needs a subject of at least ${SUBJECT_MIN} characters.`);
  }
  if (channel === 'sms' && body.length > SMS_MAX) {
    blockers.push(`An SMS body is capped at ${SMS_MAX} characters here.`);
  }
  if (channel === 'email' && body.length > EMAIL_MAX) {
    blockers.push(`An email body is capped at ${formatCount(EMAIL_MAX)} characters.`);
  }
  if (audience.kind === 'individual' && !('userId' in audience && audience.userId.trim())) {
    blockers.push('No member id.');
  }

  let creditsNeeded: number | null = null;
  if (channel === 'sms') {
    const shape = smsShape(body);
    creditsNeeded = shape.parts * Math.max(count, 0);
    if (shape.unicode) {
      cautions.push(
        `A non-GSM character in the body drops every message to 70 characters a part, so this costs ${shape.parts} ${shape.parts === 1 ? 'credit' : 'credits'} per recipient instead of one. A curly quote or a dash pasted from a document is usually the cause.`,
      );
    } else if (shape.parts > 1) {
      cautions.push(
        `The body is ${shape.parts} parts, so it bills ${shape.parts} credits per recipient — about ${formatCount(creditsNeeded)} for this blast.`,
      );
    }
    if (credit && credit.balance !== null && creditsNeeded > credit.balance) {
      cautions.push(
        `The estimate is above the ${formatCount(credit.balance)} credits SMSPortal reported. The send is not stopped by us; it will simply start failing part-way through, and the ones already gone cannot be pulled back.`,
      );
    }
    if (credit && credit.balance === null) {
      cautions.push(
        `The SMS credit balance could not be read${credit.error ? ` (${credit.error})` : ''}, so there is nothing to check the estimate against.`,
      );
    }
  }

  if (audience.kind === 'segment') {
    const spec = segmentSpec(audience.segment);
    if (!spec.requiresMarketingConsent) {
      cautions.push(
        'This segment is not filtered on a marketing opt-in — only Dormant is. It is a service audience, and whether this message is marketing is your call, not the server’s.',
      );
    }
  }
  if (audience.kind === 'all-users') {
    cautions.push(
      'Everyone. Every non-banned, non-closed account that can be reached on this channel, in one press.',
    );
  }

  /**
   * ⚠️ THE MUTE, WHICH IS THE ONE THING THE COUNT CANNOT SEE.
   *
   * NotificationsService is the single chokepoint for both channels, and it
   * drops a message silently when the member has switched that channel off
   * (notifyEmailEnabled / notifySmsEnabled). None of that is in the preview
   * query except on Dormant SMS, and — this is the half that hides it — the
   * broadcast loop still counts the muted member as SENT. So they are inside
   * the number, they are inside "sent", they never appear in "skipped", and
   * they receive nothing. Without this line the operator has no way to learn
   * it, before or after.
   */
  const muteFiltered =
    channel === 'sms' &&
    audience.kind === 'segment' &&
    segmentSpec(audience.segment).smsFiltersOnPhone;
  const channelWord = channel === 'sms' ? 'SMS' : 'notification email';
  if (!muteFiltered) {
    cautions.push(
      audience.kind === 'individual'
        ? `If this member has switched ${channelWord} off in their own settings, the send drops it silently and still reports it as sent. Nothing on this screen or in the result can tell you which happened.`
        : `Members who have switched ${channelWord} off in their own settings are inside this number and are dropped silently at send. They are counted as sent, not as skipped, so the result will not show them either. Only the Dormant SMS audience filters them out up front.`,
    );
  }

  return {
    channel,
    who: describeAudience(audience),
    countLabel: formatCount(count),
    count,
    exact,
    countNote: note,
    countedAt: reading ? stamp(reading.at) : null,
    subject: channel === 'email' ? subject || null : null,
    body,
    // ⚠️ THE INBOX ROW IS WRITTEN AFTER THE `continue`, NOT BEFORE IT.
    // AdminBroadcastService.send skips to the next recipient the moment the
    // address or the number is missing, and the persist() call sits below that
    // skip — so a member counted in the ceiling gets no message AND no inbox
    // row. This line used to say "whether or not the message itself reaches
    // them", which was false for exactly the population the ceiling warning is
    // about. A member whose channel is merely MUTED does still get the row,
    // because the mute returns quietly instead of skipping.
    alsoDoes:
      'Everyone the send actually reaches also gets a dismissible row in their in-app inbox, on both channels — including members who have muted the channel. Members skipped for having no address or number on file get neither.',
    then: 'An audit row records the channel, the audience, the recipient count and the first 200 characters of the body.',
    blockers,
    cautions,
    creditsNeeded,
  };
}

/**
 * How long ago the count was taken, in the Desk's own spelling.
 *
 * A count over a minute old on a surface that sends is worth re-reading: the
 * send re-resolves the audience, so somebody who signed up in between is in
 * it and the confirm's number was never theirs.
 */
export function countAge(at: string): string {
  const secs = (Date.now() - new Date(at).getTime()) / 1000;
  if (secs < 45) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Arriving pre-set
 * ──────────────────────────────────────────────────────────────────────── */

export interface SendPreset {
  open: boolean;
  channel?: SendChannel;
  segment?: SendSegment;
}

/**
 * `?send=1&channel=sms&segment=dormant` — the legacy deep link, kept.
 *
 * ⚠️ THIS IS A REAL CAPABILITY, NOT DECORATION. /admin/broadcast supported
 * exactly these params so the Insights "Re-engage dormant users" card could
 * hand an operator a composed audience in one click. The Desk has no such
 * card yet, and dropping the entrance would have quietly closed the door for
 * the one that is coming.
 *
 * ⚠️ AND EVERY VALUE IS VALIDATED AGAINST THE UNIONS. A query string is
 * whatever was in the address bar; letting an unchecked one pick the audience
 * for a send is how a link decides who gets texted.
 */
export function parseSendPreset(search: string): SendPreset {
  const p = new URLSearchParams(search);
  if (p.get('send') !== '1') return { open: false };
  const channel = p.get('channel');
  const segment = p.get('segment');
  return {
    open: true,
    channel: channel === 'sms' || channel === 'email' ? channel : undefined,
    segment: SEND_SEGMENTS.some((s) => s.value === segment)
      ? (segment as SendSegment)
      : undefined,
  };
}

/** The same query with the Send params removed, for a history replace. */
export function stripSendPreset(search: string): string {
  const p = new URLSearchParams(search);
  p.delete('send');
  p.delete('channel');
  p.delete('segment');
  const qs = p.toString();
  return qs ? `?${qs}` : '';
}

/* ────────────────────────────────────────────────────────────────────────
 * Campaigns — the key the blast is attributed by
 * ──────────────────────────────────────────────────────────────────────── */

export interface Campaign {
  id: string;
  key: string;
  name: string;
  headline: string | null;
  active: boolean;
  /** Banner impressions — first arrival per browser session, per key. */
  hits: number;
  lastHitAt: string | null;
  createdAt: string;
  /** Accounts created off the link. First-touch, captured at sign-up. */
  signups?: number;
  /** Of those accounts, how many went on to list something. */
  sellers?: number;
}

export function fetchCampaigns(): Promise<Campaign[]> {
  return deskFetch<Campaign[]>('/admin/campaigns');
}

/** MarketingService.adminCreate rejects anything else, with this message. */
export const CAMPAIGN_KEY_RE = /^[a-z0-9-]{2,24}$/;

/**
 * ⚠️ CREATED LIVE. `active` defaults to true in the schema, so the key works
 * the moment it exists. That is harmless while nobody has the link and
 * decidedly not harmless the moment one is in an SMS.
 */
export function createCampaign(dto: { key: string; name: string; headline?: string }) {
  return deskFetch<Campaign>('/admin/campaigns', {
    method: 'POST',
    body: JSON.stringify({
      key: dto.key.trim().toLowerCase(),
      name: dto.name.trim(),
      headline: dto.headline?.trim() || undefined,
    }),
  });
}

export function toggleCampaign(id: string) {
  return deskFetch<Campaign>(`/admin/campaigns/${encodeURIComponent(id)}/toggle`, {
    method: 'POST',
  });
}

/** The link that rides in the SMS. */
export function campaignLink(key: string): string {
  return `${SITE_URL}/?c=${encodeURIComponent(key)}`;
}

/**
 * What turning a key off actually does.
 *
 * ⚠️ IT IS NOT JUST THE BANNER. MarketingService.resolve returns null for an
 * inactive key, and the frontend only parks the attribution token when resolve
 * answers — so an off key stops counting sign-ups as well as showing the
 * welcome card. Anyone who arrives on a live SMS link afterwards is
 * attributed to nothing, and there is no backfill.
 */
export function describeToggle(campaign: Campaign): { title: string; body: string } {
  if (campaign.active) {
    return {
      title: `Turn “${campaign.name}” off?`,
      body:
        'Arrivals on this link stop seeing the welcome banner, and — the part that is easy to miss — stop being attributed. Sign-ups from an SMS already in the wild will count against nothing, and it cannot be backfilled. Hits and sign-ups already recorded stay.',
    };
  }
  return {
    title: `Turn “${campaign.name}” back on?`,
    body:
      'Anyone arriving with this key sees the welcome banner once per session again, and sign-ups off the link start being attributed to it from now. The time it was off stays uncounted.',
  };
}

/**
 * ⚠️ THE KEY IS ATTRIBUTED BY THE LINK IN THE BODY, NOTHING ELSE. The
 * broadcast endpoint has no idea campaigns exist: it takes a channel, an
 * audience and some text. Choosing a campaign here inserts its link — that
 * insertion IS the attribution, and a blast sent without it is untraceable no
 * matter which key was selected on screen.
 */
export function bodyWithCampaignLink(body: string, key: string): string {
  const link = campaignLink(key);
  if (body.includes(link)) return body;
  const base = body.trimEnd();
  return base ? `${base}\n\n${link}` : link;
}

export function bodyCarriesLink(body: string, key: string): boolean {
  return body.includes(campaignLink(key));
}
