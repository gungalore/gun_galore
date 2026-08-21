import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SmsService } from '../sms/sms.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { encryptText, tryDecryptText } from '../common/blob-crypto';
import {
  validateWitnessSubmission,
  witnessFullName,
  WITNESS_FORM_VERSION,
  type WitnessAnswers,
} from './motivation-witness-form';
import { LICENCE_TYPE_LABELS } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// THE WITNESS FLOW.
//
// Operator, 2026-08-21: "The applicant must enter the name and cell number of
// the two persons. We will then send them a link to electronicly fill in the
// form and sign it... we give the token an expiry of 1 hour. So the applicant
// needs to arrange prior with the witness that they will receive the link. We
// also must send a verification code to the witness to verify their number."
//
// ⚠️ THE TOKEN DOES NOT IMPERSONATE ANYBODY, and that is the single most
// important line in this file. The QR scan handoff sets request.clerkUserId to
// the authorising member, so everything downstream runs as them — correct
// there, because the phone is the SAME PERSON. Here the holder of the link is
// a stranger. A token that authenticated them AS the applicant would hand
// somebody the applicant's documents, identity number and motivation because
// they received an SMS. Every route below resolves the token to ONE WITNESS
// ROW and can touch nothing else.
//
// ⚠️ AND THE LINK ALONE IS NOT THE CREDENTIAL EITHER. An SMS can be forwarded
// and a URL can be shoulder-read; the code sent to the nominated number is
// what ties the statement to the person the applicant nominated. Both are
// required.
//
// ⚠️ ONE HOUR, WHICH IS SHORT ON PURPOSE. It means the applicant has to speak
// to their witness first — "I'm sending you a link now" — which is exactly the
// conversation that should happen before somebody signs a statement about you.
// A link that sits in an inbox for a week is a link somebody clicks without
// remembering why.
// ────────────────────────────────────────────────────────────────────

/** How long a witness has from the moment the applicant sends the link. */
export const WITNESS_TOKEN_TTL_MS = 60 * 60 * 1000;

/** The verification code, mirroring the phone-change OTP on User. */
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_LENGTH = 4;
const MAX_OTP_ATTEMPTS = 5;

/** Two, because that is what a pack files. */
export const WITNESS_SLOTS = [1, 2] as const;

/** ⚠️ EVERY INVITE IS A PAID SMS. A mistyped number must not become a loop. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/** The largest signature we will store — a canvas trace, not a photograph. */
const SIGNATURE_MAX_BYTES = 400 * 1024;

function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export interface WitnessSummary {
  id: string;
  slot: number;
  invitedName: string;
  invitedPhone: string;
  status: string;
  openedAt: Date | null;
  signedAt: Date | null;
  declinedAt: Date | null;
  /** Only once completed — what they actually said. */
  answers?: WitnessAnswers;
  signedPlace?: string | null;
  hasSignature?: boolean;
}

@Injectable()
export class MotivationWitnessService {
  private readonly logger = new Logger(MotivationWitnessService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sms: SmsService,
    private readonly files: SecureFileStorageService,
    private readonly tokens: ActionTokensService,
  ) {}

  // ── The applicant's side ────────────────────────────────────────

  /** Both slots, filled or empty. */
  async list(motivationId: string): Promise<WitnessSummary[]> {
    const rows = await this.prisma.motivationWitness.findMany({
      where: { motivationId },
      orderBy: { slot: 'asc' },
    });
    return rows.map((r) => this.summarise(r));
  }

  private summarise(r: {
    id: string;
    slot: number;
    invitedName: string;
    invitedPhone: string;
    status: string;
    openedAt: Date | null;
    signedAt: Date | null;
    declinedAt: Date | null;
    answersEncrypted: string | null;
    signedPlace: string | null;
    signatureKey: string | null;
  }): WitnessSummary {
    const base: WitnessSummary = {
      id: r.id,
      slot: r.slot,
      invitedName: r.invitedName,
      invitedPhone: r.invitedPhone,
      status: r.status,
      openedAt: r.openedAt,
      signedAt: r.signedAt,
      declinedAt: r.declinedAt,
    };
    // ⚠️ THE CONTENTS ONLY ONCE IT IS SIGNED. A half-finished statement is not
    // the witness's word on anything, and showing the applicant a draft would
    // let them lean on somebody mid-answer.
    if (r.status !== 'COMPLETED') return base;
    return {
      ...base,
      answers: this.readAnswers(r.answersEncrypted),
      signedPlace: r.signedPlace,
      hasSignature: Boolean(r.signatureKey),
    };
  }

  private readAnswers(encrypted: string | null): WitnessAnswers {
    if (!encrypted) return {};
    const plain = tryDecryptText(encrypted);
    if (!plain) return {};
    try {
      const parsed: unknown = JSON.parse(plain);
      return parsed && typeof parsed === 'object'
        ? (parsed as WitnessAnswers)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Invite somebody into a slot, and send them the link.
   *
   * Minting and sending are one action on purpose: a token with no SMS behind
   * it is a link nobody has, and an SMS with no token in it is a dead end.
   */
  async invite(args: {
    motivationId: string;
    applicantUserId: string;
    applicantName: string;
    slot: number;
    name: string;
    phone: string;
    baseUrl: string;
  }): Promise<WitnessSummary> {
    if (!WITNESS_SLOTS.includes(args.slot as 1 | 2)) {
      throw new BadRequestException('There are two witness slots.');
    }
    const name = args.name.trim();
    const phone = args.phone.trim();
    if (name.length < 2) throw new BadRequestException('Please give their name.');
    if (phone.replace(/\D/g, '').length < 9) {
      throw new BadRequestException('That does not look like a phone number.');
    }

    const existing = await this.prisma.motivationWitness.findUnique({
      where: {
        motivationId_slot: { motivationId: args.motivationId, slot: args.slot },
      },
    });

    // ⚠️ A COMPLETED STATEMENT IS NOT OVERWRITTEN BY A NEW INVITE. The
    // applicant deletes it first, deliberately, and the deletion is the thing
    // they have to choose — otherwise "invite" quietly destroys somebody's
    // signed statement because the applicant typed into the wrong box.
    if (existing?.status === 'COMPLETED') {
      throw new BadRequestException(
        'That slot already holds a completed statement. Delete it first if you want to ask somebody else.',
      );
    }
    // ⚠️ A DECLINE SKIPS THE COOLDOWN. The cooldown exists to stop a mistyped
    // number becoming a loop of paid messages to the same wrong phone; after a
    // refusal the applicant is inviting a DIFFERENT person, and making them
    // wait out a minute for somebody else's "no" is a penalty for a thing they
    // did not do.
    if (
      existing &&
      existing.status !== 'DECLINED' &&
      Date.now() - existing.updatedAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      throw new BadRequestException(
        'Please wait a minute before sending another link.',
      );
    }

    const row = existing
      ? await this.prisma.motivationWitness.update({
          where: { id: existing.id },
          data: {
            invitedName: name,
            invitedPhone: phone,
            status: 'INVITED',
            // A fresh invite starts clean, or a previous witness's half-answers
            // would be waiting for whoever opens the new link.
            otpHash: null,
            otpExpiresAt: null,
            otpAttempts: 0,
            verifiedAt: null,
            openedAt: null,
            declinedAt: null,
            answersEncrypted: null,
          },
        })
      : await this.prisma.motivationWitness.create({
          data: {
            motivationId: args.motivationId,
            slot: args.slot,
            invitedName: name,
            invitedPhone: phone,
          },
        });

    const token = await this.tokens.mint({
      purpose: 'WITNESS_STATEMENT',
      targetType: 'motivationwitness',
      targetId: row.id,
      // ⚠️ THE APPLICANT, AND IT MEANS ONLY "who asked for this". Nothing on
      // the witness routes reads this field to authenticate anybody — see the
      // note at the top of this file.
      authorisedUserId: args.applicantUserId,
      expiresAt: new Date(Date.now() + WITNESS_TOKEN_TTL_MS),
    });

    const link = `${args.baseUrl.replace(/\/$/, '')}/witness/${token}`;
    const sent = await this.sms.sendSms({
      to: phone,
      message:
        `${args.applicantName} has asked you to complete a character statement ` +
        `for a firearm licence application.\n\n${link}\n\n` +
        `This link works for one hour. All Outdoor.`,
      reference: `witness-${row.id}`,
    });

    if (!sent.success) {
      throw new BadRequestException(
        'Could not send the SMS. Check the number and try again.',
      );
    }

    this.logger.log(`Invited witness ${row.id} (slot ${args.slot})`);
    return this.summarise({ ...row, status: 'INVITED' });
  }

  /**
   * Delete a witness, freeing the slot.
   *
   * Operator: "They have full right to delete it. if they delete it the spot
   * to enter a new witness name and number opens."
   */
  async remove(motivationId: string, witnessId: string): Promise<void> {
    const row = await this.prisma.motivationWitness.findFirst({
      where: { id: witnessId, motivationId },
      select: { id: true, signatureKey: true },
    });
    if (!row) throw new NotFoundException('Witness not found');
    await this.prisma.motivationWitness.delete({ where: { id: row.id } });
    if (row.signatureKey) {
      // Their signature goes with it. Keeping a stranger's signature after the
      // statement it belonged to has been discarded is keeping it for nothing.
      await this.files.remove(row.signatureKey).catch(() => undefined);
    }
  }

  // ── The witness's side ──────────────────────────────────────────

  /**
   * Resolve a link to the one row it authorises.
   *
   * ⚠️ RETURNS THE ROW, NOT A USER. Every caller works from this and nothing
   * else; there is no path from here to the applicant's record.
   */
  async resolve(token: string) {
    const resolved = await this.tokens.resolve(token).catch(() => null);
    if (
      !resolved ||
      resolved.purpose !== 'WITNESS_STATEMENT' ||
      resolved.targetType !== 'motivationwitness'
    ) {
      throw new NotFoundException('This link is not valid.');
    }
    if (resolved.expiresAt.getTime() < Date.now()) {
      throw new ForbiddenException(
        'This link has expired. Ask the applicant to send you a new one.',
      );
    }
    const row = await this.prisma.motivationWitness.findUnique({
      where: { id: resolved.targetId },
      include: {
        motivation: {
          select: {
            id: true,
            licenceType: true,
            answersEncrypted: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('This link is not valid.');
    return row;
  }

  /**
   * The applicant's name, for the witness's screen.
   *
   * ⚠️ THE NAME AND NOTHING ELSE. This is the only fact about the applicant
   * that crosses to a stranger's phone, and it has to: a person cannot give a
   * character statement about somebody they have not been named. Everything
   * else on that motivation stays where it is.
   */
  async applicantNameFor(row: {
    motivation: { answersEncrypted: string | null };
  }): Promise<string> {
    const answers = this.readAnswers(row.motivation.answersEncrypted);
    return (answers.full_name ?? '').trim() || 'The applicant';
  }

  /** "Section 16 — dedicated hunter", so they know what they are vouching for. */
  async licenceLabelFor(row: {
    motivation: { licenceType: string };
  }): Promise<string> {
    return (
      (LICENCE_TYPE_LABELS as Record<string, string>)[row.motivation.licenceType] ??
      'a firearm licence'
    );
  }

  /**
   * "No, thank you."
   *
   * Operator, 2026-08-21: "the possible witness can also decline straight off
   * when they open the link... Decline expires the 1 hour token immediately so
   * the applicant can send it to a new witness."
   *
   * ⚠️ NO CODE REQUIRED, AND THAT IS DELIBERATE. Making somebody prove they own
   * a phone number before letting them say no is perverse: it demands work of
   * a person whose answer is that they do not want to be involved. The link is
   * enough. The worst a forwarded link can do here is decline on the real
   * witness's behalf, and the cost of that is the applicant inviting somebody
   * again — which is precisely what a decline is for.
   *
   * ⚠️ THE TOKEN IS CONSUMED, not left to expire. `resolve` refuses a consumed
   * token, so the link is dead the instant they tap the button — no window in
   * which somebody could reopen it and be walked through a form they have
   * already refused.
   */
  async decline(
    token: string,
    witnessId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{ declined: true }> {
    const row = await this.prisma.motivationWitness.findUnique({
      where: { id: witnessId },
      select: { id: true, status: true, signatureKey: true },
    });
    if (!row) throw new NotFoundException('This link is not valid.');
    if (row.status === 'COMPLETED') {
      throw new BadRequestException(
        'This statement has already been signed and cannot be withdrawn here.',
      );
    }

    await this.prisma.motivationWitness.update({
      where: { id: row.id },
      data: {
        status: 'DECLINED',
        declinedAt: new Date(),
        // Nothing half-entered survives a refusal. Somebody who declines has
        // not given us answers, and anything typed on the way to the button is
        // not theirs to have kept.
        answersEncrypted: null,
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        verifiedAt: null,
      },
    });

    await this.tokens.consume(token, ip, userAgent).catch(() => undefined);
    this.logger.log(`Witness ${row.id} declined`);
    return { declined: true };
  }

  /** Send the verification code to the number the applicant nominated. */
  async sendCode(witnessId: string): Promise<{ sent: true }> {
    const row = await this.prisma.motivationWitness.findUnique({
      where: { id: witnessId },
      select: {
        id: true,
        invitedPhone: true,
        status: true,
        otpExpiresAt: true,
      },
    });
    if (!row) throw new NotFoundException('This link is not valid.');
    if (row.status === 'COMPLETED') {
      throw new BadRequestException('This statement has already been signed.');
    }

    const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(
      OTP_LENGTH,
      '0',
    );
    const sent = await this.sms.sendSms({
      // ⚠️ TO THE NOMINATED NUMBER, NEVER TO ONE SUPPLIED BY THE CALLER. The
      // number is the whole point of the check; letting the page choose where
      // the code goes would make the check verify nothing.
      to: row.invitedPhone,
      message: `All Outdoor verification code: ${code}\n\nValid for 10 minutes.`,
      reference: `witness-otp-${row.id}`,
    });
    if (!sent.success) {
      throw new BadRequestException(
        'Could not send the code. Please try again in a moment.',
      );
    }

    await this.prisma.motivationWitness.update({
      where: { id: row.id },
      data: {
        otpHash: hashOtp(code),
        otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
        otpAttempts: 0,
        openedAt: new Date(),
      },
    });
    return { sent: true };
  }

  /** Check the code. */
  async verifyCode(witnessId: string, code: string): Promise<{ ok: true }> {
    const row = await this.prisma.motivationWitness.findUnique({
      where: { id: witnessId },
      select: {
        id: true,
        otpHash: true,
        otpExpiresAt: true,
        otpAttempts: true,
        status: true,
      },
    });
    if (!row) throw new NotFoundException('This link is not valid.');
    if (row.status === 'COMPLETED') {
      throw new BadRequestException('This statement has already been signed.');
    }
    if (!row.otpHash || !row.otpExpiresAt) {
      throw new BadRequestException('Ask for a code first.');
    }
    if (row.otpExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('That code has expired. Ask for a new one.');
    }
    if (row.otpAttempts >= MAX_OTP_ATTEMPTS) {
      throw new BadRequestException(
        'Too many attempts. Ask for a new code.',
      );
    }
    if (hashOtp((code ?? '').trim()) !== row.otpHash) {
      await this.prisma.motivationWitness.update({
        where: { id: row.id },
        data: { otpAttempts: { increment: 1 } },
      });
      throw new BadRequestException('That code is not right.');
    }

    await this.prisma.motivationWitness.update({
      where: { id: row.id },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      },
    });
    return { ok: true };
  }

  /**
   * Store the completed statement.
   *
   * ⚠️ ONCE, AND THEN NEVER AGAIN. A statement the witness can revise after
   * signing is not a signed statement, and one the APPLICANT could revise
   * would be worthless — the whole value of this document is that somebody
   * other than the applicant wrote it.
   */
  async submit(args: {
    witnessId: string;
    answers: WitnessAnswers;
    signature: Buffer;
    signatureMime: string;
    place?: string;
    ip?: string;
    userAgent?: string;
  }) {
    const row = await this.prisma.motivationWitness.findUnique({
      where: { id: args.witnessId },
      select: { id: true, status: true, verifiedAt: true },
    });
    if (!row) throw new NotFoundException('This link is not valid.');
    if (row.status === 'COMPLETED') {
      throw new BadRequestException('This statement has already been signed.');
    }
    if (!row.verifiedAt) {
      throw new ForbiddenException('Please verify your number first.');
    }

    const check = validateWitnessSubmission(args.answers);
    if (!check.ok) {
      throw new BadRequestException({
        message: 'Some answers still need attention.',
        problems: check.problems,
      });
    }

    if (!args.signature?.length) {
      throw new BadRequestException('Please sign before you submit.');
    }
    if (args.signature.length > SIGNATURE_MAX_BYTES) {
      throw new BadRequestException('That signature is too large.');
    }
    if (args.signatureMime !== 'image/png') {
      // The canvas produces PNG. Anything else did not come from our form.
      throw new BadRequestException('Unexpected signature format.');
    }

    const stored = await this.files.write(
      'motivations',
      args.signature,
      new Date(),
    );

    await this.prisma.motivationWitness.update({
      where: { id: row.id },
      data: {
        status: 'COMPLETED',
        answersEncrypted: encryptText(
          JSON.stringify({ ...args.answers, _version: WITNESS_FORM_VERSION }),
        ),
        signatureKey: stored.storageKey,
        signatureMime: args.signatureMime,
        signedPlace: (args.place ?? '').trim().slice(0, 160) || null,
        signedAt: new Date(),
        submitIp: (args.ip ?? '').slice(0, 64) || null,
        submitUserAgent: (args.userAgent ?? '').slice(0, 300) || null,
      },
    });

    this.logger.log(
      `Witness ${row.id} signed (${witnessFullName(args.answers)})`,
    );
    return { ok: true as const };
  }

  /** The signature bytes, for the printed statement and the applicant's view. */
  async signature(witnessId: string): Promise<Buffer | null> {
    const row = await this.prisma.motivationWitness.findUnique({
      where: { id: witnessId },
      select: { signatureKey: true },
    });
    if (!row?.signatureKey) return null;
    return this.files.read(row.signatureKey).catch(() => null);
  }
}
