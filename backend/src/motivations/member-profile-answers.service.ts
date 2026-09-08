import { Injectable, Logger } from '@nestjs/common';
import { MotivationLicenceType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decryptJson, encryptJson } from '../common/blob-crypto';
import {
  AnswerProvenance,
  ProvenanceMap,
  changedKeys,
  markMember,
  parseProvenance,
  stamp,
} from '../common/answer-provenance';
import {
  FIELD_REGISTRY_VERSION,
  allFieldsFor,
} from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// ANSWERS THAT BELONG TO THE PERSON, NOT TO ONE APPLICATION.
//
// ⚠️ THE SECOND APPLICATION MUST NOT ASK WHAT THE FIRST ONE DID. Marital
// status, what somebody's premises look like, what each firearm they already
// own is used for, whether they reload: none of that is a fact about an
// application. Asking it again is the clearest way to tell a member we were
// not listening the first time, and it is the specific complaint the rebuild
// exists to answer — MOTIVATION-INTAKE-PLAN.md §2.3, "profile once,
// application many".
//
// A field says which it is: `MotivationField.scope`. Absent means
// 'application', which is what almost every field is. This service owns the
// 'profile' half and nothing else.
//
// ⚠️ IT IS A STORE, NOT A POLICY. It does not decide what is asked, it does
// not rank anything and it never writes a value nobody supplied. Deciding
// which keys are in scope is a pure function of the registry (profileKeys
// below), so there is exactly one answer to "is this a profile key" and it is
// derived rather than listed.
// ────────────────────────────────────────────────────────────────────

/** What one member's profile holds. */
export interface ProfileAnswers {
  answers: Record<string, string>;
  provenance: ProvenanceMap;
}

/**
 * The profile-scoped keys for a licence type.
 *
 * ⚠️ allFieldsFor, NOT fieldsFor — THE UNFILTERED LIST, DELIBERATELY. A key
 * this type has stopped ASKING is still a key this member may have ANSWERED on
 * a different type of application, and the profile is shared across all of
 * them. Filtering here would mean a section 13 applicant's premises answers
 * were invisible to their section 16 application, which is the entire thing
 * this service exists to prevent. Same reasoning as fieldByKey's.
 */
export function profileKeys(type: MotivationLicenceType): Set<string> {
  return new Set(
    allFieldsFor(type)
      .filter((f) => f.scope === 'profile')
      .map((f) => f.key),
  );
}

/**
 * Split a sanitised answers patch into the application's half and the
 * person's.
 *
 * ⚠️ THE CALLER MUST SANITISE FIRST. This does not validate — it routes. An
 * unregistered key reaching here would be routed into the application half and
 * stored, which is exactly what sanitiseAnswers exists to stop.
 */
export function splitByScope(
  type: MotivationLicenceType,
  patch: Record<string, string>,
): { application: Record<string, string>; profile: Record<string, string> } {
  const keys = profileKeys(type);
  const application: Record<string, string> = {};
  const profile: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (keys.has(key)) profile[key] = value;
    else application[key] = value;
  }
  return { application, profile };
}

@Injectable()
export class MemberProfileAnswersService {
  private readonly logger = new Logger(MemberProfileAnswersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything on this member's profile. Empty for somebody who has none.
   *
   * ⚠️ FAILS SOFT, LIKE EVERY OTHER BLOB READ IN THIS MODULE. A profile we
   * cannot decrypt must degrade to "we hold nothing for you" — which asks the
   * member a few questions again — and never to a 500 that stops them starting
   * an application at all. See MotivationSharedService.readAnswers, which this
   * mirrors deliberately rather than sharing, because that one takes a
   * motivation row.
   */
  async readFor(userId: string): Promise<ProfileAnswers> {
    const row = await this.prisma.memberProfileAnswers.findUnique({
      where: { userId },
      select: { answersEncrypted: true, answerProvenance: true },
    });
    if (!row) return { answers: {}, provenance: {} };

    let answers: Record<string, string> = {};
    if (row.answersEncrypted) {
      try {
        answers = decryptJson<Record<string, string>>(row.answersEncrypted);
      } catch (err) {
        // KEYS ARE METADATA, VALUES ARE NOT — so this logs neither. The user
        // id is enough to find the row.
        this.logger.error(
          `Could not decrypt profile answers for user ${userId}: ${(err as Error).message}`,
        );
        answers = {};
      }
    }
    return { answers, provenance: parseProvenance(row.answerProvenance) };
  }

  /**
   * Write the member's own answers to their profile.
   *
   * ⚠️ ONLY A VALUE THAT ACTUALLY MOVED IS STAMPED MEMBER, and this is the
   * same trap `saveAnswers` documents at length: the sheet resends the whole
   * blob on every autosave, so stamping the payload's keys would flip every
   * prefilled profile answer to MEMBER the first time somebody saved anything
   * at all. MEMBER is ABSORBING — from that moment nothing automatic may fill
   * that field again — so a wrong stamp here is permanent.
   */
  async writeFor(
    userId: string,
    patch: Record<string, string>,
  ): Promise<ProfileAnswers> {
    if (!Object.keys(patch).length) return this.readFor(userId);

    const before = await this.readFor(userId);
    const merged = { ...before.answers, ...patch };
    const provenance = markMember(
      before.provenance,
      changedKeys(before.answers, merged),
    );

    await this.persist(userId, merged, provenance);
    return { answers: merged, provenance };
  }

  /**
   * Write values WE derived — a document reading, a vault adoption — without
   * claiming the member typed them.
   *
   * ⚠️ `stamp` REFUSES TO OVERWRITE A MEMBER ENTRY, which is what makes this
   * safe to call repeatedly. A member who corrected something keeps their
   * correction; everything else is filled in for them, which is the operator's
   * standing rule (2026-08-25: fill it in, arm it, let them change it).
   */
  async writeDerived(
    userId: string,
    values: Record<string, string>,
    source: AnswerProvenance,
  ): Promise<ProfileAnswers> {
    if (!Object.keys(values).length) return this.readFor(userId);

    const before = await this.readFor(userId);
    const keys = Object.keys(values).filter(
      (k) => before.provenance[k]?.source !== 'MEMBER',
    );
    if (!keys.length) return before;

    const merged = { ...before.answers };
    for (const k of keys) merged[k] = values[k];

    const provenance = stamp(before.provenance, keys, {
      source: source.source,
      sourceId: source.sourceId,
      from: source.from,
    });

    await this.persist(userId, merged, provenance);
    return { answers: merged, provenance };
  }

  private async persist(
    userId: string,
    answers: Record<string, string>,
    provenance: ProvenanceMap,
  ): Promise<void> {
    const data = {
      answersEncrypted: encryptJson(answers),
      answersSchemaVersion: FIELD_REGISTRY_VERSION,
      answerProvenance: provenance as unknown as object,
    };
    // ⚠️ UPSERT ON THE UNIQUE userId, NOT find-then-create. Two saves landing
    // together — the sheet autosaves, and a vault adoption can fire at the
    // same moment — would otherwise both find nothing and both insert, and the
    // unique index would turn the second into a 500 on a keystroke.
    await this.prisma.memberProfileAnswers.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }
}
