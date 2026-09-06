import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MotivationUploadKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { encryptJson, decryptJson } from '../common/blob-crypto';
import {
  ProvenanceMap,
  parseProvenance,
  stamp,
} from '../common/answer-provenance';
import { MotivationQuotaService } from './motivation-quota.service';
import {
  uploadKindsFor,
  CredentialChoices,
  credentialChoices,
  CredentialSource,
  credentialOffer,
  toIsoDay,
} from './motivation-credentials';
import {
  FIELD_REGISTRY_VERSION,
  fieldByKey,
  missingRequired,
  sanitiseAnswers,
} from './motivation-fields';
import { decryptSaIdNumber } from '../common/id-crypto';
import { CARRIES_FORWARD, priorAnswers, priorReadings } from './prior-readings';
import { documentLabel } from './motivation-documents';
import {
  ProfileSource,
  profileCoverageNote,
  profileOffer,
} from './motivation-profile';
import { EDITABLE, MotivationSharedService } from './motivation-shared.service';

// ────────────────────────────────────────────────────────────────────
// PREFILL — what we already know about this member, offered rather than
// asked for again: their profile, their Document Centre credentials, and
// what they answered on a previous application.
// ────────────────────────────────────────────────────────────────────

@Injectable()
export class MotivationPrefillService {
  private readonly logger = new Logger(MotivationPrefillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: MotivationQuotaService,
    private readonly shared: MotivationSharedService,
  ) {}

  // ────────────────────────────────────────────────────────────────
  // FILLING FROM THE PROFILE, WITH PERMISSION
  // ────────────────────────────────────────────────────────────────

  /** Load the profile fields we are allowed to look at, ID decrypted. */
  async profileFor(userId: string): Promise<ProfileSource> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        idNumberEncrypted: true,
        addrBuilding: true,
        addrStreet: true,
        addrAddress2: true,
        addrSuburb: true,
        addrCity: true,
        addrPostalCode: true,
        addrProvince: true,
      },
    });

    // A stored ID that will not decrypt is not an error worth failing on: the
    // applicant types it instead, which is exactly what they would do if the
    // profile had never held one. Failing here would block the whole offer over
    // one field.
    let idNumber: string | null = null;
    if (u?.idNumberEncrypted) {
      try {
        idNumber = decryptSaIdNumber(u.idNumberEncrypted);
      } catch {
        idNumber = null;
      }
    }

    return {
      firstName: u?.firstName ?? null,
      lastName: u?.lastName ?? null,
      email: u?.email ?? null,
      phone: u?.phone ?? null,
      idNumber,
      addrBuilding: u?.addrBuilding ?? null,
      addrStreet: u?.addrStreet ?? null,
      addrAddress2: u?.addrAddress2 ?? null,
      addrSuburb: u?.addrSuburb ?? null,
      addrCity: u?.addrCity ?? null,
      addrPostalCode: u?.addrPostalCode ?? null,
      addrProvince: u?.addrProvince ?? null,
    };
  }

  /**
   * What we WOULD copy from the profile, and where each value came from.
   *
   * Read-only and safe to call before any decision — showing the applicant the
   * list is the whole point. Nothing is written until useProfile().
   */
  // ── the Licence Centre, read-only ─────────────────────────────────
  //
  // ⚠️ WHY THIS READS THE TABLE INSTEAD OF CALLING THE VAULT'S SERVICE.
  // LicenceCentreModule already imports MotivationsModule (it owns the renewal
  // one-tap), so importing it back would be a module cycle. The seam already
  // works this way in the other direction — licence-centre.service.ts reads
  // the Motivation table directly for its idempotency check while calling the
  // service for the write. The rule across this seam is: call the service to
  // WRITE, read the table to READ. Nothing here ever writes a Credential; the
  // confirmedAt invariant keeps its single owner.

  /**
   * Load the member's vault rows, decrypted, in a shape the pure offer can use.
   *
   * confirmedAt IS NOT NULL is not a nicety. An unconfirmed row holds an expiry
   * date nobody has checked, read off a photograph — the same reason the
   * reminder sweep will not look at one.
   */
  async credentialsFor(
    userId: string,
    opts: { includeUnconfirmed?: boolean } = {},
  ): Promise<CredentialSource[]> {
    const rows = await this.prisma.credential.findMany({
      // ⚠️ THE CONFIRMATION GATE PROTECTS DATES, NOT NUMBERS. confirmedAt
      // exists so the reminder sweep never acts on an expiry nobody has
      // checked — that stays absolute. But the operator's phone-photographed
      // competency certificate sat here fully read and INVISIBLE to the
      // wizard's dropdown, because uploads from the phone arrive unconfirmed
      // and the confirm prompt only ever ran on the desktop's own upload
      // path. A member picking a certificate NUMBER from a dropdown is
      // looking at the value with the panel telling them to check it — that
      // needs no date ceremony first. Callers that fill things silently keep
      // the default.
      where: {
        userId,
        ...(opts.includeUnconfirmed ? {} : { confirmedAt: { not: null } }),
        purgedAt: null,
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        kind: true,
        title: true,
        expiresOn: true,
        // ⚠️ THE 271 ASKS FOR THE ISSUE DATE AND THE VAULT HAS ALWAYS READ IT.
        // `competency_issued` is a box on the form; the Licence Centre writes
        // this column off the certificate at upload; nothing joined the two,
        // so the member retyped a date we were already storing.
        issuedOn: true,
        confirmedAt: true,
        // ⚠️ THE OTHER HALF OF "DO WE STAND BEHIND THIS DATE". Since 2026-08-25
        // the Centre fills in and ARMS dates itself — dateSource set,
        // confirmedAt null, the reminder sweep already acting on the value.
        // Reading confirmedAt alone therefore withheld from the form every date
        // the sweep was texting people about. Same predicate as the sweep.
        dateSource: true,
        // ⚠️ detailsEncrypted, NOT extractionEncrypted. This read was wrong in
        // two ways at once, and together they meant the vault could never fill
        // anything on a motivation, whatever the member uploaded.
        //
        // The Licence Centre puts what vision read into `detailsEncrypted` and
        // names its keys in `extractedFields`. It has never written
        // `extractionEncrypted` at all — that column is written only on
        // MotivationUpload, and on Credential it has always been null. So this
        // decrypted nothing, every time, silently.
        //
        // The schema's own comment on extractedFields said the values live in
        // extractionEncrypted, which is how the mistake looked correct while
        // being read. The comment is now fixed to match what the writer does.
        detailsEncrypted: true,
        extractionOk: true,
      },
    });

    return rows.map((r) => {
      let details: Record<string, string> = {};
      if (r.extractionOk && r.detailsEncrypted) {
        try {
          // ⚠️ AND THE SHAPE IS FLAT. The blob is the details object itself —
          // `encryptJson(reading.details)` — not `{ details: … }` wrapped. So
          // even against the right column the old `read?.details` would have
          // come back undefined and fallen through to {}.
          details =
            decryptJson<Record<string, string>>(r.detailsEncrypted) ?? {};
        } catch {
          // A row we cannot decrypt is a row we offer nothing from. It is not
          // an error the applicant can act on, and it must not stop the rest.
          details = {};
        }
      }
      return {
        id: r.id,
        kind: r.kind as string,
        title: r.title,
        expiresOn: r.expiresOn ? toIsoDay(r.expiresOn) : null,
        issuedOn: r.issuedOn ? toIsoDay(r.issuedOn) : null,
        details,
        confirmed: r.confirmedAt !== null,
        dateSettled: r.confirmedAt !== null || r.dateSource !== null,
      };
    });
  }

  /**
   * Pickable documents, from BOTH stores.
   *
   * The vault half is pure (`credentialChoices`). The upload half has to
   * decrypt, so it lives here: a motivation upload of the right kind whose
   * extraction actually yielded the field becomes a choice named after the
   * document it fills.
   */
  /**
   * What this member's earlier documents already told us.
   *
   * Operator, 2026-08-29: "Nothing that is scanned and OCR'd is ever
   * discarded. We will use the information to fill out forms an future
   * applications."
   *
   * ⚠️ THE QUERY IS choicesFor's, DELIBERATELY. Same scope
   * (`motivation: { userId }` — every application this member has made), same
   * `extractionOk`/`purgedAt` filters, same decrypt-inside-a-try. That method
   * has been reading extractions across applications since it was written;
   * there was no reason to invent a second way of doing it, and two ways to
   * ask the same question is how they drift.
   *
   * Which kinds carry forward, and why the firearm and the case do not, is
   * prior-readings.ts.
   */
  async priorReadingsFor(userId: string) {
    const rows = await this.prisma.motivationUpload.findMany({
      where: {
        motivation: { userId },
        kind: { in: [...CARRIES_FORWARD] },
        extractionOk: true,
        purgedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: { kind: true, createdAt: true, extractionEncrypted: true },
    });

    return priorReadings(
      rows.map((r) => {
        let values: Record<string, string> | null = null;
        try {
          values = r.extractionEncrypted
            ? (decryptJson<Record<string, string>>(r.extractionEncrypted) ?? null)
            : null;
        } catch {
          // An unreadable blob costs the prefill, not the application — the
          // module's established rule.
          values = null;
        }
        return { kind: r.kind, createdAt: r.createdAt, values };
      }),
    );
  }

  /**
   * What this member answered on their PREVIOUS applications.
   *
   * ⚠️ EVERY APPLICATION OF THEIRS, NOT ONLY THE LAST ONE, AND priorAnswers
   * SORTS THEM. Somebody who started a section 13 last year, abandoned it
   * half-answered, and finished a section 16 in March has their history spread
   * across two rows; taking "the most recent" alone would drop whatever only
   * the older one carries. Newest still wins per key — that is the fold's job.
   *
   * ⚠️ AND EVERY STATUS, DELIBERATELY. A draft they never lodged still records
   * what they said about their own convictions, and a member who abandoned an
   * application half way through is exactly the one who most wants not to type
   * it all again.
   *
   * Fail-soft per row: one undecryptable blob costs that application's answers,
   * never the whole prefill.
   */
  async priorAnswersFor(userId: string) {
    const rows = await this.prisma.motivation.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      // A generous ceiling on a query that runs once, at create. Nobody has
      // fifty applications, and an unbounded findMany on a per-user table is
      // the kind of thing that is fine until it is not.
      take: 20,
      select: { createdAt: true, answersEncrypted: true },
    });

    return priorAnswers(
      rows.map((r) => ({
        createdAt: r.createdAt,
        // readAnswers already logs and returns {} on a bad blob.
        answers: r.answersEncrypted
          ? this.shared.readAnswers(r.answersEncrypted)
          : null,
      })),
    );
  }

  private async choicesFor(
    userId: string,
    credentials: CredentialSource[],
  ): Promise<CredentialChoices> {
    const base = credentialChoices(credentials);

    const rows = await this.prisma.motivationUpload.findMany({
      where: {
        motivation: { userId },
        kind: {
          in: [
            'COMPETENCY_CERTIFICATE',
            'ASSOCIATION_CARD',
            'GOOD_STANDING_LETTER',
          ],
        },
        extractionOk: true,
        purgedAt: null,
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        kind: true,
        createdAt: true,
        extractionEncrypted: true,
      },
    });

    // ⚠️ DEDUPED ON THE VALUE, NOT THE ROW. The same certificate photographed
    // onto two motivations, or held in the vault AND photographed, would
    // otherwise appear two and three times — and a list of identical entries
    // is not a choice.
    const seen = new Set<string>();
    for (const c of base.competency) seen.add(c.values.competency_number ?? '');
    for (const c of base.dedicated) seen.add(c.values.association_number ?? '');

    for (const r of rows) {
      if (!r.extractionEncrypted) continue;
      let read: Record<string, string> = {};
      try {
        read = decryptJson<Record<string, string>>(r.extractionEncrypted) ?? {};
      } catch {
        continue;
      }
      const when = toIsoDay(r.createdAt);
      if (r.kind === 'COMPETENCY_CERTIFICATE') {
        const number = (read.competency_number ?? '').trim();
        if (!number || seen.has(number)) continue;
        seen.add(number);
        base.competency.push({
          credentialId: `upload:${r.id}`,
          title: `Competency certificate you photographed (${when})`,
          expiresOn: (read.competency_expiry ?? '').trim() || null,
          values: { competency_number: number },
        });
        continue;
      }
      const name = (read.association_name ?? '').trim();
      const number = (read.association_number ?? '').trim();
      if (!name && !number) continue;
      if (number && seen.has(number)) continue;
      if (number) seen.add(number);
      const values: Record<string, string> = {};
      if (name) values.association_name = name;
      if (number) values.association_number = number;
      base.dedicated.push({
        credentialId: `upload:${r.id}`,
        title:
          r.kind === 'GOOD_STANDING_LETTER'
            ? `Letter of good standing you photographed (${when})`
            : `Dedicated status you photographed (${when})`,
        expiresOn: null,
        values,
      });
    }

    return base;
  }

  /** What we WOULD fill from the vault, and which document each value is from. */
  async licenceCentreOffer(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const credentials = await this.credentialsFor(user.id, {
      includeUnconfirmed: true,
    });
    // (This used to read "THE ONE-BUTTON FILL STAYS CONFIRMED-ONLY", drawing
    // the line between showing a value and writing one. The line moved on
    // 2026-08-28: credentialOffer gates per VALUE now, so both paths may take
    // facts from an unconfirmed document and neither may take an unsettled
    // date.)
    //
    // ⚠️ AND THE `filter(c => c.confirmed)` THAT STOOD HERE UNTIL NOW MADE THE
    // PREVIEW LIE. H12. This method is "what we WOULD fill"; the create path
    // and the apply path both call credentialOffer with the UNFILTERED list. So
    // a member whose vault is entirely unconfirmed — the normal state, because
    // phone uploads arrive unconfirmed — was shown "there is nothing in your
    // Document Centre we can use" and then had eleven boxes filled in anyway.
    // A preview that disagrees with the thing it previews is worse than no
    // preview: it teaches people not to read it.
    const offer = credentialOffer(row.licenceType, credentials, answers);

    return {
      empty: offer.empty,
      items: offer.items,
      skipped: offer.skipped,
      /**
       * Everything they could pick from, per group — as opposed to `items`,
       * which is what we would fill if they said "just do it". Somebody
       * holding two competency certificates has to be asked which.
       *
       * ⚠️ IT INCLUDES WHAT THEY PHOTOGRAPHED ONTO A MOTIVATION, not only the
       * vault. The operator asked for this dropdown three times and it kept
       * coming back empty, because it only ever looked at Licence Centre
       * credentials — and the competency certificate somebody photographs
       * while filling in the form lands as a motivation upload, not a vault
       * row. A member who has just taken a photograph of the document and
       * still cannot pick it from the list is being told the feature does not
       * work, and they are right.
       */
      choices: await this.choicesFor(
        user.id,
        // An unconfirmed date shown as authoritative would be a small lie in
        // a dropdown label — say so instead.
        credentials.map((c) =>
          c.confirmed ? c : { ...c, title: `${c.title} — date not checked yet` },
        ),
      ),
      /** Vault documents that also satisfy a required upload on this pack. */
      // ⚠️ `.length`, NOT TRUTHINESS. This filtered on the map lookup itself,
      // which worked only while a kind that fills nothing was ABSENT from the
      // map. Now that it is present as an empty array — so the compiler can
      // enforce exhaustiveness — an empty array is truthy, and the bare lookup
      // would report a Professional Hunter registration as a document
      // satisfying zero checklist rows.
      documents: credentials
        .filter((c) => uploadKindsFor(c.kind).length > 0)
        .map((c) => ({
          credentialId: c.id,
          title: c.title,
          kind: c.kind,
          satisfies: uploadKindsFor(c.kind),
          expiresOn: c.expiresOn,
        })),
    };
  }

  /** They agree, and we copy. Same write path as every other answer. */
  async useLicenceCentre(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const offer = credentialOffer(
      row.licenceType,
      // ⚠️ includeUnconfirmed, TO MATCH create(). These two fill the same
      // fields from the same vault through the same pure function, and leaving
      // them different meant a NEW application picked up the member's licences
      // while pressing the button on an EXISTING one found nothing — with the
      // operator's own five licences, all unconfirmed, that is the difference
      // between working and looking broken.
      //
      // What used to make confirmed-only right here was that this path writes
      // without the member seeing each value. That is still true, and it is
      // now handled where it belongs: credentialOffer gates PER VALUE, so an
      // unconfirmed document supplies facts and never a date. The reminder
      // sweep reads Credential.expiresOn, which this path does not write.
      await this.credentialsFor(user.id, { includeUnconfirmed: true }),
      answers,
    );

    // Through sanitiseAnswers like every other write. The vault's contents are
    // the member's own, but they were read off a photograph by a model and
    // they still have to satisfy the registry.
    const { answers: clean } = sanitiseAnswers(row.licenceType, offer.values);
    const merged = { ...answers, ...clean };

    // offer.items is where credentialOffer says WHICH document each value came
    // from. It has always been computed here and never read.
    const provenance = this.stampVault(
      parseProvenance(row.answerProvenance),
      clean,
      offer.items,
    );

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
        answerProvenance: provenance as unknown as object,
      },
    });

    this.logger.log(
      `Motivation ${row.id}: prefilled ${Object.keys(clean).length} field(s) from the Licence Centre`,
    );

    return {
      filled: Object.keys(clean).length,
      answers: merged,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  async profilePrefillOffer(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        answersEncrypted: true,
        profileConsentAt: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const offer = profileOffer(
      row.licenceType,
      await this.profileFor(user.id),
      answers,
    );

    return {
      alreadyConsented: row.profileConsentAt !== null,
      fields: Object.entries(offer.values).map(([key, value]) => ({
        key,
        label: fieldByKey(row.licenceType, key)?.label ?? key,
        value,
        from: offer.from[key],
      })),
      missingFromProfile: offer.missingFromProfile,
      note: profileCoverageNote(offer),
    };
  }

  /**
   * The applicant agrees, and we copy.
   *
   * Consent is stamped on THIS motivation, not on the account: agreeing once
   * is not agreeing forever, and a timestamp on the row is what answers "who
   * allowed this, and when" later.
   */
  async useProfile(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        licenceType: true,
        status: true,
        answersEncrypted: true,
        answerProvenance: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException('This application can no longer be edited.');
    }

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const offer = profileOffer(
      row.licenceType,
      await this.profileFor(user.id),
      answers,
    );

    // Through sanitiseAnswers like every other write. Profile data is ours, but
    // it is still user-entered text and it still has to satisfy the registry.
    const { answers: clean } = sanitiseAnswers(row.licenceType, offer.values);
    const merged = { ...answers, ...clean };

    // offer.from is the plain-English source per field — "your account name",
    // "the ID number from your identity check". Computed here since the offer
    // was written and, until now, read only by the preview endpoint.
    const provenance = this.stampProfile(
      parseProvenance(row.answerProvenance),
      clean,
      offer.from,
    );

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        answersEncrypted: encryptJson(merged),
        answersSchemaVersion: FIELD_REGISTRY_VERSION,
        answerProvenance: provenance as unknown as object,
        profileConsentAt: new Date(),
      },
    });

    // Logged rather than recorded as an activity event: ActivityService is not
    // injected here, and the consent timestamp on the row is the record that
    // actually matters.
    this.logger.log(
      `Motivation ${row.id}: prefilled ${Object.keys(clean).length} field(s) from profile with consent`,
    );

    return {
      filled: Object.keys(clean).length,
      missingRequired: missingRequired(row.licenceType, merged),
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // PROVENANCE — recording where a prefilled answer came from.
  //
  // These exist so the six write paths cannot each invent their own version.
  // Two rules run through all of them and both are easy to get wrong once:
  //
  //  1. STAMP ONLY WHAT WAS WRITTEN. sanitiseAnswers can drop a key even from
  //     a trusted offer. Provenance for a value that was never stored puts a
  //     "From your Document Centre" chip on a blank field.
  //  2. ONE stamp() CALL PER KEY, never one for the batch. Both offers carry
  //     PER-KEY source text, and credentialOffer carries a per-key credential
  //     id — a single bulk call has no correct `from` to pass.
  //
  // stamp() itself is what refuses to overwrite a MEMBER entry, so every one
  // of these is safe to call over an application the member has edited.
  // ────────────────────────────────────────────────────────────────────

  /** Stamp the profile's contribution. PROFILE never carries a sourceId. */
  private stampProfile(
    map: ProvenanceMap,
    written: Record<string, string>,
    from: Record<string, string>,
  ): ProvenanceMap {
    let out = map;
    for (const [key, source] of Object.entries(from ?? {})) {
      if (!(key in written)) continue;
      out = stamp(out, [key], { source: 'PROFILE', from: source });
    }
    return out;
  }

  /** Stamp the vault's contribution, one entry per offered value. */
  private stampVault(
    map: ProvenanceMap,
    written: Record<string, string>,
    items: readonly { key: string; from: string; credentialId: string }[],
  ): ProvenanceMap {
    let out = map;
    for (const item of items ?? []) {
      if (!(item.key in written)) continue;
      out = stamp(out, [item.key], {
        source: 'VAULT',
        sourceId: item.credentialId,
        from: item.from,
      });
    }
    return out;
  }

  /**
   * create()'s three contributors, stamped in the same precedence order the
   * values were merged in: profile, then vault, then seed.
   *
   * ⚠️ THE ORDER IS THE POINT. Values spread profile → vault → seed, so the
   * last writer wins. Stamping in any other order would attribute a value to
   * whoever was overruled.
   */
  stampOffers(
    map: ProvenanceMap,
    written: Record<string, string>,
    profileFrom: Record<string, string>,
    vaultItems: readonly { key: string; from: string; credentialId: string }[],
    seed: Record<string, string>,
    /** Which document kind each carried-forward reading came off. */
    priorFrom: Record<string, MotivationUploadKind> = {},
    /** Answers carried forward from the member's own previous application. */
    priorAnswerKeys: readonly string[] = [],
  ): ProvenanceMap {
    let out = this.stampProfile(map, written, profileFrom);

    // ⚠️ BETWEEN PROFILE AND VAULT, MATCHING THE VALUE PRECEDENCE EXACTLY. If
    // these two lines were swapped, a field the vault supplied would carry a
    // chip naming a document from an old application.
    //
    // ⚠️ AND THE CHIP SAYS "from an earlier application". Without that a
    // member opening a brand-new application sees "your competency
    // certificate" against a field on a form where they have uploaded
    // nothing, and reasonably concludes we have muddled them up with somebody
    // else. READ is the honest source: it was read off a document, just not
    // this one.
    for (const [key, kind] of Object.entries(priorFrom)) {
      if (!(key in written)) continue;
      out = stamp(out, [key], {
        source: 'READ',
        from: `${documentLabel(kind)}, from an earlier application`,
      });
    }

    // ⚠️ 'READ', NOT 'MEMBER', AND THE CHIP SAYS WHOSE FORM IT WAS ON. These
    // values ARE the member's own words — but they typed them on a DIFFERENT
    // application, and 'MEMBER' is absorbing: once set nothing automatic may
    // replace it, so a stale conviction answer would be immovable by any later
    // offer. 'READ' with an explicit source is the same shape priorFrom above
    // already uses, and for the same reason: it was read off something, just
    // not off this form.
    //
    // Between the readings and the vault, matching the value precedence.
    for (const key of priorAnswerKeys) {
      if (!(key in written)) continue;
      out = stamp(out, [key], {
        source: 'READ',
        from: 'your previous application — check it is still true',
      });
    }

    out = this.stampVault(out, written, vaultItems);

    // The only non-empty seed today is a renewal, built by licence-renewal.ts
    // from the licence being renewed — so VAULT is truthful. It carries no
    // credential id because RenewalPlan does not pass one through; wiring that
    // is a Licence Centre change, not a Phase 1 one.
    for (const key of Object.keys(seed ?? {})) {
      if (!(key in written)) continue;
      out = stamp(out, [key], {
        source: 'VAULT',
        from: 'the licence you are renewing',
      });
    }
    return out;
  }
}
