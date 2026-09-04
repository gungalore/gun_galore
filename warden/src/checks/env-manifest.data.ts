// warden/src/checks/env-manifest.data.ts
//
// THE MANIFEST. Every variable the app actually reads, what tier of
// failure its absence causes, and — the part that makes the row useful —
// WHAT SILENTLY STOPS WORKING when it is missing. A board row saying
// "PEACH_SECRET missing" is a fact; "PEACH_SECRET missing → inbound Peach
// webhooks are rejected, so orders never confirm as paid" is the finding.
//
// ⚠️ DERIVED FROM A GREP OF process.env.* ACROSS backend/src AND frontend,
// NOT from docs/ENVIRONMENT.md or the .env.example files — all three are
// themselves stale (BOBGO_*, GOOGLE_VISION_API_KEY, PUBLIC_WEB_URL,
// CIP_SHEETS_DIR, five ANTHROPIC_MODEL_* vars, WARDEN_BASE_URL/TOKEN and
// NEXT_PUBLIC_LICENCE_SERVICES_ENABLED are used in code and documented
// nowhere). A replatform already left ~34 variables behind once; copying a
// stale doc into this file would make Warden another copy of the same
// drift it exists to catch. RE-DERIVE THIS FROM SOURCE PERIODICALLY.
//
// 🚨 VALUES NEVER LEAVE THE ENV FILE. Only presence and length are
// reported, except for the handful of keys on NON_SECRET_ENV_KEYS below —
// modes and public URLs whose value IS the finding. That list is
// deliberate, tested, and the only door.

export type EnvTier =
  /** The process refuses to boot, or the feature refuses unverified input.
   *  Missing this in production is a hard fault. */
  | 'fails-closed'
  /** A named feature silently degrades or disables itself. */
  | 'feature'
  /** Has a coded default. Absence is worth listing, not worth a colour. */
  | 'optional';

export interface EnvVar {
  name: string;
  tier: EnvTier;
  /** What stops working, in the operator's terms. */
  disables: string;
}

export const BACKEND_ENV_MANIFEST: readonly EnvVar[] = [
  // ── fails closed ──────────────────────────────────────────────────────
  { name: 'JWT_ADMIN_SECRET', tier: 'fails-closed', disables: 'the API hard-throws at boot in production' },
  { name: 'DATABASE_URL', tier: 'fails-closed', disables: 'nothing works — no database connection at all' },
  { name: 'CLERK_SECRET_KEY', tier: 'fails-closed', disables: 'no request can be authenticated' },
  { name: 'CLERK_WEBHOOK_SECRET', tier: 'fails-closed', disables: 'Clerk webhooks are dropped unverified — new sign-ups get no User row until their first authed request lazily upserts one' },
  { name: 'BOBGO_WEBHOOK_SECRET', tier: 'fails-closed', disables: 'Bob Go tracking callbacks are rejected — Bob Go is the live courier rail' },
  { name: 'PEACH_SECRET', tier: 'fails-closed', disables: 'inbound Peach webhooks are rejected, so orders never confirm as paid' },
  { name: 'HEALTH_PING_SECRET', tier: 'fails-closed', disables: '/api/health/crons always answers "not configured" — and Warden’s own cron-freshness check goes unknown with it' },
  { name: 'ID_HASH_SECRET', tier: 'fails-closed', disables: 'KYC cannot store or read an SA ID. ⚠️ ROTATING THIS DESTROYS EVERY STORED FILE — it is never a fix for anything' },
  { name: 'FRONTEND_URL', tier: 'fails-closed', disables: 'CORS rejects the site, and every notification link points nowhere' },

  // ── feature-level ─────────────────────────────────────────────────────
  { name: 'NODE_ENV', tier: 'feature', disables: 'production guards do not engage' },
  { name: 'VERIFYNOW_API_KEY', tier: 'feature', disables: 'VerifyNow KYC lookups' },
  { name: 'VERIFYNOW_MODE', tier: 'feature', disables: 'defaults to sandbox — sandbox in production passes fake identities and only WARNs at boot' },
  { name: 'CLOUDINARY_CLOUD_NAME', tier: 'feature', disables: 'every image upload throws — and a listing cannot be created without photos' },
  { name: 'CLOUDINARY_API_KEY', tier: 'feature', disables: 'every image upload throws' },
  { name: 'CLOUDINARY_API_SECRET', tier: 'feature', disables: 'every image upload throws' },
  { name: 'RESEND_API_KEY', tier: 'feature', disables: 'all outbound email' },
  { name: 'SMSPORTAL_CLIENT_ID', tier: 'feature', disables: 'all outbound SMS — sends are logged as STUB instead of being delivered' },
  { name: 'SMSPORTAL_API_SECRET', tier: 'feature', disables: 'all outbound SMS' },
  { name: 'BOBGO_API_KEY', tier: 'feature', disables: 'the live courier rail — with bobgo_enabled on, checkout offers no shipping options at all' },
  { name: 'BOBGO_BASE_URL', tier: 'feature', disables: 'Bob Go calls have no endpoint' },
  { name: 'AWS_REGION', tier: 'feature', disables: 'Textract OCR and Rekognition face match — the SDK falls back to its own default region, which is not Ireland' },
  { name: 'AWS_ACCESS_KEY_ID', tier: 'feature', disables: 'Textract OCR and Rekognition face match / liveness' },
  { name: 'AWS_SECRET_ACCESS_KEY', tier: 'feature', disables: 'Textract OCR and Rekognition face match / liveness' },
  { name: 'AWS_KYC_LIVENESS_ROLE_ARN', tier: 'optional', disables: 'nothing — absence is the SUPPORTED default. Browser liveness credentials are then federated from the server user itself (sts:GetFederationToken, narrowed to StartFaceLivenessSession in eu-west-1). Setting it switches to the tighter AssumeRole path' },
  { name: 'PUDO_API_KEY', tier: 'feature', disables: 'Pudo bookings. ⚠️ no sandbox — every create bills real credits' },
  { name: 'ANTHROPIC_API_KEY', tier: 'feature', disables: 'listing moderation falls back to HUMAN_REVIEW and the contact filter to regex only — fails safe, not closed' },
  { name: 'GOOGLE_VISION_API_KEY', tier: 'feature', disables: 'licence-card OCR — skipped and logged' },
  { name: 'VAPID_PUBLIC_KEY', tier: 'feature', disables: 'web push. ⚠️ matched pair — changing either key kills every existing subscription' },
  { name: 'VAPID_PRIVATE_KEY', tier: 'feature', disables: 'web push' },
  { name: 'PEACH_ENV', tier: 'feature', disables: 'the Peach environment is undefined' },
  { name: 'PEACH_CLIENT_ID', tier: 'feature', disables: 'card payments' },
  { name: 'PEACH_CLIENT_SECRET', tier: 'feature', disables: 'card payments' },
  { name: 'PEACH_MERCHANT_ID', tier: 'feature', disables: 'card payments' },
  { name: 'PEACH_ENTITY_ID', tier: 'feature', disables: 'card payments' },
  { name: 'PAYMENT_MODE', tier: 'feature', disables: 'the payment gate has no mode' },
  { name: 'PAYMENTS_LIVE', tier: 'feature', disables: 'payments stay inert' },
  { name: 'WARDEN_BASE_URL', tier: 'feature', disables: 'the Desk’s Warden card renders "not deployed" — the API never calls this daemon' },
  { name: 'WARDEN_TOKEN', tier: 'feature', disables: 'the same: the API fails closed and never calls this daemon' },
  { name: 'ZOHO_BOOKS_ENABLED', tier: 'feature', disables: 'invoicing into Zoho Books — a half-filled Zoho config silently self-disables rather than throwing' },

  // ── optional, defaulted ───────────────────────────────────────────────
  { name: 'PORT', tier: 'optional', disables: 'nothing — defaults to 3001' },
  { name: 'PUBLIC_API_URL', tier: 'optional', disables: 'nothing — derived' },
  { name: 'PUBLIC_WEB_URL', tier: 'optional', disables: 'motivation consent links fall back — undocumented anywhere, likely overlaps FRONTEND_URL' },
  { name: 'SECURE_UPLOAD_DIR', tier: 'optional', disables: 'nothing — defaults to /home/alloutdoor/secure-uploads, which is what backup.sh tars' },
  { name: 'CIP_SHEETS_DIR', tier: 'optional', disables: 'nothing — defaults to /home/alloutdoor/data/cip, which backup.sh does NOT tar (see backup-set-gap)' },
  { name: 'ALLOW_LOCAL_ORIGINS', tier: 'optional', disables: 'nothing — but true in production is itself a fault' },
  { name: 'MEILISEARCH_HOST', tier: 'optional', disables: 'search falls back' },
  { name: 'ANTHROPIC_ADMIN_API_KEY', tier: 'optional', disables: 'AI spend monitoring — prod currently holds a regular key here, so spend alerts are not functioning' },
  { name: 'CLERK_AUTHORIZED_PARTIES', tier: 'optional', disables: 'nothing — token audience checking is looser' },
  { name: 'SUPPORT_EMAIL', tier: 'optional', disables: 'nothing — a default address is used' },
];

export const FRONTEND_ENV_MANIFEST: readonly EnvVar[] = [
  { name: 'NEXT_PUBLIC_API_URL', tier: 'fails-closed', disables: 'the browser has no API to call' },
  { name: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', tier: 'fails-closed', disables: 'nobody can sign in' },
  { name: 'CLERK_SECRET_KEY', tier: 'fails-closed', disables: 'server-side auth in the Next process' },
  { name: 'INTERNAL_API_URL', tier: 'feature', disables: 'server-side rendering calls go out over the public URL instead of loopback' },
  { name: 'NEXT_PUBLIC_SITE_URL', tier: 'feature', disables: 'falls back to https://gungalore.co.za — the WRONG host for All Outdoor' },
  { name: 'NEXT_PUBLIC_PAYMENT_MODE', tier: 'feature', disables: 'the UI can offer a payment path the API will refuse — it mirrors the backend PAYMENT_MODE and a mismatch is the fault' },
  { name: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', tier: 'feature', disables: 'address autocomplete (needs Maps JS + Places + Geocoding all enabled on the key)' },
  { name: 'COMING_SOON_BYPASS_SECRET', tier: 'feature', disables: 'nobody can get past the coming-soon gate while it is on' },
  { name: 'NEXT_PUBLIC_LICENCE_SERVICES_ENABLED', tier: 'optional', disables: 'the licence-services surface — undocumented in .env.example' },
  { name: 'NEXT_PUBLIC_DISABLE_PWA', tier: 'optional', disables: 'nothing — the PWA killswitch' },
  { name: 'NEXT_PUBLIC_ASKGG_CONTEXT', tier: 'optional', disables: 'nothing' },
  { name: 'COMING_SOON_GATE', tier: 'optional', disables: 'nothing — the gate stays off' },
];

/**
 * The ONLY keys whose VALUE may appear in evidence. Every one is a mode
 * flag or a public URL that is already visible to any visitor or already
 * shown on the Desk's own gates board — and in every case the value is the
 * finding ("VERIFYNOW_MODE=sandbox in production"), which presence alone
 * cannot express.
 *
 * ⚠️ Adding a key here is a deliberate decision to print it in a chat
 * message, a proposal and a prompt. A secret must never be added, and a
 * test asserts a non-listed value never escapes.
 */
export const NON_SECRET_ENV_KEYS: ReadonlySet<string> = new Set([
  'NODE_ENV',
  'PAYMENT_MODE',
  'PAYMENTS_LIVE',
  'VERIFYNOW_MODE',
  'PEACH_ENV',
  'ZOHO_BOOKS_ENABLED',
  'ALLOW_LOCAL_ORIGINS',
  'FRONTEND_URL',
  'PUBLIC_API_URL',
  'PUBLIC_WEB_URL',
  'BOBGO_BASE_URL',
  'SECURE_UPLOAD_DIR',
  'CIP_SHEETS_DIR',
  'COMING_SOON_GATE',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_PAYMENT_MODE',
  'NEXT_PUBLIC_DISABLE_PWA',
  'NEXT_PUBLIC_LICENCE_SERVICES_ENABLED',
]);
