import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CrimeStatsService } from '../crime-stats/crime-stats.service';
import { encryptJson, decryptJson } from '../common/blob-crypto';
import {
  AnswerProvenance,
  ProvenanceMap,
  ProvenanceSource,
  StampInput,
  parseProvenance,
  stamp,
} from '../common/answer-provenance';
import { MotivationQuotaService } from './motivation-quota.service';
import {
  uploadKindsFor,
  CredentialChoices,
  credentialChoices,
  CredentialOffer,
  CredentialOfferItem,
  CredentialSource,
  credentialOffer,
  toIsoDay,
} from './motivation-credentials';
import {
  type EndorsementNeed,
  endorsementNeed,
  requiredEndorsement,
} from './motivation-eligibility';
import {
  FIELD_REGISTRY_VERSION,
  fieldByKey,
  fieldsFor,
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

/**
 * A vault row as the PREFILL sees it: the pure offer's `CredentialSource`,
 * plus the one column the offer does not need and the provenance does.
 *
 * ⚠️ EXTENDED HERE RATHER THAN ON `CredentialSource` ITSELF. That interface
 * describes what the pure offer reads to decide a VALUE, and `dateSource`
 * changes no value — it only changes what we say about one. Keeping it on this
 * side of the seam means the pure function's contract stays "what may I
 * write?" and this service keeps "and how do I describe what I wrote?".
 * Structurally it is still a `CredentialSource`, so every existing caller —
 * credentialOffer, credentialChoices — takes one unchanged.
 */
export type VaultCredential = CredentialSource & {
  /**
   * How the vault came by this row's EXPIRY, or null when nobody has dated it.
   *
   * 'read'    — printed on the document and read off it.
   * 'derived' — WORKED OUT. A competency certificate carries no printed expiry
   *             at all (sa-competency-reference §5.2/§5.3): it is the latest
   *             expiry among the licences in the categories the certificate
   *             covers, and it moves every time one of those licences renews.
   *
   * ⚠️ THE COLUMN DESCRIBES THE EXPIRY, NOT EVERY DATE ON THE ROW. A derived
   * competency still has an ISSUE date read straight off the card. See
   * EXPIRY_KEY below, which is why only one of the two is ever flagged.
   */
  dateSource: string | null;
};

/**
 * The answer keys that hold a document's EXPIRY.
 *
 * ⚠️ NARROWER THAN `isDateKey`, DELIBERATELY. `dateSource` says how we came by
 * the row's expiry and nothing else, so flagging `competency_issued` off it
 * would tell the member that a date printed on their certificate in ink was
 * something we inferred.
 */
const EXPIRY_KEY = /(_expiry|_expires)$/;

/**
 * The four boxes one competency certificate fills.
 *
 * ⚠️ EXPORTED SO THE RE-DERIVATION TRIGGER AND THE RE-DERIVATION ITSELF READ
 * THE SAME LIST. saveAnswers asks "is this whole block still empty and ours?"
 * before it calls in here; two hand-written copies of the block would let the
 * question and the answer drift.
 */
export const COMPETENCY_KEYS = [
  'competency_number',
  'competency_for',
  'competency_issued',
  'competency_expiry',
] as const;

/**
 * Provenance sources a re-derivation may overwrite.
 *
 * ⚠️ THIS SET IS THE WHOLE SAFETY OF THE RE-DERIVATION, AND IT IS THE ONLY
 * GUARD THERE IS. Anything we wrote we may write again; anything the member
 * wrote is theirs for good.
 *
 * ⚠️ `stamp()` DOES NOT BACK THIS UP, WHATEVER AN EARLIER COMMENT HERE
 * CLAIMED. It refuses to overwrite a MEMBER *provenance entry* — read it: the
 * only thing it touches is the map. The ANSWER is written by the caller, one
 * line earlier, and nothing downstream of this filter looks at provenance
 * again. So a key that reaches `values` gets written, MEMBER mark or not, and
 * the mark then survives on top of a value the member never typed — a chip
 * reading "You entered this" over a number we chose. This filter is not
 * belt-and-braces. It is the belt, and there are no braces.
 */
const REPLACEABLE: ReadonlySet<ProvenanceSource> = new Set<ProvenanceSource>([
  'VAULT',
  'DERIVED',
]);

/**
 * What the re-derivation decided, for one competency block.
 *
 * ⚠️ RETURNED TO THE CALLER RATHER THAN WRITTEN AND FORGOTTEN. A server-side
 * write the client is not told about is a write the client's next autosave
 * undoes — the wizard sends the WHOLE answers map on every save, so a value it
 * does not hold is a value it overwrites with the stale one it does, and
 * `markMember` then stamps that stale value MEMBER, which is absorbing. See
 * MotivationsService.saveAnswers, which forwards this to the client as
 * `derived`.
 */
export interface CompetencyRederivation {
  /**
   * Every competency box being written, whether or not the value moved.
   *
   * ⚠️ AN EMPTY STRING IS AN INSTRUCTION, NOT AN ABSENCE: clear that box. A
   * certificate the firearm now rules out has to come OFF the form — an empty
   * required box is a question the member can answer, where a wrong
   * certificate number on a signed SAPS 271 is one they never think to check.
   *
   * ⚠️ AND UNCHANGED KEYS ARE IN HERE TOO, ON PURPOSE. The block is stamped as
   * a block: if only three of the four values moved, filtering the fourth out
   * would leave it wearing the OLD certificate's chip, so one screen would
   * cite two different documents for one certificate.
   */
  values: Record<string, string>;
  /**
   * Provenance for the same keys. `null` means REMOVE the entry — a box we
   * just emptied must not keep a chip naming the certificate we ruled out, and
   * the map has no "unstamp" (deliberately: the one thing it must never do is
   * forget a MEMBER mark).
   */
  provenance: Record<string, AnswerProvenance | null>;
}

/** Two provenance entries say the same thing — `at` aside, which always moves. */
function sameProvenance(
  a: AnswerProvenance | null | undefined,
  b: AnswerProvenance | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return (
    a.source === b.source &&
    (a.sourceId ?? '') === (b.sourceId ?? '') &&
    a.from === b.from &&
    !!a.inferred === !!b.inferred
  );
}

@Injectable()
export class MotivationPrefillService {
  private readonly logger = new Logger(MotivationPrefillService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: MotivationQuotaService,
    private readonly shared: MotivationSharedService,
    private readonly crimeStats: CrimeStatsService,
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
  ): Promise<VaultCredential[]> {
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
        // ⚠️ CARRIED, NOT COLLAPSED INTO `dateSettled`. Both of these read the
        // same column and they answer different questions: dateSettled asks
        // "may this date be written at all?", dateSource asks "and what do we
        // tell the member about it?". Folding the second into the first is how
        // a competency expiry that is OUR ARITHMETIC came to be shown with a
        // green "read off your document" pill naming a certificate that prints
        // no expiry anywhere on it. See stampVault.
        dateSource: r.dateSource,
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

  // ── the nearest SAPS station ───────────────────────────────────────
  //
  // Operator, 2026-09-07: "is it possible for us to pull the per police
  // station crime stats from SAPS and keep it updated?" The precinct figures
  // themselves are fetched at generation time (MotivationGenerationService),
  // but the STATION has to be on the form before that — a member should see,
  // and be free to correct, which station will be cited well before they
  // ever reach Generate.
  //
  // Automatic, per CLAUDE.md "Automate It — Do Not Ask": the operator's own
  // words on that rule are "insert it, don't wait for the user to go and
  // confirm it... No further user interaction required." A confirm step in
  // front of a value we can already work out is work invented for the member.
  //
  /**
   * The nearest SAPS station to a self-defence applicant's address.
   *
   * `null` on every path that should not overwrite anything: not a
   * self-defence application, no address yet, `police_station` already has a
   * value (a member's own correction OR an earlier automatic fill — either
   * way this must not clobber it), or the lookup found nothing / failed.
   *
   * ⚠️ FAIL-SOFT LIKE EVERY OTHER PREFILL SOURCE ABOVE. A Places outage or a
   * name that matches no station costs the member one text box to fill in
   * themselves — it must never cost them the ability to start or edit the
   * application.
   */
  async stationOffer(
    licenceType: MotivationLicenceType,
    answers: Record<string, string>,
  ): Promise<{ station: string; province: string; from: string } | null> {
    if (licenceType !== MotivationLicenceType.S13_SELF_DEFENCE) return null;
    if ((answers.police_station ?? '').trim()) return null;
    const address = (answers.residential_address ?? '').trim();
    if (!address) return null;

    try {
      const result = await this.crimeStats.nearestStation(address);
      if (!result.station) return null;
      return {
        station: result.station.name,
        province: result.station.province,
        // ⚠️ THE MEMBER MUST BE ABLE TO TELL THIS WAS A GUESS. "The one you
        // report to" is not always the one geographically nearest — see
        // NearestStationResult.candidates, which the wizard's picker offers
        // as alternatives.
        from: 'Nearest SAPS station to your address — change it if it is not the one you report to',
      };
    } catch (err) {
      this.logger.warn(
        `Nearest-station prefill skipped — ${(err as Error).message}`,
      );
      return null;
    }
  }

  // ── the competency that matches the firearm ────────────────────────
  //
  // ⚠️ THE FAULT THIS EXISTS FOR, IN THE OPERATOR'S OWN WORDS (2026-09-07,
  // driving a fresh section 13 on production): "the wrong competency chosen
  // before it even knows which firearm is being applied for."
  //
  // They are describing an ORDERING problem, not a matching one. create()
  // seeds the competency boxes from the vault at the moment the application is
  // made — which is before `firearm_type` and `firearm_action` can possibly
  // exist — and the vault's tie-break is "longest-running expiry wins". So a
  // member holding a rifle-and-shotgun certificate and a handgun certificate
  // got whichever ran longest written onto a handgun application, and NOTHING
  // EVER CAME BACK TO LOOK AGAIN. saveAnswers re-derived exactly one thing on
  // a change — the police station, on an address edit — and the competency was
  // not on that list. The wrong certificate then sat there through the whole
  // wizard and the eligibility check told the member their competency did not
  // cover their own handgun.
  //
  // Per CLAUDE.md "Automate It — Do Not Ask", the answer is not a confirm
  // step in front of the competency box. It is to work it out again the moment
  // we learn the thing that decides it, write it, show it, and leave it
  // editable — the same shape as the station hook this sits beside.

  /**
   * The competency boxes as they should read now the firearm is known.
   *
   * `null` means CHANGE NOTHING, and it is returned on exactly four paths: the
   * applicant has not said enough about the firearm yet, every box is already
   * somebody else's to hold, the vault could not be read, or nothing we would
   * write differs from what is there. Anything else comes back as a block of
   * values and a block of provenance — and a value may be an EMPTY STRING,
   * which is an instruction to clear that box.
   *
   * ⚠️ "WE CANNOT CHOOSE" IS NOT "LEAVE IT ALONE", AND CONFLATING THEM WAS THE
   * FAIL-OPEN. `requiredEndorsement` answered null for three different
   * situations and this method read all three as "not yet": a member who had a
   * rifle certificate written in and then switched to Combination — a real
   * SAPS 271 §E.1 choice — kept the rifle certificate, ticks and all, for the
   * life of the application. `endorsementNeed` separates them, and only
   * `unknown` leaves the boxes standing.
   *
   * ⚠️ WHICH CERTIFICATE IS credentialOffer's DECISION, NOT THIS METHOD'S, AND
   * THERE MUST GO ON BEING EXACTLY ONE OF THOSE. This method decides WHETHER we
   * may act and WHAT WE MAY REPLACE; the pure offer decides which document
   * answers the firearm, including the combination gun's own rule (a
   * certificate covering both halves, or none). Writing a second selection rule
   * here — "try the rifle barrel, then the shotgun" — would put two answers to
   * one question on the same screen and let them disagree over a signed form.
   * So the fourth argument is the narrow `Endorsement | null` the offer takes,
   * and the answers go through unaltered so its own combination branch can see
   * the firearm type.
   *
   * The consequence for a combination gun, either way round: if no certificate
   * qualifies, the offer fills nothing and the boxes are CLEARED — whatever
   * stood there was chosen for a firearm this is not. What is still missing is
   * the eligibility blocker's job to say, not this method's.
   *
   * ⚠️ WE MAY ONLY REPLACE WHAT WE WROTE. Provenance decides, per key: VAULT or
   * DERIVED is ours and may be re-derived; anything else recorded — MEMBER
   * above all — is theirs, EMPTY OR NOT. An empty box carrying a MEMBER mark is
   * a box the member deliberately cleared, and refilling it is the same offence
   * as overwriting a typed value. A key with no entry at all is UNKNOWN: not
   * ours either, so we may fill it only while it is empty.
   *
   * ⚠️ FAIL-SOFT LIKE EVERY OTHER PREFILL SOURCE. A vault we cannot read costs
   * the member one box they fill themselves; it must never cost them the
   * ability to save the answer they just typed.
   */
  async competencyOffer(
    licenceType: MotivationLicenceType,
    userId: string,
    answers: Record<string, string>,
    provenance: ProvenanceMap,
  ): Promise<CompetencyRederivation | null> {
    const need: EndorsementNeed = endorsementNeed(answers);
    // The one state that means "we have not been told yet". Every other state
    // is a decision, including the two that decide we cannot choose.
    if (need.kind === 'unknown') return null;

    // ⚠️ ONLY BOXES THIS LICENCE TYPE ACTUALLY ASKS. All four live in
    // COMMON_FIELDS today, so this filter removes nothing — it is here so that
    // moving one into a per-type block later cannot make us write an answer for
    // a field the form does not have, which sanitiseAnswers would then refuse
    // on the member's next save and report to them as an error.
    const asked = new Set(fieldsFor(licenceType).map((f) => f.key));
    const keys = COMPETENCY_KEYS.filter((key) => asked.has(key));

    const replaceable = keys.filter((key) => {
      const source = provenance[key]?.source;
      // Recorded provenance settles it outright, in both directions — see the
      // note above on a deliberately cleared box.
      if (source) return REPLACEABLE.has(source);
      return !(answers[key] ?? '').trim();
    });
    if (!replaceable.length) return null;

    let credentials: VaultCredential[];
    try {
      credentials = await this.credentialsFor(userId, {
        // Same as create() and useLicenceCentre: phone uploads arrive
        // unconfirmed and that is the ordinary state of a member's vault.
        // credentialOffer still gates DATES per value.
        includeUnconfirmed: true,
      });
    } catch (err) {
      this.logger.warn(
        `Competency re-derivation skipped — ${(err as Error).message}`,
      );
      return null;
    }

    // Blank the boxes we are allowed to replace, so the offer will fill them
    // again — credentialOffer refuses any key that already holds a value
    // ("theirs wins, always"), which is exactly the behaviour we want for the
    // keys we are NOT allowed to touch.
    const answered = { ...answers };
    for (const key of replaceable) answered[key] = '';

    // ⚠️ ONE CALL, AND THE NARROW ARGUMENT. `needed` is null for a combination
    // gun and for a type we cannot map — which is exactly the two states that
    // brought us here rather than returning early — and credentialOffer answers
    // both from the answers it is handed. Null offers nothing where it cannot
    // choose, and nothing is what turns this pass into a CLEAR.
    const offer: CredentialOffer = credentialOffer(
      licenceType,
      credentials,
      answered,
      need.kind === 'one' ? need.endorsement : null,
    );

    // Through sanitiseAnswers like every other write — the vault's contents
    // were read off a photograph by a model and still have to satisfy the
    // registry. An empty offer sanitises to nothing, which is what turns this
    // into a clear.
    const { answers: clean, refused } = sanitiseAnswers(
      licenceType,
      offer.values,
    );
    // ⚠️ THE REFUSED LIST IS NOT DISCARDED. saveAnswers treats a refusal as "a
    // DEFECT UNTIL PROVEN OTHERWISE" and logs it loudly, because a REGISTERED
    // field refusing its own value means the form and the validator have
    // drifted. The identical event here used to be swallowed, and its silent
    // consequence was worse than a missing log line: the key fell out of
    // `clean`, which this method reads as "the vault has nothing", which BLANKS
    // a required box on a SAPS 271. A refused key is left exactly as it was,
    // and said out loud.
    const refusedSet = new Set(refused);
    if (refused.length) {
      this.logger.error(
        `Competency re-derivation: REFUSED values for registered fields ${refused.join(', ')} — the vault and the registry disagree, so those boxes were left alone`,
      );
    }

    const items = new Map(offer.items.map((i) => [i.key, i]));
    const derivedIds = new Set(
      credentials.filter((c) => c.dateSource === 'derived').map((c) => c.id),
    );

    const values: Record<string, string> = {};
    const stamped: Record<string, AnswerProvenance | null> = {};
    for (const key of replaceable) {
      if (refusedSet.has(key)) continue;
      const next = (clean[key] ?? '').trim();
      values[key] = next;
      const item = next ? items.get(key) : undefined;
      // ⚠️ THROUGH stamp() RATHER THAN BUILT BY HAND, so the one rule about a
      // DERIVED expiry wearing `inferred` lives in exactly one place —
      // vaultInput — and cannot drift between this path and stampVault.
      stamped[key] = item
        ? (stamp({}, [key], this.vaultInput(item, derivedIds))[key] ?? null)
        : null;
    }

    // Nothing to say. A no-op block would re-stamp four entries with a fresh
    // timestamp on every keystroke and hand the client a `derived` payload to
    // apply for no reason.
    const moved = Object.entries(values).some(
      ([key, value]) => value !== (answers[key] ?? '').trim(),
    );
    const restamped = Object.entries(stamped).some(
      ([key, entry]) => !sameProvenance(provenance[key], entry),
    );
    if (!moved && !restamped) return null;

    return { values, provenance: stamped };
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
    //
    // ⚠️ AND THE FOURTH ARGUMENT IS WHICH FIREARM. credentialOffer picks the
    // competency certificate that COVERS it — "longest-running expiry wins" is
    // the right rule only among the certificates that qualify, and before the
    // firearm step is answered there is no right certificate to show at all.
    // A preview that offers a rifle certificate for a handgun application is
    // the fault the operator hit, one screen earlier.
    const offer = credentialOffer(
      row.licenceType,
      credentials,
      answers,
      requiredEndorsement(answers),
    );

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
    // Held in a const because the provenance stamp below needs the ROWS, not
    // only the values: `dateSource` is what tells a derived expiry from a read
    // one, and it lives on the row.
    const credentials = await this.credentialsFor(user.id, {
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
      includeUnconfirmed: true,
    });
    const offer = credentialOffer(
      row.licenceType,
      credentials,
      answers,
      // Which firearm — see licenceCentreOffer, whose preview this applies.
      requiredEndorsement(answers),
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
      credentials,
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

  /**
   * Stamp the vault's contribution, one entry per offered value.
   *
   * ⚠️ AND A DERIVED EXPIRY IS MARKED `inferred`, WHICH IS THE SECOND FAULT
   * THE OPERATOR FOUND. A competency certificate prints no expiry date
   * anywhere on it — SAPS does not put one there. Ours is arithmetic: the
   * latest expiry among the member's licences in the categories the
   * certificate covers (sa-competency-reference §5.2/§5.3, and
   * deriveCertificateExpiry, which owns the rule). The vault records that
   * honestly as `dateSource: 'derived'`; this method used to throw that away
   * and stamp a plain VAULT entry, so the wizard showed a worked-out date
   * with a green "read off your document" pill naming a document it is not
   * printed on. A member checking their certificate finds no such date and
   * reasonably concludes we invented it — which we did, correctly, and should
   * have said so.
   *
   * `AnswerProvenance.inferred` is what says so. It has existed since the
   * provenance column was written and NOTHING in production ever set it, which
   * is why the amber "check this" state has never once appeared on a real
   * application.
   */
  private stampVault(
    map: ProvenanceMap,
    written: Record<string, string>,
    items: readonly { key: string; from: string; credentialId: string }[],
    /**
     * The vault rows those items came off, so an expiry we WORKED OUT can be
     * told apart from one we READ.
     *
     * ⚠️ OPTIONAL, AND ABSENT MEANS "READ". A caller that does not hold the
     * rows is making the claim it has always made; the flag can only ever be
     * added by somebody who actually knows, never assumed by a default.
     */
    sources: readonly { id: string; dateSource?: string | null }[] = [],
  ): ProvenanceMap {
    const derived = new Set(
      sources.filter((c) => c.dateSource === 'derived').map((c) => c.id),
    );
    let out = map;
    for (const item of items ?? []) {
      if (!(item.key in written)) continue;
      out = stamp(out, [item.key], this.vaultInput(item, derived));
    }
    return out;
  }

  /**
   * What a vault-sourced answer's provenance says — the ONE place that rule
   * lives.
   *
   * Extracted so `competencyOffer`, which builds its block of entries directly
   * rather than folding them into an existing map, cannot drift from
   * `stampVault`. Two copies of "is this expiry ours or the document's?" is
   * exactly one copy too many.
   */
  private vaultInput(
    item: { key: string; from: string; credentialId: string },
    derivedIds: ReadonlySet<string>,
  ): StampInput {
    // Only the EXPIRY. See EXPIRY_KEY: the same certificate's issue date is
    // printed in ink and was read, and calling that inferred would be a lie in
    // the other direction.
    const workedOut =
      EXPIRY_KEY.test(item.key) && derivedIds.has(item.credentialId);
    return {
      source: 'VAULT',
      sourceId: item.credentialId,
      // ⚠️ AND THE CHIP SAYS WHERE IT ACTUALLY CAME FROM, WHICH IS NOT THE
      // DOCUMENT. `ProvenanceNote` renders exactly one string — "from
      // {from}" — so naming the certificate beside an amber "check this" told
      // a member to go and check a date against a card SAPS does not print it
      // on. The expiry is OUR ARITHMETIC: the latest expiry among their
      // licences in the categories the certificate covers
      // (sa-competency-reference §5.2/§5.3), rolling forward with every
      // renewal. Saying so is the difference between a member finding nothing
      // and concluding we invented it, and a member knowing what to check.
      //
      // ⚠️ `sourceId` STILL POINTS AT THE CERTIFICATE, and `source` is still
      // VAULT, because both are true: there IS a vault row, and it IS that
      // row's expiry. Only the sentence changes, because only the sentence was
      // wrong.
      from: workedOut
        ? 'your longest-running licence in that firearm type — your certificate does not print an expiry'
        : item.from,
      inferred: workedOut,
    };
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
    /**
     * The vault rows behind `vaultItems`, so a derived expiry is stamped as
     * inferred rather than as something read off the document. See stampVault.
     */
    vaultRows: readonly { id: string; dateSource?: string | null }[] = [],
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

    out = this.stampVault(out, written, vaultItems, vaultRows);

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
