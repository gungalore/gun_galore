import { Injectable, Logger } from '@nestjs/common';
import { MotivationLicenceType, MotivationUploadKind } from '@prisma/client';
import { LlmService } from '../common/llm/llm.service';
import { LlmError, type LlmPart } from '../common/llm/llm.types';
import { fieldsFor, nextOwnedRow } from './motivation-fields';
import { readSaId } from './sa-id';
import { endorsementSpec, parseEndorsements } from '../common/sa-competency';
import { GoogleVisionOcrService } from '../common/google-vision-ocr.service';
import { readMarkers } from '../common/document-markers';
import {
  FIREARM_READING_SCHEMA,
  firearmIdentityPrompt,
  parseFirearmReading,
} from '../common/firearm-identity';
import { answerValue } from '../common/card-placeholder';

// ────────────────────────────────────────────────────────────────────
// READING WHAT THE APPLICANT ALREADY HAS.
//
// Operator, 2026-08-19: take the documents FIRST, because there is a lot we can
// pull off them. And they are right — an ID card carries the name, the ID
// number and therefore the date of birth, age, gender and citizenship; a
// competency certificate carries its number and dates; a licence carries the
// make, calibre and serial of a firearm they already own, which is exactly what
// the overlap check needs. Typing all of that again, off a card they are
// holding, is the part of a form people abandon.
//
// ── WHAT THIS IS ALLOWED TO DO, AND WHAT IT IS NOT ─────────────────
//
// It PROPOSES. Every value comes back as a suggestion the applicant confirms
// before it is written to their answers. Nothing here silently becomes an
// answer on a form they sign — a misread digit in an ID number is a false
// statement on a firearm licence application, and section 120(9)(f) of the Act
// makes that an offence.
//
// It reads ONLY registered fields. A key that is not in the registry is
// discarded, so a model cannot invent a field, and cannot reach a field we
// deliberately do not ask about.
//
// It NEVER reads the history questions. Nothing about convictions, pending
// cases or confiscations is extractable from a document, and a model guessing
// at someone's criminal record from a photograph is not a feature.
//
// ── FAIL-SOFT ON STORAGE, FAIL-CLOSED ON TRUST ─────────────────────
//
// An extraction failure must NOT lose the upload: the bytes are already stored,
// the applicant carries on, and extractionOk stays false. But a failure must
// also never leave a half-read value sitting in the form looking confirmed.
// Those are different directions and both matter.
//
// ⚠️ The ID NUMBER is cross-checked in CODE, not trusted from the model — a
// Luhn check plus a date that actually exists. Same posture as the serial
// cross-check in the listing pipeline: where a value gates something, the model
// transcribes and we verify.
// ────────────────────────────────────────────────────────────────────

// ⚠️ NO MODEL IS NAMED HERE ANY MORE. Every call takes LlmService.model —
// one platform model, from LLM_MODEL (operator, 2026-09-07: everything moves
// from the Claude API to Gemini 2.5 Flash-Lite).
//
// TWO CHOICES THIS FILE USED TO MAKE, RECORDED SO THEY ARE NOT RE-DERIVED:
// reading a document ran on the mid tier, and "which document is this?" ran on
// the CHEAP one — naming a document is a far easier job than reading one, and
// it happens once per file in a pack, so a member uploading eight documents
// should not pay eight full-price calls to have them sorted into piles. Both
// now run on the same model. If sorting ever needs to be cheaper, or reading
// ever needs to be stronger, `model:` on the request is the one-line lever the
// contract keeps for exactly this.

/** What each document kind can plausibly yield. Nothing else is accepted. */
/**
 * Upload kinds that plausibly DESCRIBE A FIREARM, and so are worth a second,
 * kind-agnostic read.
 *
 * ⚠️ NOT EVERY KIND, DELIBERATELY. A safe photograph, an ID copy or a
 * municipal bill has no firearm on it: a vision call would spend money to find
 * nothing, and — the real risk — hand a model the opportunity to invent one
 * from a stray number. OTHER is included because that is where a document
 * lands when the classifier could not place it, which is exactly the
 * "atleast something" case this reader exists for.
 */
const FIREARM_READABLE = new Set<string>([
  'FIREARM_SOURCE_PROOF',
  'SELLER_LICENCE',
  'CURRENT_LICENCE',
  'ASSOCIATION_ENDORSEMENT',
  'OTHER',
]);

/**
 * Where each firearm-identity key lands on the motivation form.
 *
 * ✅ EVERY FIELD NOW HAS SOMEWHERE TO GO. The component serials and their
 * makes were read and thrown away for a while, because the registry had one
 * serial field and forcing a component number into it would have put the wrong
 * number on a signed application. The registry carries all six now (SAPS 271
 * section E 1.7–1.12), so the map is one-to-one and nothing is discarded.
 *
 * ⚠️ THE NAMES MATCH ON BOTH SIDES, WHICH IS WHY THIS LOOKS REDUNDANT. It is
 * still written out rather than assumed: the reader's keys are chosen to
 * describe a page and the registry's are chosen to describe a form, and the
 * day one of them is renamed this map is the thing that fails loudly instead
 * of a value silently going nowhere.
 */
const FIREARM_KEY_MAP: Record<string, string> = {
  firearm_make: 'firearm_make',
  firearm_model: 'firearm_model',
  firearm_calibre: 'firearm_calibre',
  firearm_type: 'firearm_type',
  firearm_action: 'firearm_action',
  // ⚠️ THE HEADLINE SERIAL, NOT THE BARREL ROW. Operator, 2026-08-28:
  // "Serial number is the number which will always be used to identify the
  // firearm. Even when the DFO asks what is the serial number of the firearm,
  // that is the number you will give him."
  //
  // This was briefly mapped from barrel_serial, on the understanding that the
  // two always match. The operator's own card disproves it: Serial Number
  // MR90189D, Barrel Serial No NONE, Receiver Serial No MR90189D. The headline
  // number follows whichever component IS the firearm in law, so mapping from
  // the barrel row would have written NONE — or nothing — into the one field
  // a DFO actually asks about.
  firearm_serial: 'firearm_serial',
  // The three component rows. Each may legitimately be absent — a firearm
  // carries its number on ONE component and the other rows read NONE.
  barrel_serial: 'barrel_serial',
  barrel_make: 'barrel_make',
  frame_serial: 'frame_serial',
  frame_make: 'frame_make',
  receiver_serial: 'receiver_serial',
  receiver_make: 'receiver_make',
};

const EXTRACTABLE: Partial<Record<MotivationUploadKind, string[]>> = {
  IDENTITY_DOCUMENT: ['full_name', 'id_number'],
  // ⚠️ NO competency_expiry. A COMPETENCY CERTIFICATE DOES NOT CARRY ONE.
  // SA Firearm Competency Reference §5.2 and §8: the card shows an issue date
  // and the endorsed types, and nothing else. Asking a transcriber to find an
  // expiry on a document that has none is asking it to return SOMETHING — the
  // issue date, a licence date, a printed reference number — and we would then
  // show that to a member as the day their competency lapses. The expiry is
  // DERIVED from the licences held in each category; see common/sa-competency.
  COMPETENCY_CERTIFICATE: [
    'competency_number',
    'competency_issued',
    'competency_for',
  ],
  PROFICIENCY_CERTIFICATE: ['competency_for'],
  ADDRESS_CONFIRMATION: ['residential_address', 'residential_postal_code'],
  ASSOCIATION_CARD: [
    'association_name',
    'association_number',
    // The card prints when the member JOINED. When they qualified for
    // dedicated status is a different fact and a different box — see
    // association_joined in the registry.
    'association_joined',
    'dedicated_since',
  ],
  // The sworn letter carries the same association and dedicated number as the
  // certificate, plus the two dates that make it expire — which is the whole
  // reason it is a separate document rather than another photograph of the
  // status.
  //
  // ⚠️ AND THE COMMENT WAS THE ONLY PLACE EITHER DATE APPEARED. This list is
  // both the question put to the model AND the filter on its answer, so
  // `association_expiry` — the "valid until" date, SAPS 271 item 60 — was
  // never asked for and would have been discarded if volunteered. The registry
  // field carries `docSourced: 'GOOD_STANDING_LETTER'` and help reading
  // "photograph the letter and we will read it for you", so an empty row told
  // the member the letter did not carry a date the letter plainly prints. The
  // vault route to item 60 was fixed separately; this is the
  // photograph-it-here route.
  GOOD_STANDING_LETTER: [
    'association_name',
    'association_number',
    'association_joined',
    'association_expiry',
    'dedicated_since',
  ],
  // ⚠️ IT DESCRIBES THE FIREARM BEING APPLIED FOR, so it fills the firearm
  // fields, not the association ones. That is what makes it worth reading: an
  // endorsement already names the type, calibre, make, action and serial, and
  // the applicant would otherwise type all five again.
  ASSOCIATION_ENDORSEMENT: [
    'firearm_type',
    'firearm_calibre',
    'firearm_make',
    // ⚠️ ADDED 2026-08-24. firearm_model is REQUIRED and was the one field on
    // the applied-for firearm that NO path could fill — not this endorsement,
    // which names the firearm in full, and not the licence-card OCR, which
    // reads a Model row. An applicant whose every other firearm box filled
    // itself still had to type this one, which reads as the feature not
    // working. Operator, item 5 of twelve: "get the details from the consent
    // or the upload and fill it."
    'firearm_model',
    'firearm_action',
    'firearm_serial',
  ],
  // ⚠️ THE DOCUMENT THAT DESCRIBES THE FIREARM BEING BOUGHT, AND IT WAS NEVER
  // READ. FIREARM_SOURCE_PROOF appeared in no extractable list at all, so a
  // dealer's invoice — which names the make, model, calibre and serial of the
  // exact firearm — was stored and used for nothing, and the applicant typed
  // all four again off the paper in their hand.
  //
  // Routing spec §5.4 covers FOUR source paths and puts every one of them in
  // this same slot: a dealer invoice, a dealer-prefilled SAPS 271, a private
  // seller's paperwork, and estate letters. They differ in what else they
  // carry, but all four name the firearm, so one extractable list serves all
  // four and the classifier does not have to tell them apart to be useful.
  //
  // ⚠️ INCLUDING THE PREFILLED 271, WHICH §5.4 B CALLS "the common real-world
  // case": the dealer hands the buyer a 271 with parts E and F already
  // completed and the buyer photographs it. Read as a scan against its printed
  // labels, never as an AcroForm — it is a picture of paper.
  //
  // ⚠️ AND THE CONFLICT HANDLING IS ALREADY RIGHT, WHICH IS WHY THIS IS A ONE
  // LINE CHANGE. §5.4 B asks that where the scan and the applicant's own
  // entries disagree the difference is SURFACED rather than silently resolved.
  // That is exactly what addOneUpload already does: an empty box is filled,
  // and a box they have typed into goes to the "we read N things" panel with
  // both values. Nothing new is needed for the diff.
  FIREARM_SOURCE_PROOF: [
    'firearm_type',
    'firearm_action',
    'firearm_make',
    'firearm_model',
    'firearm_calibre',
    'firearm_serial',
  ],
  EMPLOYMENT_CONFIRMATION: ['employer_name', 'employer_address'],
  // Written against ROW 1 and remapped to whichever row is free — see
  // nextOwnedSlot().
  //
  // ⚠️ ONE SERIAL, NOT TWO, AND THE TWO IT REPLACES ARE RETIRED KEYS. This
  // asked for `_barrel_serial` and `_frame_serial` — boxes the wizard stopped
  // rendering on 2026-09-07 when they collapsed into `_serial`. sanitiseAnswers
  // still accepts them (LEGACY_BY_KEY), so nothing failed and nothing said
  // anything: the member was told we had read their licence and the serial
  // landed in a box no screen shows. See ownedFirearmSerial in
  // motivation-fields.ts for why the card's one number was ever two boxes.
  //
  // ⚠️ AND `model` AND `expiry` ARE ASKED FOR BECAUSE THE FORM CLAIMS THEY ARE.
  // Both are declared `docSourced: 'CURRENT_LICENCE'` in the registry, which is
  // a promise to the member — the wizard files them under "from your documents"
  // and read-result prints "Not on the document" against an empty one. A
  // licence card prints both (the operator's own reads "Model NONE", which is
  // the card saying this firearm has no model designation, and every card
  // carries a valid-until date), so the claim is now true rather than
  // withdrawn.
  CURRENT_LICENCE: [
    'existing_firearm_1_type',
    'existing_firearm_1_calibre',
    'existing_firearm_1_make',
    'existing_firearm_1_model',
    'existing_firearm_1_serial',
    'existing_firearm_1_expiry',
    'existing_firearm_1_licence_no',
  ],
};

/**
 * Which "firearms you already own" row a newly-uploaded licence should fill.
 *
 * ⚠️ THIS IS WHY A SECOND LICENCE USED TO VANISH. Every CURRENT_LICENCE
 * extraction wrote to row 1, so uploading a second licence either overwrote the
 * first or was discarded as an already-answered suggestion. Someone with three
 * licensed firearms — exactly the applicant whose overlap needs explaining —
 * ended up with one row and a motivation that argued the wrong case.
 *
 * ⚠️ AND "TAKEN" IS THE REGISTRY'S RULE NOW, NOT THIS FILE'S. It used to be
 * "the CALIBRE is filled", on the grounds that the wizard called that a started
 * row. Calibre is the WORST column to key on: it is the one where absence has a
 * second meaning, and it became droppable the day placeholders stopped crossing
 * the answer boundary — a card reading "Calibre: -" contributes none. A row
 * holding a make, a model and a serial would then report itself free and this
 * function would hand the next licence straight over the top of it, producing a
 * form describing a firearm that does not exist. ownedRowTaken in
 * motivation-fields.ts is the single rule; credentialOffer asks it too.
 *
 * Returns null when all {@link OWNED_ROWS} are full: the registry has no
 * fifteenth row, and silently overwriting the last would be worse than
 * proposing nothing.
 */
export function nextOwnedSlot(answers: Record<string, string>): number | null {
  return nextOwnedRow(answers);
}

/** Rewrite row-1 keys onto the row actually being filled. */
export function remapOwnedSlot(keys: string[], slot: number): string[] {
  return keys.map((k) =>
    k.replace(/^existing_firearm_1_/, `existing_firearm_${slot}_`),
  );
}

export interface ExtractedField {
  key: string;
  value: string;
  label: string;
  /** Shown next to the value so the applicant knows what to check. */
  from: string;
  /** False when our own checks disagree with what was read. */
  trusted: boolean;
  note?: string;
}

@Injectable()
export class MotivationExtractService {
  private readonly logger = new Logger(MotivationExtractService.name);

  // ⚠️ THE LLM FIRST, THE OCR SECOND, AND THE ORDER IS FORCED. `vision` and
  // `textract` are both optional (a box with no key still uploads and still
  // reads), and an optional parameter cannot precede a required one.
  constructor(
    private readonly llm: LlmService,
    private readonly vision?: GoogleVisionOcrService,
  ) {}

  /** What a failure looked like, for a log line. Codes, never a provider class. */
  private static why(err: unknown): string {
    return err instanceof LlmError
      ? `${err.code}: ${err.message}`
      : (err as Error).message;
  }

  /** Which document kinds are worth scanning at all. */
  static canExtract(kind: MotivationUploadKind): boolean {
    return Boolean(EXTRACTABLE[kind]?.length);
  }

  /**
   * The answer keys this kind of document can legitimately fill.
   *
   * Exposed so a reading copied from somewhere else — the Licence Centre
   * vault, which read the same file already — can be filtered to what this
   * registry actually has boxes for. A vault reading carries a holder name
   * and what a competency covers; proposing those as answers would offer
   * values for fields that do not exist.
   */
  static wantedFor(kind: MotivationUploadKind): string[] {
    return EXTRACTABLE[kind] ?? [];
  }

  /**
   * Read one uploaded document.
   *
   * Returns [] on every failure path — an unreadable photograph, a model
   * outage, a malformed reply. The upload still exists and the applicant types
   * the values themselves, which is exactly what they would have done anyway.
   */
  /**
   * Read a document's text once, so it can be read once.
   *
   * ⚠️ THE SAME IMAGE WAS GOING TO GOOGLE TWICE. An auto-filed upload calls
   * classify() and then extract(), and each read the bytes itself — two
   * billed calls returning the identical string, both thrown away when the
   * request ended. Operator, 2026-08-29: "is it possible to OCR all documents
   * and keep the raw files".
   *
   * So the caller reads once, hands the text to both, and stores it. Null
   * where there is nothing to read — a PDF (Vision's images:annotate takes
   * images), no key configured, or a failed call. Every consumer already
   * treats null as "Vision had nothing to add".
   */
  async ocr(bytes: Buffer, mimeType: string): Promise<string | null> {
    if (!this.vision || !mimeType.startsWith('image/')) return null;
    return this.vision.text(bytes).catch(() => null);
  }

  async extract(args: {
    kind: MotivationUploadKind;
    licenceType: MotivationLicenceType;
    bytes: Buffer;
    mimeType: string;
    /** What is already answered — decides which owned-firearm row to fill. */
    answers?: Record<string, string>;
    /**
     * Text already read off these bytes, to save reading them again.
     *
     * Undefined means "not read yet, read it here"; null means "read, and
     * there was nothing" — which is why this is not defaulted.
     */
    ocrText?: string | null;
  }): Promise<ExtractedField[]> {
    let wanted = EXTRACTABLE[args.kind] ?? [];
    if (!wanted.length || !this.llm.isConfigured()) return [];

    // A licence describes ONE firearm, and the applicant may upload several.
    if (args.kind === 'CURRENT_LICENCE') {
      const slot = nextOwnedSlot(args.answers ?? {});
      if (slot === null) return [];
      wanted = remapOwnedSlot(wanted, slot);
    }

    const registry = fieldsFor(args.licenceType);
    const asked = registry.filter((f) => wanted.includes(f.key));
    if (!asked.length) return [];

    const block = contentBlock(args.bytes, args.mimeType);

    // ⚠️ TWO ATTEMPTS, BECAUSE ONE IS NOT ENOUGH ON A MARGINAL DOCUMENT.
    //
    // Measured on a live proof of address: the same bytes, the same code and
    // the same model returned the address on roughly one attempt in three and
    // nothing on the others. A single shot therefore marked a perfectly good
    // document "we could not read anything on this", permanently, about
    // two-thirds of the time.
    //
    // The retry costs a call ONLY where the alternative is a wrong amber, and
    // it is bounded at two: a document that genuinely carries none of these
    // fields must not be paid for over and over. A second empty answer is
    // taken at its word.
    // ⚠️ ONE VISION CALL, NOT ONE PER ATTEMPT. The retry below exists because
    // the MODEL is inconsistent on marginal documents; the OCR is not, and
    // paying Google twice for the same bytes would be spending money to
    // receive the identical string. Read once, hand it to both attempts.
    //
    // A PDF is skipped: Vision's images:annotate takes images, and the block
    // above only produces an image type for image mime types.
    // undefined means the caller has not read these bytes; null means it
    // read them and Vision had nothing. Only the first re-reads.
    const ocrText =
      args.ocrText !== undefined
        ? args.ocrText
        : await this.ocr(args.bytes, args.mimeType);

    for (let attempt = 0; attempt < 2; attempt++) {
      const found = await this.attemptRead(block, asked, args.kind, ocrText);
      if (found.length) return found;
    }
    return [];
  }

  /** One read. Returns [] on any failure — the caller decides about retrying. */
  private async attemptRead(
    block: LlmPart,
    asked: {
      key: string;
      label: string;
      /** Registry kind — 'multi' values arrive comma-joined. */
      kind?: string;
      choices?: readonly string[];
    }[],
    kind: MotivationUploadKind,
    /**
     * What Google Vision read off the same image, when it could.
     *
     * ⚠️ ALONGSIDE THE PICTURE, NOT INSTEAD OF IT. Operator, 2026-08-24. The
     * model reading the IMAGE sees layout — which column a serial sits in,
     * which label owns which value; Vision reading the same image resolves
     * CHARACTERS better on dense or faint print. Given both, a misread digit
     * has to survive two independent readers. Null whenever Vision had nothing
     * to add, which includes every run off the live box because the key is
     * IP-restricted.
     */
    ocrText: string | null,
  ): Promise<ExtractedField[]> {
    if (!this.llm.isConfigured()) return [];
    let text = '';
    try {
      const res = await this.llm.complete({
        maxTokens: 1200,
        // ⚠️ THINKING OFF. Twelve hundred tokens is a JSON object of
        // transcribed fields; a thinking budget shares that ceiling and the
        // whole allowance can go to reasoning, leaving a truncated object that
        // the fail-soft parse below reads as "could not read anything on this".
        // The motivation writer lost a live document to exactly that.
        thinking: { budgetTokens: 0 },
        // ⚠️ NO `temperature` HERE, AND THINK BEFORE ADDING ONE.
        //
        // temperature / top_p / top_k were REMOVED from the Anthropic API on
        // the models this used to run on, and sending one was a 400:
        //   "`temperature` is deprecated for this model."
        //
        // It cost us two days of silence: every call site here fails soft, so
        // the 400 was caught, logged at warn, and the feature simply did
        // nothing. Deterministic transcription became the DEFAULT because
        // there was no parameter to ask for it.
        //
        // ⚠️ THAT DEFAULT BELONGED TO THE OLD PROVIDER. The neutral contract
        // carries `temperature` again and omitting it takes the provider's
        // default, which is not 0. If a transcriber starts giving different
        // digits for the same photograph, this is the cause and `temperature:
        // 0` is the fix — it is a real parameter again, not a 400.
        system: this.systemPrompt(),
        messages: [
          {
            role: 'user',
            content: [
              block,
              ...(ocrText
                ? [
                    {
                      type: 'text' as const,
                      text:
                        'A separate OCR pass over the SAME image read the ' +
                        'following characters. Use it to settle anything the ' +
                        'picture leaves ambiguous. Where the two disagree, ' +
                        'trust the picture for LAYOUT (which value belongs to ' +
                        'which label) and this for CHARACTERS, and mark the ' +
                        'field low confidence.' +
                        String.fromCharCode(10) + String.fromCharCode(10) +
                        '<ocr>' +
                        String.fromCharCode(10) +
                        ocrText +
                        String.fromCharCode(10) +
                        '</ocr>',
                    },
                  ]
                : []),
              {
                type: 'text',
                text: this.userPrompt(asked),
              },
            ],
          },
        ],
        purpose: `motivation.extract.${kind.toLowerCase()}`,
        timeoutMs: 60_000,
      });
      text = res.text.trim();
    } catch (err) {
      // FAIL-SOFT. The bytes are stored; the applicant is not blocked.
      this.logger.warn(
        `Extraction failed for ${kind}: ${MotivationExtractService.why(err)}`,
      );
      return [];
    }

    return this.parse(text, asked, kind);
  }

  /**
   * NAME THE DOCUMENT.
   *
   * Exists because the required-documents checklist ticks on the KIND the
   * member picked from a dropdown, not on what is in the file — so a
   * mislabelled upload shows the requirement satisfied while the pack is
   * actually missing it. That is not hypothetical: the operator's own proof of
   * address went in as an identity document because the picker defaults to its
   * first option.
   *
   * ⚠️ IT PROPOSES; IT NEVER OVERRULES. A kind the member chose explicitly is
   * kept whatever this returns. Only an upload with no kind — one file of a
   * batch — is filed on this, and the wizard shows what each was filed as with
   * a way to change it.
   *
   * Returns null when it cannot tell, and null means OTHER: a document filed
   * as "something else" is visibly unsorted, where a confident wrong guess
   * looks like a satisfied requirement.
   */
  /** Is a second, firearm-only read worth making on this kind? */
  static readsFirearm(kind: MotivationUploadKind): boolean {
    return FIREARM_READABLE.has(kind);
  }

  /**
   * Read the FIREARM off a document, whatever kind of document it is.
   *
   * ⚠️ NO CLASSIFICATION STEP, AND THAT IS THE FEATURE. extract() asks what a
   * document of a KNOWN kind carries; this asks what firearm the page is
   * about. A dealer invoice, a seller's licence card, a prefilled 271, a
   * printed advert and a photograph of the box all answer it, and requiring a
   * classifier to name the genre first turns every unrecognised one into a
   * dead end — which is the applicant who has "atleast something".
   *
   * ⚠️ IT RETURNS ONLY WHAT THE MOTIVATION HAS A BOX FOR. The reader covers
   * SAPS 271 section E, which is wider than our registry: the frame and
   * receiver serials are real, separate numbers with nowhere to go yet, and
   * forcing either into the one serial field would put the WRONG number on a
   * signed application. They are dropped here rather than guessed.
   *
   * Fail-soft like every other model call in this file: no reader, no crash,
   * the applicant types the fields.
   */
  async readFirearm(args: {
    bytes: Buffer;
    mimeType: string;
  }): Promise<Record<string, string>> {
    // ── ONE READER: GEMINI ────────────────────────────────────────────
    //
    // ⚠️ A TEXTRACT-FIRST PASS STOOD HERE AND IT IS GONE — operator, 2026-09-08:
    // "we will also be losing AWS textract and only be using gemini going
    // forward." It was added on 2026-09-07 (d90fbdcf) for a real reason: a
    // SAPS licence card is a FORM, so Make, Calibre, Serial Number and the
    // three component rows came back as clean labelled key/value pairs, read
    // deterministically and for a fraction of a vision call.
    //
    // ⚠️ SO THE REASON IT WAS PUT FIRST HAS TO BE ANSWERED, NOT IGNORED. It
    // was first because a single Gemini vision pass on a real photograph is
    // inconsistent — measured elsewhere in this file at roughly one attempt in
    // three landing everything visible. Two things carry that load now: the
    // two-attempt loop below, which already existed and was added in the same
    // commit, and `json: { schema: FIREARM_READING_SCHEMA }` on the call
    // itself, so the answer's SHAPE is enforced by the provider rather than
    // hunted out of prose with a regex.
    //
    // What is genuinely lost is Textract's per-field OCR confidence on a card
    // it read cleanly. The prompt asks the model to mark a smudged or
    // handwritten value "low" instead, which is the model's own judgement
    // rather than a measurement — weaker, and honestly weaker.
    if (!this.llm.isConfigured()) return {};

    const block = contentBlock(args.bytes, args.mimeType);

    // ⚠️ TWO ATTEMPTS, SAME REASON AS extract()'s attemptRead loop: a single
    // vision call on a real photograph is inconsistent — measured elsewhere in
    // this file at roughly one attempt in three landing everything visible.
    // This call had no retry at all, so a card that plainly prints a serial
    // number could come back with three fields (make, calibre, type) and stop
    // there, with nothing to fall back on.
    for (let attempt = 0; attempt < 2; attempt++) {
      const out = await this.attemptReadFirearm(block);
      if (Object.keys(out).length) {
        this.logger.log(
          `Firearm read filled ${Object.keys(out).length} field(s): ${Object.keys(out).join(', ')}`,
        );
        return out;
      }
    }
    return {};
  }

  /** One firearm-read attempt. Returns {} on any failure — the caller retries. */
  private async attemptReadFirearm(
    block: LlmPart,
  ): Promise<Record<string, string>> {
    let text = '';
    try {
      const res = await this.llm.complete({
        maxTokens: 800,
        // Transcription into a fixed JSON shape, like every read in this file:
        // the budget must be text, not reasoning. See attemptRead().
        thinking: { budgetTokens: 0 },
        system: firearmIdentityPrompt(),
        messages: [
          {
            role: 'user',
            content: [
              block,
              {
                type: 'text',
                text: 'Read the firearm off this document.',
              },
            ],
          },
        ],
        // ⚠️ THE SHAPE IS THE PROVIDER'S JOB NOW. See FIREARM_READING_SCHEMA:
        // it constrains the envelope and nothing else, and every semantic
        // guard in parseFirearmReading stays exactly where it was.
        json: { schema: FIREARM_READING_SCHEMA as unknown as Record<string, unknown> },
        purpose: 'motivation.extract.firearm',
        timeoutMs: 60_000,
      });
      text = res.text.trim();
    } catch (err) {
      this.logger.warn(
        `Firearm read failed: ${MotivationExtractService.why(err)}`,
      );
      return {};
    }

    // ⚠️ THE REGEX STAYS EVEN THOUGH THE SCHEMA SHOULD MAKE IT UNNECESSARY.
    // `json: { schema }` is a provider constraint, not a guarantee we control:
    // a future model, a provider fallback or the Anthropic rollback path
    // (LLM_PROVIDER=anthropic, which is more permissive) can all still hand
    // back a fenced or prefaced answer. Two lines of defence cost nothing;
    // removing them costs a read.
    const m = text.match(/\{[\s\S]*\}/);
    const reading = parseFirearmReading(m ? m[0] : text);

    const out: Record<string, string> = {};
    for (const [from, to] of Object.entries(FIREARM_KEY_MAP)) {
      // ⚠️ THIS IS A READER, AND A READER KEEPS THE CARD VERBATIM. The
      // card-placeholder rule states it in capitals and this loop is not the
      // place for it: the answer boundary is the ONE consumer,
      // motivation-documents.service.ts, which runs answerValue() over every
      // pair before it becomes a proposed answer. A new consumer that wants a
      // reading turned into an answer must do the same — what this function
      // returns is what the page said, which is exactly what the printed
      // seller-consent declaration is entitled to.
      //
      // ⚠️ AND "NONE" NEVER REACHED HERE ANYWAY, whatever an earlier note
      // claimed. parseFirearmReading in common/firearm-identity.ts drops
      // none / n/a / unknown / "not visible" before a value is ever written
      // into `reading.values`, so a guard here could only ever have caught the
      // wordings that rule does not know (NIL, GEEN, a bare dash) — and those
      // are caught at the boundary with everything else. Do not weaken the
      // inner filter on the strength of a duplicate that is no longer here.
      const v = (reading.values[from] ?? '').trim();
      if (v) out[to] = v;
    }
    return out;
  }

  async classify(args: {
    bytes: Buffer;
    mimeType: string;
    /** Text already read off these bytes. See ocr() — undefined ≠ null. */
    ocrText?: string | null;
  }): Promise<{ kind: MotivationUploadKind; confident: boolean } | null> {
    // ── MARKERS FIRST, THE MODEL FOR WHAT NEEDS JUDGEMENT ──────────
    //
    // ⚠️ THE MODEL WAS CLASSIFYING DOCUMENTS THAT SAY WHAT THEY ARE. A PFTC
    // statement of results prints the council's name and a registered unit
    // standard; a competency certificate prints SAPS 524. Paying a vision
    // model to read a form number is spending money to be less certain — the
    // marker is free, instant, and cannot hallucinate.
    //
    // ⚠️ AND A MISS IS NOT A FAILURE. Operator, 2026-08-29: proof of address,
    // a letter of good standing and a dedicated-status certificate "will
    // always differ from person to person... I need the AI to interpret these
    // documents and decide what they are". Those carry no marker by nature,
    // fall through here, and the model below is the right tool rather than a
    // consolation prize. See MODEL_ONLY_KINDS.
    // undefined means the caller has not read these bytes; null means it
    // read them and Vision had nothing. Only the first re-reads.
    const ocr =
      args.ocrText !== undefined
        ? args.ocrText
        : await this.ocr(args.bytes, args.mimeType);

    if (ocr) {
      const verdict = readMarkers(ocr);
      if (verdict) {
        this.logger.log(
          `Classified ${verdict.kind} by ${verdict.strength} marker, no model call`,
        );
        // ⚠️ `confident` ONLY ON A DEFINITIVE MARKER. A form number is the
        // document; a unit-standard code beside its title is strong evidence
        // and still worth a member's glance, and `confident: false` is what
        // puts the correction dropdown in front of them.
        return { kind: verdict.kind, confident: verdict.strength === 'definitive' };
      }
    }

    if (!this.llm.isConfigured()) return null;

    const block = contentBlock(args.bytes, args.mimeType);

    let text = '';
    try {
      const res = await this.llm.complete({
        maxTokens: 200,
        // ⚠️ THINKING OFF, AND THIS IS THE TIGHTEST CEILING IN THE FILE. Two
        // hundred tokens is one small JSON object; a thinking budget sharing
        // it produces a truncated answer, which parses to null, which files
        // the document as "something else" — a silent regression that looks
        // exactly like a model that could not tell.
        thinking: { budgetTokens: 0 },
        system: CLASSIFY_SYSTEM,
        messages: [
          { role: 'user', content: [block, { type: 'text', text: CLASSIFY_USER }] },
        ],
        purpose: 'motivation.classify',
        timeoutMs: 60_000,
      });
      text = res.text.trim();
    } catch (err) {
      // Fail soft, like every other model call here: an unsorted document is
      // a small inconvenience, a failed upload is not.
      this.logger.warn(
        `Classification failed: ${MotivationExtractService.why(err)}`,
      );
      return null;
    }

    try {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return null;
      const parsed = JSON.parse(m[0]) as { kind?: string; confidence?: string };
      const kind = (parsed.kind ?? '').trim() as MotivationUploadKind;
      if (!CLASSIFIABLE.includes(kind)) return null;
      return { kind, confident: (parsed.confidence ?? '') === 'high' };
    } catch {
      return null;
    }
  }

  private systemPrompt(): string {
    return `
You read a photographed or scanned South African document and transcribe
specific fields from it. You are a TRANSCRIBER, not an interpreter.

RULES, in order of importance:

1. Output ONLY what you can actually SEE. If a field is not on the document, or
   is blurred, cropped, glared out or ambiguous, return null for it. A null is
   correct and useful; a guess is a false statement on a firearm licence
   application.
2. Do NOT infer. Do not derive a date of birth from an ID number, do not expand
   an abbreviation you are unsure of, do not tidy a name into what you think it
   should be. Transcribe the characters on the document.
3. Read digits with particular care — 0/O, 1/I, 5/S, 8/B. If a single character
   is uncertain, the whole value is null.
4. Dates as YYYY-MM-DD.
5. If the document is not the type you were told to expect, return every field
   as null rather than reading a different document's contents into them.

Return STRICT JSON and nothing else:
{"fields":[{"key":"<exactly one of the keys given>","value":"<string>","confidence":"high"|"low"}]}

Omit any field you cannot read. Use "low" whenever you are not certain — a low
confidence value is shown to the applicant with a warning, which is far better
than a confident wrong one.`.trim();
  }

  private userPrompt(
    asked: {
      key: string;
      label: string;
      help?: string;
      /** Registry kind — 'multi' values arrive comma-joined. */
      kind?: string;
      choices?: readonly string[];
    }[],
  ): string {
    const lines = asked.map(
      (f) =>
        `- ${f.key}: ${f.label}` +
        (f.choices ? ` (must be exactly one of: ${f.choices.join(' | ')})` : '') +
        (f.help ? ` — ${f.help}` : ''),
    );
    return [
      'Read the attached document and transcribe these fields:',
      ...lines,
      '',
      'Return only the fields you can actually see on it.',
    ].join('\n');
  }

  /** Parse, then CHECK. Nothing is trusted just because it parsed. */
  private parse(
    text: string,
    asked: {
      key: string;
      label: string;
      /** Registry kind — 'multi' values arrive comma-joined. */
      kind?: string;
      choices?: readonly string[];
    }[],
    kind: MotivationUploadKind,
  ): ExtractedField[] {
    let parsed: { fields?: { key?: unknown; value?: unknown; confidence?: unknown }[] };
    try {
      const json = text.startsWith('{') ? text : text.slice(text.indexOf('{'));
      parsed = JSON.parse(json);
    } catch {
      this.logger.warn(`Extraction for ${kind} returned unparseable JSON`);
      return [];
    }

    const byKey = new Map(asked.map((f) => [f.key, f]));
    const out: ExtractedField[] = [];

    for (const row of parsed.fields ?? []) {
      if (typeof row?.key !== 'string' || typeof row?.value !== 'string') continue;
      const field = byKey.get(row.key);
      // ONLY fields we asked for. A model inventing a key would otherwise
      // propose a value against a field that does not exist.
      if (!field) continue;

      // ⚠️ THE THIRD ANSWER BOUNDARY, AND THE SHORTEST ROUTE TO THE BUG. This
      // is the direct read: a licence card goes in, `existing_firearm_N_*`
      // comes out as a proposed answer. The system prompt correctly orders the
      // model to transcribe what it can SEE, and what a licence card prints in
      // a row that does not apply is the word NONE — so a faithful transcriber
      // hands us "frame_serial: NONE" and `if (!value)` waved it through. Every
      // EXTRACTABLE key is a fact printed on a document (a name, a number, an
      // address, a serial), never a question whose answer could legitimately BE
      // "none", so the rule is safe to apply to all of them here.
      let value = answerValue(row.value);
      if (!value) continue;

      // ⚠️ THE COMPETENCY ENDORSEMENTS ARE READ, NOT MATCHED. A certificate
      // prints "S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN" or "Handgun,
      // non-self-loading"; no amount of prompting reliably turns that into our
      // exact labels, and the system prompt FORBIDS the model from trying —
      // it is told it is a transcriber, not an interpreter. So the model
      // transcribes the block verbatim and the interpreting happens here, in
      // code, against the rules in sa-competency. Unreadable yields nothing.
      if (row.key === 'competency_for') {
        const labels = parseEndorsements(value)
          .map((e) => endorsementSpec(e)?.label)
          .filter((l): l is string => !!l);
        if (!labels.length) {
          this.logger.warn(
            `Extraction for ${kind}: competency_for could not be read from ${JSON.stringify(
              value.slice(0, 60),
            )}`,
          );
          continue;
        }
        value = labels.join(', ');
      }

      // A choice must be one of the offered choices, or it is not a choice.
      //
      // ⚠️ MULTI FIELDS ARE COMMA-JOINED, AND TESTING THE WHOLE STRING AGAINST
      // SINGLE CHOICES DROPPED EVERY ONE OF THEM. `competency_for` is multi,
      // so a perfectly good "Handgun, Rifle" failed `choices.includes(value)`
      // and fell through this bare `continue` — no log, no note, no counter.
      // That is why "what your competency covers" never populated itself from
      // a certificate: the reading worked and the result was binned one line
      // before it was used. Parts are validated individually now, and a reject
      // says so instead of vanishing.
      if (field.choices) {
        const parts =
          field.kind === 'multi'
            ? value.split(',').map((p) => p.trim()).filter(Boolean)
            : [value];
        const matched = parts.map((p) =>
          field.choices?.find((c) => c.toLowerCase() === p.toLowerCase()),
        );
        if (matched.some((m) => !m)) {
          this.logger.warn(
            `Extraction for ${kind}: ${row.key} value ${JSON.stringify(
              value.slice(0, 60),
            )} is not an offered choice — dropped`,
          );
          continue;
        }
        // Canonical spelling and casing, so the save path accepts it.
        value = (matched as string[]).join(', ');
      }

      // ⚠️ A DATE FIELD TAKES A DATE, OR IT TAKES NOTHING. Rule 4 of the system
      // prompt asks for YYYY-MM-DD and a transcriber mostly obliges, but a
      // licence card prints "2027/06/30" and "30 JUN 2027" and a model reading
      // one of those faithfully hands it straight back. The registry renders
      // `kind: 'date'` in a date input, so a value that is not an ISO day is one
      // the wizard cannot display and the member cannot correct without first
      // noticing it is wrong — the identical failure the vault side closed with
      // DATE_DETAILS in licence-centre-extract.service.ts. Dropped, not
      // coerced: 06/07 is two different days depending on which side of the
      // Atlantic printed it, and guessing which is inventing the fact.
      if (field.kind === 'date' && !isIsoDay(value)) {
        this.logger.warn(
          `Extraction for ${kind}: ${row.key} value ${JSON.stringify(
            value.slice(0, 30),
          )} is not a yyyy-mm-dd date — dropped`,
        );
        continue;
      }

      let trusted = row.confidence === 'high';
      let note: string | undefined;

      // THE ID NUMBER IS VERIFIED IN CODE. A Luhn failure means it was misread,
      // whatever the model's confidence says.
      if (row.key === 'id_number') {
        const read = readSaId(value);
        if (!read.valid || !read.dateOfBirth) {
          trusted = false;
          note = 'Check this carefully — it does not look like a valid SA ID number.';
        }
      }

      if (!trusted && !note) {
        note = 'We were not certain about this one — please check it.';
      }

      out.push({
        key: row.key,
        value,
        label: field.label,
        from: UPLOAD_LABEL[kind] ?? 'your document',
        trusted,
        note,
      });
    }

    return out;
  }
}

/**
 * yyyy-mm-dd, and a day that actually exists.
 *
 * Three lines rather than an import from licence-centre/, so the dependency
 * between the two modules keeps pointing one way at the source level as well as
 * in the Nest graph — the same call motivation-credentials.ts makes for
 * toIsoDay. The round-trip is what rejects 2026-02-31.
 */
function isIsoDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const UPLOAD_LABEL: Partial<Record<MotivationUploadKind, string>> = {
  IDENTITY_DOCUMENT: 'your ID',
  COMPETENCY_CERTIFICATE: 'your competency certificate',
  PROFICIENCY_CERTIFICATE: 'your proficiency certificate',
  ADDRESS_CONFIRMATION: 'your proof of address',
  ASSOCIATION_CARD: 'your dedicated status certificate',
  GOOD_STANDING_LETTER: 'your letter of good standing',
  ASSOCIATION_ENDORSEMENT: "your association's endorsement",
  CURRENT_LICENCE: 'your existing licence',
};

/** The kinds a photograph can actually be sorted into. */
const CLASSIFIABLE: MotivationUploadKind[] = [
  // ⚠️ ALL THREE ASSOCIATION DOCUMENTS ARE SEPARATELY CLASSIFIABLE, and they
  // must be: they come from the same association on the same letterhead, and
  // a classifier that only knew ASSOCIATION_CARD would file the sworn letter
  // and the endorsement as the status certificate. The pack would then look
  // complete while missing the declaration section 16(2) asks for.
  'GOOD_STANDING_LETTER',
  'ASSOCIATION_ENDORSEMENT',
  'IDENTITY_DOCUMENT',
  'COMPETENCY_CERTIFICATE',
  'PROFICIENCY_CERTIFICATE',
  'CURRENT_LICENCE',
  'ASSOCIATION_CARD',
  'ADDRESS_CONFIRMATION',
  'EMPLOYMENT_CONFIRMATION',
  // ⚠️ ONE SAFE CATEGORY. It was four — shut, part open, bolts, anchored — and
  // telling them apart means judging how far a door is open from one frame, so
  // a wrong answer filed the bolts shot under the closed-door annexure.
  'SAFE_PHOTOGRAPHS',
  'CHARACTER_REFERENCE',
  'INCIDENT_REPORT',
  // A dealer's invoice, a prefilled 271, a seller's paperwork or estate
  // letters — routing spec §5.4's four source paths, which all file here.
  'FIREARM_SOURCE_PROOF',
  'PREVIOUS_MOTIVATION',
  'OTHER',
];

/**
 * One base64 content part, image or PDF. Shared by read and classify.
 *
 * ⚠️ THE MIME TYPE IS NARROWED, NOT PASSED THROUGH. A phone sends heic, a
 * scanner sends tiff, and a browser sometimes sends nothing at all — an
 * unrecognised type is declared as JPEG because that is what the upload path
 * has already normalised the bytes to, and a type the provider rejects fails
 * the whole read rather than one field.
 */
function contentBlock(bytes: Buffer, mimeType: string): LlmPart {
  if (mimeType === 'application/pdf') {
    return {
      type: 'document',
      mimeType: 'application/pdf',
      data: bytes.toString('base64'),
    };
  }
  return {
    type: 'image',
    mimeType:
      mimeType === 'image/png'
        ? 'image/png'
        : mimeType === 'image/webp'
          ? 'image/webp'
          : 'image/jpeg',
    data: bytes.toString('base64'),
  };
}

const CLASSIFY_SYSTEM = `
You sort a photographed or scanned South African document into exactly one
category. You are sorting, not reading: you do not need to transcribe anything.

Answer with the category you can actually see evidence for. "OTHER" is a real
answer and a useful one — a document filed as "something else" is visibly
unsorted, where a confident wrong answer looks like a satisfied requirement on
a firearm licence application.

Return STRICT JSON and nothing else:
{"kind":"<one category>","confidence":"high"|"low"}
`.trim();

const CLASSIFY_USER = [
  'Which of these is this document? Answer with the exact string.',
  '',
  'IDENTITY_DOCUMENT - a South African ID book, ID card, or passport',
  'COMPETENCY_CERTIFICATE - a SAPS competency certificate',
  'PROFICIENCY_CERTIFICATE - a proficiency or firearm training certificate',
  'CURRENT_LICENCE - a firearm licence card or certificate',
  'ASSOCIATION_CARD - hunting or sport-shooting association membership',
  'ADDRESS_CONFIRMATION - proof of address: a municipal bill, bank statement,',
  '  lease or affidavit showing a residential address',
  'EMPLOYMENT_CONFIRMATION - a letter confirming employment',
  'SAFE_PHOTOGRAPHS - a photograph of a gun safe or strongroom, in ANY state:',
  '  door shut, part open with a key in it, wide open showing the locking',
  '  bolts, or showing how the safe is bolted to a wall or floor',
  'CHARACTER_REFERENCE - a personal reference letter about someone',
  'INCIDENT_REPORT - a SAPS case document or armed-response incident report',
  'PREVIOUS_MOTIVATION - a previously written firearm licence motivation',
  'OTHER - anything else, or you cannot tell',
  '',
  '⚠️ DO NOT TRY TO TELL THE SAFE SHOTS APART. This prompt used to ask you to,',
  'and telling a half-open door from a shut one in a single frame is a fine',
  'judgement to get wrong: filing the bolts shot as the closed shot put the',
  'wrong photograph under the wrong annexure letter, where the applicant could',
  'not see it and the Designated Firearms Officer could. They are one category',
  'now. A member sends several and each is filed the same way.',
].join('\n');
