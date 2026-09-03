/**
 * THE DESK — the external consoles, in one place.
 *
 * Every third-party service All Outdoor actually runs on, lifted from the
 * operator's "All Outdoor" bookmarks folder and given its REAL name. The
 * bookmarks carry page titles ("Instant SA ID & Vehicle Verification |
 * VerifyNow.co.za", "Console home | Console Home | eu-north-1"), which is what
 * the tab said the day it was saved — useless to scan in a hurry.
 *
 * ⚠️ THIS LIST IS OPERATOR-ONLY. It names which vendors hold this business's
 * money, identity checks and customer data; it lives behind the Desk's auth
 * gate and must never reach a public surface.
 *
 * ⚠️ NO CREDENTIALS, EVER. These are addresses. Not a key, not a token, not an
 * account number — if a link ever needs one to be useful, it does not belong
 * here.
 */

export type ServiceGroup =
  | 'Money'
  | 'Messaging'
  | 'Identity'
  | 'Infrastructure'
  | 'Mail'
  | 'Build & AI';

export interface DeskService {
  /** The service as it is spoken about, not as its page title reads. */
  name: string;
  url: string;
  group: ServiceGroup;
  /** What it is FOR — the reason an operator opens it at 2am. */
  purpose: string;
  /**
   * A standing caution. Rendered as a warn line on the row, so the thing that
   * bites is on screen at the moment of clicking rather than in a doc.
   */
  caution?: string;
}

/**
 * Group order is deliberate: money first, then the things that talk to
 * members, then the things that hold them up. Same priority the pile uses.
 */
export const SERVICE_GROUP_ORDER: ServiceGroup[] = [
  'Money',
  'Messaging',
  'Identity',
  'Infrastructure',
  'Mail',
  'Build & AI',
];

export const DESK_SERVICES: DeskService[] = [
  /* ── Money ────────────────────────────────────────────────────────── */
  {
    name: 'Peach Payments',
    url: 'https://support.peachpayments.com/support/home',
    group: 'Money',
    purpose: 'The card and EFT rail. Support portal.',
    caution: 'Bookmark is the SUPPORT site, not the merchant dashboard.',
  },
  {
    name: 'Bob Go',
    url: 'https://my.bobgo.co.za/dashboard',
    group: 'Money',
    purpose: 'The live courier rail — waybills, tracking, credit balance.',
    caution: 'Every booking starts unconfirmed. Check the submission, not the absence of an error.',
  },

  /* ── Messaging ────────────────────────────────────────────────────── */
  {
    name: 'Meta Business',
    url: 'https://business.facebook.com/select/',
    group: 'Messaging',
    purpose: 'WhatsApp Business account, templates and the phone number.',
    caution: 'The AllOutdoor portfolio is UNVERIFIED — that gates system users and templates.',
  },
  {
    name: 'SMSPortal',
    url: 'https://smsportal.com/',
    group: 'Messaging',
    purpose: 'Outbound SMS — waybill PINs, alerts.',
  },
  {
    name: 'Resend',
    url: 'https://resend.com/',
    group: 'Messaging',
    purpose: 'Transactional email delivery and its logs.',
  },

  /* ── Identity ─────────────────────────────────────────────────────── */
  {
    name: 'Clerk',
    url: 'https://dashboard.clerk.com/apps/app_3DUrDNtWGfkFJugZxQQjsXb4o8S/instances/ins_3DUrDK5eeRq9ZPYSv1aeqqB2Isb',
    group: 'Identity',
    purpose: 'Member sign-in. The production instance.',
    caution: 'pk_live is domain-locked, so the auth cluster never renders on localhost.',
  },
  {
    name: 'VerifyNow',
    url: 'https://www.verifynow.co.za/',
    group: 'Identity',
    purpose: 'SA ID and vehicle verification. Credit balance lives here.',
    caution: 'KYC now runs on Claude vision; this is the fallback rail.',
  },

  /* ── Infrastructure ───────────────────────────────────────────────── */
  {
    name: 'Absolute Hosting',
    url: 'https://client.absolutehosting.co.za/index.php',
    group: 'Infrastructure',
    purpose: 'Domain registrar and the legacy DNS zone.',
    caution: 'The old mydnscloud zone still answers. Every DNS change needs doing twice.',
  },
  {
    name: 'AWS · eu-north-1',
    url: 'https://eu-north-1.console.aws.amazon.com/console/home?region=eu-north-1',
    group: 'Infrastructure',
    purpose: 'Stockholm region console.',
  },
  {
    name: 'Cloudinary',
    url: 'https://cloudinary.com/',
    group: 'Infrastructure',
    purpose: 'Every listing image — storage, transforms and the CDN.',
  },
  {
    /* ⚠️ TWO GOOGLE CLOUD PROJECTS, AND THE KEYS ARE SPLIT ACROSS THEM. Named
       apart on purpose: opening the wrong console and finding no key is how an
       afternoon goes missing. */
    name: 'Google Cloud · alloutdoor-api',
    url: 'https://console.cloud.google.com/apis/dashboard?authuser=1&project=alloutdoor-api',
    group: 'Infrastructure',
    purpose: 'The CURRENT project. Vision OCR lives here.',
    caution: 'The Vision key is IP-locked to the box — it 403s from anywhere else by design.',
  },
  {
    name: 'Google Cloud · dealer scans',
    url: 'https://console.cloud.google.com/apis/library?project=gun-galore-dealer-scans',
    group: 'Infrastructure',
    purpose: 'The OLDER project, still holding the Maps key.',
    caution: 'Legacy. Check here before concluding a Google key is missing.',
  },

  /* ── Mail ─────────────────────────────────────────────────────────── */
  {
    name: 'All Outdoor webmail',
    url: 'https://s1.ahmail.co.za/interface/root#/email',
    group: 'Mail',
    purpose: 'gerhard.fourie@alloutdoor.co.za.',
  },
  {
    name: 'Gun Galore webmail',
    url: 'https://webmail.gungalore.co.za/',
    group: 'Mail',
    purpose: 'The old brand’s mailbox.',
    caution: 'gungalore.co.za serves 410, but its DNS and MX were kept — mail still lands.',
  },

  /* ── Build & AI ───────────────────────────────────────────────────── */
  {
    name: 'GitHub',
    url: 'https://github.com/',
    group: 'Build & AI',
    purpose: 'The repository.',
  },
  {
    name: 'Claude Platform',
    url: 'https://platform.claude.com/dashboard',
    group: 'Build & AI',
    purpose: 'API usage and spend for every AI surface on the site.',
  },
  {
    name: 'DocFly',
    url: 'https://www.docfly.com/dashboard',
    group: 'Build & AI',
    purpose: 'PDF editing for licence and dealer paperwork.',
  },
];

/** The services in one group, in file order. */
export function servicesIn(group: ServiceGroup): DeskService[] {
  return DESK_SERVICES.filter((s) => s.group === group);
}

/**
 * The host, for the row's second line.
 *
 * Shown because the NAME is ours and the HOST is what the operator will see in
 * the address bar — a mismatch between the two is the first sign a link has
 * been tampered with or has quietly moved.
 */
export function serviceHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}
