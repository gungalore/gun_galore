import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { encryptText, tryDecryptText } from '../common/blob-crypto';

// ────────────────────────────────────────────────────────────────────
// THE PREVIOUS OWNER'S CONSENT.
//
// Operator, 2026-08-23: "we only need the previous owners Valid license. think
// we can create a consent form to be sent to the previous owner (same as the
// witness statement) we make it valid for 48 hours... It must have their full
// name, ID number, Fire arm make, model and serial number, auto insert the
// date they signed it, auto detect their location of signature, their
// signature... And then we can also add two photo with camera of the front and
// back of the license."
//
// ⚠️ THE TOKEN DOES NOT IMPERSONATE ANYBODY. Same rule as the witness flow and
// the same reason: the holder of this link is a stranger to us. A token that
// authenticated them AS the applicant would hand somebody else's identity
// number and motivation to whoever received an SMS. Every route resolves the
// token to ONE CONSENT ROW and can touch nothing else.
//
// ⚠️ FORTY-EIGHT HOURS, WHERE A WITNESS GETS ONE. The witness hour is short on
// purpose — it forces the applicant to phone their witness first. A seller is
// different: a transfer is arranged over days, the buyer often cannot reach
// them on demand, and a link that dies in an hour means starting again.
//
// ⚠️ AND NO VERIFICATION CODE. Operator, 2026-08-23: "drop the OTP, just send
// it straight to the seller for consent."
//
// The witness flow needs one because a character statement can be given from
// the link alone, and a link can be forwarded. A consent cannot: the seller
// has to photograph their own licence card, both sides, and those photographs
// are part of the submission. That is a possession factor the witness flow
// does not have, and a stronger one than a four-digit SMS code — a code proves
// somebody controls a phone, the card proves they are holding the licence.
//
// Neither control ever addressed the real hole, which is that the APPLICANT
// supplies the number: a dishonest buyer can enter their own. An OTP verifies
// that a number is reachable, never whose it is. The card photograph does more
// against that than the code did.
//
// ⚠️ WHAT IS BEING SIGNED IS A STATEMENT ABOUT A SPECIFIC FIREARM. Everything
// here that looks like over-care about the make, model and serial is that: a
// consent naming no serial is worthless to a DFO, and a consent naming the
// WRONG serial is worse than worthless.
// ────────────────────────────────────────────────────────────────────

/** How long the seller has from the moment the applicant sends the link. */
export const CONSENT_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

/** Minimum gap between invitations, so "send again" is not a spam button. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/** A drawn signature is small. Anything larger did not come from our canvas. */
const SIGNATURE_MAX_BYTES = 400 * 1024;

/** A phone camera photograph of a licence card, generously. */
const LICENCE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

/** What the seller types about themselves. Everything else we already know. */
export interface ConsentAnswers {
  fullName: string;
  idNumber: string;
}

/**
 * The firearm, exactly as it appears on the seller's own licence card.
 *
 * ⚠️ VERBATIM, INCLUDING THE WORD "NONE". Operator, 2026-08-23: "You insert
 * exactly what is on the license card, as that is what is registered with the
 * SAPS system. if it says NONE, you put NONE."
 *
 * A real card reads `Model NONE` and `Frame Serial No NONE` while the receiver
 * carries the number — that is not a gap in the card, it is what SAPS holds.
 * Tidying it away, collapsing it to blank, or "helpfully" copying the barrel
 * serial into the frame field would make our document disagree with the
 * register it is supposed to match.
 *
 * ⚠️ AND "NONE" IS NOT THE SAME AS UNREAD. A field the OCR could not make out
 * must stay `undefined` and be typed by the seller. Writing "NONE" for it
 * would be asserting to a DFO that the card says NONE when we simply could not
 * read it — a false statement on a document somebody signs. Every renderer
 * below has to keep the two apart.
 *
 * Snapshotted at INVITE time and rendered from at print time — never re-read
 * from the live application. See the schema comment.
 */
export interface FirearmSnapshot {
  /**
   * The unlabelled number beside the holder's ID number (e.g. 3086, 3088).
   *
   * ⚠️ CAPTURED BUT NOT PRINTED, BECAUSE WE DO NOT KNOW WHAT IT IS. Across
   * five real cards it tracks the SECTION and not the firearm — every
   * Section 16 card reads 3088 and the Section 15 card reads 3086 — so it is
   * not a per-firearm licence number, whatever else it may be. The card itself
   * gives it no label. Printing it under a heading we invented would be us
   * asserting something to a DFO that we cannot support, so it stays out of
   * the list until somebody who knows confirms it. See CARD_ROWS.
   */
  unlabelledNumber?: string;
  make?: string;
  model?: string;
  /** "S/L: RIFLE CAL - RIFLE/CARBINE" — copied whole, not parsed. */
  type?: string;
  calibre?: string;
  /** The card's headline "Serial Number" row. */
  serial?: string;
  barrelSerial?: string;
  /** ⚠️ THE CARD HAS THIS AND OUR VAULT EXTRACTION DID NOT. */
  receiverSerial?: string;
  frameSerial?: string;
  /**
   * ⚠️ EACH SERIAL ROW CARRIES ITS OWN MAKE, and they genuinely differ. One
   * real card reads barrel CZ, receiver NONE, frame NONE; another reads barrel
   * NONE, receiver MARLIN, frame NONE. They are part of what is registered, so
   * "exactly what is on the card" includes them.
   */
  barrelMake?: string;
  receiverMake?: string;
  frameMake?: string;
  /** Section the licence was issued under, e.g. "SECTION 16". */
  section?: string;
  /** The applicant, named in the declaration the seller signs. */
  applicantName: string;
  applicantIdNumber?: string;
}

/**
 * The firearm rows, in the order they are printed under the declaration.
 *
 * ⚠️ A LIST, NOT A SENTENCE. Operator: "have all the details in a list form
 * and not embeded in the declaration sentence... Just make the declaration of
 * the current owners details states that the fire arm listed below."
 * A declaration that swallows nine card fields into one paragraph reads badly
 * and, worse, invites the writer to paraphrase them. A labelled list is what a
 * DFO is already reading on the card itself.
 */
// ⚠️ `unlabelledNumber` IS DELIBERATELY ABSENT. See the field's own note: we
// hold it, we do not know what it is called, and a made-up heading on a signed
// document is worse than an omission.
export const CARD_ROWS: { key: keyof FirearmSnapshot; label: string }[] = [
  { key: 'section', label: 'Section' },
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'type', label: 'Type' },
  { key: 'calibre', label: 'Calibre' },
  { key: 'serial', label: 'Serial number' },
  { key: 'barrelSerial', label: 'Barrel serial number' },
  { key: 'barrelMake', label: 'Barrel make' },
  { key: 'receiverSerial', label: 'Receiver serial number' },
  { key: 'receiverMake', label: 'Receiver make' },
  { key: 'frameSerial', label: 'Frame serial number' },
  { key: 'frameMake', label: 'Frame make' },
];

/**
 * The rows to print, skipping only what was never established.
 *
 * ⚠️ AN EMPTY VALUE IS DROPPED; "NONE" IS PRINTED. That asymmetry is the whole
 * point — see the interface above.
 */
export function cardRowsFor(
  f: FirearmSnapshot,
): { label: string; value: string }[] {
  return CARD_ROWS.map(({ key, label }) => ({
    label,
    value: String(f[key] ?? '').trim(),
  })).filter((r) => r.value.length > 0);
}

export const CONSENT_FORM_VERSION = 1;

// ────────────────────────────────────────────────────────────────────
// THE CARD IS THE SOURCE OF TRUTH FOR THE FIREARM.
//
// Operator, 2026-08-24: "extract all the information from the card and use it
// because it is a government issued card and should match their information
// exactly making it the source of truth."
//
// Two directions, kept apart on purpose:
//   - THE SIGNED CONSENT prints the card EXACTLY (cardRowsFor, raw, "NONE"
//     included — it is a legal declaration about a specific firearm).
//   - THE BUYER'S APPLICATION adopts a USABLE subset (mapCardType below, "NONE"
//     dropped, one serial), and only after the buyer confirms it. That is why
//     these are separate: the declaration wants the card verbatim, the
//     application wants values a form can hold.
// ────────────────────────────────────────────────────────────────────

/** Firearm-describing keys on the snapshot — everything except the applicant. */
const CARD_FIELD_KEYS: (keyof FirearmSnapshot)[] = [
  'unlabelledNumber',
  'make',
  'model',
  'type',
  'calibre',
  'serial',
  'barrelSerial',
  'receiverSerial',
  'frameSerial',
  'barrelMake',
  'receiverMake',
  'frameMake',
  'section',
];

/**
 * A firearm the seller confirmed off their card, trimmed and capped.
 *
 * ⚠️ THE APPLICANT FIELDS ARE NOT IN CARD_FIELD_KEYS, so they can never be
 * overwritten from this input. Who the firearm is going to is the buyer's to
 * state; what the firearm IS, is the card's.
 */
export function sanitiseCardFirearm(
  input: Partial<Record<keyof FirearmSnapshot, unknown>> | undefined,
): Partial<FirearmSnapshot> {
  const out: Partial<FirearmSnapshot> = {};
  for (const k of CARD_FIELD_KEYS) {
    const v = String(input?.[k] ?? '').trim();
    if (v) (out as Record<string, string>)[k] = v.slice(0, 120);
  }
  return out;
}

/**
 * The card's coarse firearm category → the application's fixed choice.
 *
 * ⚠️ THE CARD DOES NOT USE OUR WORDS. It reads "MANUALLY OPERATED RIFLE" or
 * "S/L: RIFLE CAL - RIFLE/CARBINE"; firearm_type offers only
 * Rifle/Shotgun/Handgun/Combination. An unmapped type returns undefined and
 * the buyer picks it — the confirm step is exactly where that is caught, so we
 * never guess a category onto a signed application.
 */
export function mapCardType(cardType?: string): string | undefined {
  const t = (cardType ?? '').toUpperCase();
  if (!t) return undefined;
  if (/COMBINAT/.test(t)) return 'Combination';
  if (/\b(RIFLE|CARBINE)\b/.test(t)) return 'Rifle';
  if (/SHOTGUN/.test(t)) return 'Shotgun';
  if (/PISTOL|REVOLVER|HANDGUN/.test(t)) return 'Handgun';
  return undefined;
}

/** The first serial that is present and is not the card's literal "NONE". */
export function primarySerial(f: Partial<FirearmSnapshot>): string | undefined {
  for (const v of [f.serial, f.barrelSerial, f.receiverSerial, f.frameSerial]) {
    const t = (v ?? '').trim();
    if (t && t.toUpperCase() !== 'NONE') return t;
  }
  return undefined;
}

/**
 * The card firearm mapped onto the buyer's application answer keys.
 *
 * ⚠️ "NONE" IS DROPPED HERE, UNLIKE THE PRINTED CONSENT. A model of NONE is a
 * true statement about the card and prints on the declaration; writing the
 * word "NONE" into a free-text application field is not a value, it is noise.
 * So the declaration keeps it and the application does not.
 */
export function cardToApplicationFirearm(
  f: Partial<FirearmSnapshot>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const keep = (v?: string) => {
    const t = (v ?? '').trim();
    return t && t.toUpperCase() !== 'NONE' ? t : undefined;
  };
  const make = keep(f.make);
  if (make) out.firearm_make = make;
  const model = keep(f.model);
  if (model) out.firearm_model = model;
  const type = mapCardType(f.type);
  if (type) out.firearm_type = type;
  const calibre = keep(f.calibre);
  if (calibre) out.firearm_calibre = calibre;
  const serial = primarySerial(f);
  if (serial) out.firearm_serial = serial;
  return out;
}

@Injectable()
export class MotivationSellerConsentService {
  private readonly logger = new Logger(MotivationSellerConsentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly files: SecureFileStorageService,
    private readonly tokens: ActionTokensService,
  ) {}

  /**
   * Send the seller their link.
   *
   * ⚠️ HARD-GATED ON THE FIREARM BEING IDENTIFIED. firearm_serial is optional
   * elsewhere in the registry — plenty of a motivation can be written before
   * the firearm is found — but a consent is a statement about ONE firearm and
   * an unserialled one gives a DFO nothing to match against the licence being
   * transferred. Refused by name rather than sent half-empty.
   */
  async invite(args: {
    motivationId: string;
    /**
     * The CLERK subject, not our User.id — resolved below.
     *
     * ⚠️ NAMED FOR WHAT IT IS. It was `applicantUserId`, the controller passed
     * the Clerk subject into it, and the name was the whole reason nobody
     * spotted that the value was wrong all the way down to a foreign key.
     */
    applicantClerkId: string;
    applicantName: string;
    name: string;
    phone: string;
    firearm: FirearmSnapshot;
    baseUrl: string;
  }) {
    // ⚠️ RESOLVE THE CLERK SUBJECT TO OUR OWN USER ROW. `User.id` is a cuid
    // and `User.clerkId` is `user_...`; they are different values, and
    // ActionToken.authorisedUserId is a REQUIRED foreign key to User.id. The
    // controller passed the Clerk subject straight through, so every invite
    // this flow ever attempted died on a foreign-key violation — a 500, before
    // any SMS. The witness flow does not have the bug because it resolves
    // through requireOwnMotivation first; this is the same resolution.
    const user = await this.prisma.user.findUnique({
      where: { clerkId: args.applicantClerkId },
      select: { id: true },
    });
    // ⚠️ AND CHECK THE MOTIVATION IS ACTUALLY THEIRS. Nothing here did. The
    // route is guarded, so the caller is signed in, but the id in the path was
    // never matched against them — so any member could attach a consent to
    // somebody else's application, overwrite a pending one, and spend our SMS
    // credits doing it. "Not found" rather than "not yours": whether a given
    // motivation exists is not something a stranger is entitled to learn.
    const owns = user
      ? await this.prisma.motivation.findFirst({
          where: { id: args.motivationId, userId: user.id },
          select: { id: true },
        })
      : null;
    if (!user || !owns) throw new NotFoundException('Motivation not found');

    const name = args.name.trim();
    const phone = args.phone.trim();
    if (name.length < 2) throw new BadRequestException('Enter their name.');
    if (!/^\+?\d[\d\s-]{7,}$/.test(phone)) {
      throw new BadRequestException('Enter a valid mobile number.');
    }

// ⚠️ MAKE AND A SERIAL. NOT MODEL — a real card reads `Model NONE`, so
    // requiring one would refuse a perfectly ordinary firearm.
    //
    // ⚠️ AND ANY OF THE FOUR SERIAL ROWS COUNTS. The card carries a headline
    // serial plus barrel, receiver and frame rows, and which of them is filled
    // varies by firearm — the example that prompted this has the number on the
    // barrel and receiver with the frame reading NONE. Demanding the headline
    // one specifically would refuse those.
    const anySerial = [
      args.firearm.serial,
      args.firearm.barrelSerial,
      args.firearm.receiverSerial,
      args.firearm.frameSerial,
    ].some((v) => (v ?? '').trim() && (v ?? '').trim().toUpperCase() !== 'NONE');
    if (!(args.firearm.make ?? '').trim() || !anySerial) {
      throw new BadRequestException(
        'Fill in the firearm\'s make and at least one serial number before asking the owner to consent — a consent has to name the firearm it is about.',
      );
    }

    const existing = await this.prisma.motivationSellerConsent.findUnique({
      where: { motivationId: args.motivationId },
      select: { id: true, status: true, createdAt: true, updatedAt: true },
    });
    if (existing?.status === 'COMPLETED') {
      throw new BadRequestException(
        'The owner has already signed. Delete that consent first if you need a new one.',
      );
    }
    if (
      existing &&
      Date.now() - existing.updatedAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException('Give it a minute before sending again.');
    }

    // ⚠️ THE SNAPSHOT IS TAKEN HERE, not at signing. It is what the seller will
    // be shown and what the printed consent will say, so it has to be fixed
    // before the link leaves.
    const snapshot = encryptText(
      JSON.stringify({ ...args.firearm, _version: CONSENT_FORM_VERSION }),
    );

    const row = existing
      ? await this.prisma.motivationSellerConsent.update({
          where: { id: existing.id },
          data: {
            invitedName: name,
            invitedPhone: phone,
            status: 'INVITED',
            firearmSnapshotEncrypted: snapshot,
            // A fresh invitation is a fresh start.
            declinedAt: null,
            answersEncrypted: null,
            openedAt: null,
          },
        })
      : await this.prisma.motivationSellerConsent.create({
          data: {
            motivationId: args.motivationId,
            invitedName: name,
            invitedPhone: phone,
            firearmSnapshotEncrypted: snapshot,
          },
        });

    // ⚠️ EVERYTHING PAST THE ROW IS ROLLED BACK ON FAILURE. The row has to
    // exist before the token can point at it, so a mint or send that throws
    // used to leave a row sitting at INVITED with no token and no SMS — and
    // because the resend cooldown below keys on updatedAt, that dead row then
    // locked the applicant out of retrying for a full minute. A first attempt
    // that fails must cost nothing.
    try {
      const token = await this.tokens.mint({
        purpose: 'SELLER_CONSENT',
        targetType: 'motivationsellerconsent',
        targetId: row.id,
        // Who ASKED. Never used to authenticate the caller — see the file header.
        authorisedUserId: user.id,
        expiresAt: new Date(Date.now() + CONSENT_TOKEN_TTL_MS),
      });

      const link = `${args.baseUrl.replace(/\/$/, '')}/consent/${token}`;
      const sent = await this.sms.sendSms({
        to: phone,
        message:
          `${args.applicantName} is applying for a licence for the ` +
          `${args.firearm.make} (serial ${
            [
              args.firearm.serial,
              args.firearm.barrelSerial,
              args.firearm.receiverSerial,
              args.firearm.frameSerial,
            ]
              .map((v) => (v ?? '').trim())
              .find((v) => v && v.toUpperCase() !== 'NONE') ?? '—'
          }) and needs your consent as the current owner.\n\n${link}\n\n` +
          `This link works for 48 hours. All Outdoor.`,
        reference: `consent-${row.id}`,
      });
      if (!sent.success) {
        throw new BadRequestException(
          'Could not send the SMS. Check the number and try again.',
        );
      }
    } catch (err) {
      // Only a row THIS call created. An existing one predates the failure and
      // deleting it would throw away a consent the applicant already had.
      if (!existing) {
        await this.prisma.motivationSellerConsent
          .delete({ where: { id: row.id } })
          .catch(() => undefined);
      }
      throw err;
    }

    this.logger.log(`Invited seller consent ${row.id}`);
    return { id: row.id, status: 'INVITED' as const };
  }

  /**
   * Resolve a link.
   *
   * ⚠️ AN EXPIRED LINK SAYS SO. The witness version wraps resolve() in
   * `.catch(() => null)`, which swallows the GoneException the token service
   * throws on expiry — so its expiry branch is unreachable and a stale link
   * reports "not valid", which reads like a wrong or fraudulent link rather
   * than an old one. Over 48 hours that will happen often enough to matter,
   * and the person it happens to is not our member and cannot ask us why.
   */
  async resolve(token: string) {
    let resolved: Awaited<ReturnType<ActionTokensService['resolve']>> | null =
      null;
    try {
      resolved = await this.tokens.resolve(token);
    } catch (err) {
      if ((err as { status?: number })?.status === 410) {
        throw new ForbiddenException(
          'This link has expired. Ask the buyer to send you a new one.',
        );
      }
      throw new NotFoundException('This link is not valid.');
    }
    if (
      !resolved ||
      resolved.purpose !== 'SELLER_CONSENT' ||
      resolved.targetType !== 'motivationsellerconsent'
    ) {
      throw new NotFoundException('This link is not valid.');
    }
    if (resolved.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException(
        'This link has expired. Ask the buyer to send you a new one.',
      );
    }
    const row = await this.prisma.motivationSellerConsent.findUnique({
      where: { id: resolved.targetId },
    });
    if (!row) throw new NotFoundException('This link is not valid.');
    return row;
  }

  /** The firearm as it was when the link was sent. */
  firearmFor(row: {
    firearmSnapshotEncrypted: string | null;
  }): FirearmSnapshot | null {
    if (!row.firearmSnapshotEncrypted) return null;
    const raw = tryDecryptText(row.firearmSnapshotEncrypted);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as FirearmSnapshot;
    } catch {
      return null;
    }
  }

  /**
   * Stamp the first time the seller opened the link.
   *
   * ⚠️ "OPENED" HERE MEANS OPENED. The witness flow stamps its equivalent
   * inside sendCode, so its openedAt actually means "asked for a code" — an
   * applicant chasing a witness is reading a field that does not say what its
   * name says. With no code step to hide behind, this one is stamped where it
   * belongs, once, on the first GET.
   */
  async markOpened(consentId: string): Promise<void> {
    await this.prisma.motivationSellerConsent
      .updateMany({
        where: { id: consentId, openedAt: null },
        data: { openedAt: new Date() },
      })
      .catch(() => undefined);
  }

  /** Nobody is obliged to consent. Recorded so the buyer stops waiting. */
  async decline(consentId: string): Promise<{ ok: true }> {
    const row = await this.prisma.motivationSellerConsent.findUnique({
      where: { id: consentId },
      select: { id: true, status: true },
    });
    if (!row) throw new NotFoundException('This link is not valid.');
    if (row.status === 'COMPLETED') {
      throw new BadRequestException('This consent has already been signed.');
    }
    await this.prisma.motivationSellerConsent.update({
      where: { id: row.id },
      data: { status: 'DECLINED', declinedAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * The signed consent, the signature, and the two licence photographs.
   *
   * ⚠️ THE LICENCE PHOTOGRAPHS BECOME REAL UPLOADS, not columns on this row,
   * and that is deliberate on two counts. They ARE documents — they belong in
   * the pack, and SELLER_LICENCE is the checklist row a private transfer
   * already expects — so filing them anywhere else would mean a member who has
   * just been sent them still sees that row outstanding. And the retention
   * sweep walks motivationUpload: a file stored as a bare key on this row would
   * never be purged, which is exactly the bug MotivationWitness.signatureKey
   * has today.
   */
  async submit(args: {
    consentId: string;
    answers: ConsentAnswers;
    /**
     * The firearm as the SELLER confirmed it off their own card — the OCR's
     * proposal, reviewed and corrected on screen. This BECOMES the firearm of
     * record: the card is the government's document, so it, not the buyer's
     * invite-time guess, is what the signed consent declares.
     */
    firearm?: Partial<Record<keyof FirearmSnapshot, unknown>>;
    signature: Buffer;
    signatureMime: string;
    licenceFront: Buffer;
    licenceBack: Buffer;
    licenceMime: string;
    place?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const row = await this.prisma.motivationSellerConsent.findUnique({
      where: { id: args.consentId },
      select: {
        id: true,
        motivationId: true,
        status: true,
        // Needed to preserve the applicant identity while the firearm fields
        // are replaced with the card's — see the snapshot rebuild below.
        firearmSnapshotEncrypted: true,
      },
    });
    if (!row) throw new NotFoundException('This link is not valid.');
    if (row.status === 'COMPLETED') {
      throw new BadRequestException('This consent has already been signed.');
    }
    // ⚠️ NO VERIFICATION GATE — see the file header. What stands in its place
    // is further down: a signature AND both sides of the licence card are all
    // required before this row can reach COMPLETED.

    const fullName = (args.answers?.fullName ?? '').trim();
    const idNumber = (args.answers?.idNumber ?? '').replace(/\s/g, '');
    if (fullName.length < 3) {
      throw new BadRequestException('Enter your full name.');
    }
    // ⚠️ LENGTH ONLY, NO LUHN. The witness form makes the same call and states
    // the reason: a seller with a passport or an older document must not be
    // refused by a checksum written for one document type.
    if (!/^\d{13}$/.test(idNumber)) {
      throw new BadRequestException(
        'Enter your 13-digit South African identity number.',
      );
    }

    if (!args.signature?.length) {
      throw new BadRequestException('Please sign before you submit.');
    }
    if (args.signature.length > SIGNATURE_MAX_BYTES) {
      throw new BadRequestException('That signature is too large.');
    }
    if (args.signatureMime !== 'image/png') {
      throw new BadRequestException('Unexpected signature format.');
    }
    for (const [label, bytes] of [
      ['front', args.licenceFront],
      ['back', args.licenceBack],
    ] as const) {
      if (!bytes?.length) {
        throw new BadRequestException(
          `Please photograph the ${label} of your licence.`,
        );
      }
      if (bytes.length > LICENCE_PHOTO_MAX_BYTES) {
        throw new BadRequestException(
          `That photograph of the ${label} is too large.`,
        );
      }
    }
    if (
      args.licenceMime !== 'image/jpeg' &&
      args.licenceMime !== 'image/png'
    ) {
      // The annexure layout embeds JPEG and PNG only; anything else would be
      // stored and then silently left out of the printed pack.
      throw new BadRequestException('Photographs must be JPEG or PNG.');
    }

    const signature = await this.files.write(
      'motivations',
      args.signature,
      new Date(),
    );

    // The two photographs, as SELLER_LICENCE uploads on the application.
    const written: string[] = [];
    try {
      for (const bytes of [args.licenceFront, args.licenceBack]) {
        const stored = await this.files.write('motivations', bytes, new Date());
        written.push(stored.storageKey);
        try {
          await this.prisma.motivationUpload.create({
            data: {
              motivationId: row.motivationId,
              kind: 'SELLER_LICENCE',
              storageKey: stored.storageKey,
              mimeType: args.licenceMime,
              byteSize: stored.byteSize,
              sha256: stored.sha256,
            },
          });
        } catch (err) {
          // ⚠️ THE SAME PHOTOGRAPH TWICE IS NOT AN ERROR THE SELLER CAN FIX.
          // @@unique([motivationId, sha256]) fires when somebody photographs
          // the same side twice, and telling a stranger their consent failed
          // over a duplicate file would lose the whole statement.
          if ((err as { code?: string })?.code !== 'P2002') throw err;
          await this.files.remove(stored.storageKey).catch(() => undefined);
        }
      }
    } catch (err) {
      for (const key of written) {
        await this.files.remove(key).catch(() => undefined);
      }
      await this.files.remove(signature.storageKey).catch(() => undefined);
      throw err;
    }

    // ⚠️ THE CARD REPLACES THE FIREARM FIELDS, THE APPLICANT STAYS. The
    // snapshot was set at invite from what the BUYER typed; the seller has now
    // confirmed what the government card actually says, so the card's fields
    // win. The applicant identity (who it is going to) is the buyer's and is
    // preserved by spreading the old snapshot first — sanitiseCardFirearm
    // cannot touch those keys. If the card fields somehow arrive empty (OCR
    // dead, seller cleared them), the buyer's values remain rather than the
    // declaration being blanked.
    const existingSnap = row.firearmSnapshotEncrypted
      ? (JSON.parse(tryDecryptText(row.firearmSnapshotEncrypted) ?? '{}') as Record<
          string,
          unknown
        >)
      : {};
    const cardFirearm = sanitiseCardFirearm(args.firearm);
    const rebuiltSnapshot = encryptText(
      JSON.stringify({
        ...existingSnap,
        ...cardFirearm,
        _version: CONSENT_FORM_VERSION,
      }),
    );

    await this.prisma.motivationSellerConsent.update({
      where: { id: row.id },
      data: {
        status: 'COMPLETED',
        answersEncrypted: encryptText(
          JSON.stringify({
            fullName,
            idNumber,
            _version: CONSENT_FORM_VERSION,
          }),
        ),
        firearmSnapshotEncrypted: rebuiltSnapshot,
        signatureKey: signature.storageKey,
        signatureMime: args.signatureMime,
        licenceFrontKey: written[0] ?? null,
        licenceBackKey: written[1] ?? null,
        licenceMime: args.licenceMime,
        signedPlace: (args.place ?? '').trim().slice(0, 160) || null,
        signedAt: new Date(),
        submitIp: (args.ip ?? '').slice(0, 64) || null,
        submitUserAgent: (args.userAgent ?? '').slice(0, 300) || null,
      },
    });

    this.logger.log(`Seller consent ${row.id} signed`);
    return { ok: true as const };
  }

  /**
   * The consent's state for the BUYER, and — once signed — the firearm the
   * card records, ready to adopt into their application.
   *
   * ⚠️ THE CARD FIREARM IS ONLY OFFERED WHEN COMPLETED. Before the seller
   * signs, the snapshot still holds the buyer's own invite-time guess; handing
   * that back as "the card records" would be circular. cardFirearm is null
   * until the government document has actually been read and confirmed.
   *
   * ⚠️ OWNER-GATED. Resolves the Clerk subject to our User row and checks the
   * motivation is theirs — the same lesson as the invite route; the id in the
   * path is never trusted on its own. "Not found" rather than "not yours".
   */
  async statusFor(
    applicantClerkId: string,
    motivationId: string,
  ): Promise<{
    status: 'NONE' | 'INVITED' | 'COMPLETED' | 'DECLINED';
    invitedName: string | null;
    cardFirearm: Record<string, string> | null;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: applicantClerkId },
      select: { id: true },
    });
    const owns = user
      ? await this.prisma.motivation.findFirst({
          where: { id: motivationId, userId: user.id },
          select: { id: true },
        })
      : null;
    if (!user || !owns) throw new NotFoundException('Motivation not found');

    const row = await this.prisma.motivationSellerConsent.findUnique({
      where: { motivationId },
      select: {
        status: true,
        invitedName: true,
        declinedAt: true,
        firearmSnapshotEncrypted: true,
      },
    });
    if (!row) {
      return { status: 'NONE', invitedName: null, cardFirearm: null };
    }

    const status = (
      row.declinedAt ? 'DECLINED' : row.status
    ) as 'INVITED' | 'COMPLETED' | 'DECLINED';

    let cardFirearm: Record<string, string> | null = null;
    if (status === 'COMPLETED' && row.firearmSnapshotEncrypted) {
      const snap = JSON.parse(
        tryDecryptText(row.firearmSnapshotEncrypted) ?? '{}',
      ) as Partial<FirearmSnapshot>;
      const mapped = cardToApplicationFirearm(snap);
      cardFirearm = Object.keys(mapped).length ? mapped : null;
    }

    return { status, invitedName: row.invitedName, cardFirearm };
  }

  /** The signature bytes, for the printed consent. */
  async signature(consentId: string): Promise<Buffer | null> {
    const row = await this.prisma.motivationSellerConsent.findUnique({
      where: { id: consentId },
      select: { signatureKey: true },
    });
    if (!row?.signatureKey) return null;
    return this.files.read(row.signatureKey).catch(() => null);
  }
}
