import { BLOCK_LABELS, sectionOf } from './motivation-research.service';
import { withoutRefusedCopy } from './motivation-scope';
import { PDFDocument } from 'pdf-lib';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MotivationLicenceType,
  MotivationStatus,
  MotivationUploadKind,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { decryptJson, tryDecryptText } from '../common/blob-crypto';

import { MotivationQuotaService } from './motivation-quota.service';
import { CipSheetService } from './cip-sheet.service';
import { QuarryPlateService } from './quarry-plate.service';
import { MotivationPlatesService } from './motivation-plates.service';
import { purposeFor } from './motivation-plates';

import { displayAction, displayCalibre } from './saps-vocabulary';
import { asLayout } from './motivation-pdf-layouts';
import { consentFormFor } from './motivation-consent-statement';
import {
  AnnexureImagePage,
  MotivationPdfService,
  type PressClippingPage,
  asScheme,
  asFormat,
} from './motivation-pdf.service';
import { NewsService } from '../news/news.service';
import { CrimeStatsService } from '../crime-stats/crime-stats.service';
import { parseTravelledAreas } from './motivation-danger-areas';
import { SAPS_271_MARKER } from '../common/document-markers';
import { TRAVELLED_AREAS_KEY } from './motivation-fields';
import type { NewsIncident } from '../news/news.types';
import { imageSize, isEmbeddable } from './motivation-annexure-layout';
import { documentLabel, documentStatus } from './motivation-documents';
import {
  suitabilityPageLines,
  type SuitabilityArgument,
} from './motivation-suitability';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { type SectionId } from './motivation-structure';
import {
  buildAnnexures,
  BODY_DOCUMENT_KINDS,
  UPLOAD_KIND_LABELS,
  annexureByKind,
  annexureByContainer,
  isSafeAnnexureKind,
  type AnnexureEntry,
  type EvidenceAnnexure,
} from './motivation-checklist';
import {
  EVIDENCE_BODY_MAX,
  containerById,
} from './evidence-taxonomy';
import type { EvidencePage } from './motivation-pdf.service';

/**
 * The shape evidenceForRender and buildEvidenceBody read off an upload.
 *
 * ⚠️ A NARROW INTERFACE RATHER THAN THE PRISMA ROW, so both methods can be
 * exercised on a plain object in a spec without a database or a full upload
 * select — the same posture as the rest of this renderer's helpers.
 */
export interface EvidenceUploadForRender {
  id: string;
  kind: MotivationUploadKind;
  storageKey: string | null;
  mimeType: string | null;
  purgedAt: Date | null;
  /** Plaintext hash, for the PDF page raster cache. */
  sha256?: string | null;
  evidenceType?: string | null;
  evidenceDescriptionEncrypted?: string | null;
}
import { MotivationSellerConsentService } from './motivation-seller-consent.service';
import { buildPriorNoticeRequest } from './motivation-prior-notice';
import { applicationWarnings } from './motivation-warnings';
import { buildCompletedStatement } from './motivation-character-statement';
import { WITNESS_FORM_VERSION } from './motivation-witness-form';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CIP_INSET_SCALE, rasterisePdfToDir } from './pdf-raster';
import { DocumentPageRasterService } from './document-page-raster.service';
import sharp from 'sharp';
import { findCartridge } from './motivation-cartridge';
import {
  cartridgeDimRows,
  cartridgeDrawing,
  completeDims,
  type DrawingText,
} from './motivation-cartridge-drawing';
import { FirearmImageService } from './motivation-firearm-image';
import { markForSection, type MarkName } from './motivation-pdf-marks';
import { MotivationWitnessService } from './motivation-witness.service';
import {
  asCoverChoice,
  checkCoverPhoto,
  COVER_ASPECT,
  COVER_FRAME_MM,
  COVER_MAX_PX,
} from './motivation-cover-photo';
import {
  LICENCE_TYPE_LABELS,
  OWNED_ROWS,
  isSelfDefence,
  ownedFirearmSerial,
  PRESS_CLIPPINGS_KEY,
  parsePressClippingIds,
} from './motivation-fields';
import { Saps271Service } from './saps271.service';
import {
  MotivationSharedService,
  TEMPLATE_VERSION,
} from './motivation-shared.service';

// ────────────────────────────────────────────────────────────────────
// RENDERING — the finished pack. The PDF, its annexure images, the C.I.P.
// datasheet, the signed statements that go behind it, the cover photograph
// and the pre-filled SAPS 271.
// ────────────────────────────────────────────────────────────────────

/**
 * ⚠️ FIRST PERSON, LIKE EVERY OTHER WORD ON THE PAGE. Operator, 2026-08-21:
 * "do not refer to the applicant in the third person anywhere in the doc.
 * First person perspective as if it the applicant typing the document
 * always."
 *
 * This is the applicant's own motivation, signed by them and handed to the
 * Registrar by them. A disclaimer that switches to "the applicant confirms"
 * halfway down the last page announces that somebody else wrote the document
 * — which is both true and exactly the thing a reviewer should not be
 * thinking about while reading it.
 *
 * The legal content is unchanged: it still says the facts are mine, that it
 * is not legal advice, and that the decision is not ours to make. It says it
 * in the voice of the person signing.
 */
/**
 * What the design sample says under the cover.
 *
 * ⚠️ DELIBERATELY NOT THE APPLICANT'S OWN WORDS. Most people reach the
 * design choice BEFORE anything is written, so there is usually no draft to
 * show - and half a real argument presented as a sample is worse than none.
 * Two lines of plain text is enough to prove the body face and the heading
 * style, which is all the second page of a sample is for.
 */
const SAMPLE_BODY = [
  'Introduction:',
  'This page shows how your document is set. The words here are a sample; ' +
    'your own motivation is written from your answers.',
].join(String.fromCharCode(10) + String.fromCharCode(10));

const DISCLAIMER_TEXT =
  'I prepared this motivation with assistance from ALL Outdoor, from ' +
  'information I supplied, and I submit it as my own. It is not legal ' +
  'advice. I confirm that the facts stated in it are true and correct to the ' +
  'best of my knowledge.';

/**
 * An ISO date as a South African reader expects it, and anything else verbatim.
 *
 * ⚠️ NEVER GUESSES. `kind: 'date'` fields store ISO, but a value that arrived
 * some other way is printed exactly as it was given rather than reinterpreted —
 * reading 03/04/2029 as one order or the other is how a licence expiry becomes
 * a different licence expiry on a document somebody files.
 */
function saDate(raw: string): string {
  const s = (raw ?? '').trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : s;
}

/**
 * The firearms the applicant already holds, read out of the numbered answer
 * fields and into a table the PDF can print.
 *
 * ⚠️ EVERY ROW THE REGISTRY OFFERS, NOT THREE. This looped `i <= 3` while
 * the registry carried six rows and the 271 printed six — so an applicant with
 * four licences had the fourth collected, printed on their form, argued about
 * by the overlap check, and MISSING from the one table in the pack a DFO reads
 * to see what they already hold. That is the table's whole job (section 13
 * caps a self-defence applicant at one firearm and section 15(3) caps an
 * occasional sport shooter at four), so an undercount is not a cosmetic
 * shortfall — it understates the statutory precondition being checked.
 * OWNED_ROWS is imported so this can never sit behind the registry again.
 *
 * ⚠️ FOUR COLUMNS: MAKE, CALIBRE, SERIAL, EXPIRY. Operator, 2026-09-07:
 * "Make, Calibre, Serial Number, Date of expiry" — replacing the earlier
 * Type / "Held under" (licence number) columns. Type and the licence number
 * are dropped from this table; the serial and expiry each get their own
 * column instead of riding beside the licence number.
 *
 * The old note here read "SERIALS ARE NOT PRINTED HERE ... a serial in a table
 * on a motivation is a line a reviewer has to check against a licence that is
 * already annexed, and getting it wrong is worse than omitting it". That
 * reasoning has expired: since 2026-09-07 there is ONE serial per firearm and
 * ownedFirearmSerial() is the single reader for it, so the 271, the vault and
 * this table cannot disagree about a number any more.
 *
 * A row with no make AND no calibre is skipped rather than printed as a row
 * of dashes: the interview lets an applicant start firearm 2 and abandon it,
 * and half a row on a submission reads as carelessness.
 *
 * Exported for its spec only — it is pure, and the alternative is asserting
 * about a table through a whole PDF render.
 */
/**
 * The section a held firearm's card puts it under, as the table prints it.
 *
 * ⚠️ AN EM DASH RATHER THAN A GUESS, AND THAT IS THE WHOLE POINT OF THE
 * COLUMN. MO000071 had no section column, the prompt asked the writer for one
 * per firearm, and it supplied five — putting a section 16 Marlin under
 * section 15 in a document the applicant signed. A row we cannot place prints
 * nothing, which is a fact a DFO can act on; a row we place wrongly is a
 * contradiction they find against the licence copies two tabs away.
 */
function heldSection(answers: Record<string, string>, i: number): string {
  const key = (answers[`existing_firearm_${i}_section_held`] ?? '').trim();
  const m = /^section_(\d{2})$/.exec(key);
  return m ? `Section ${m[1]}` : '—';
}

/**
 * What the card and the endorsement say the firearm is FOR.
 *
 * ⚠️ STATED OR ABSENT — NEVER DERIVED FROM THE SECTION. "Section 16" does not
 * tell you whether somebody hunts or shoots sport with it, and filling the
 * column from the section number would put a role on the page that nothing
 * supplied. Rule 12 in a table instead of in a sentence.
 */
function heldStatus(answers: Record<string, string>, i: number): string {
  const p = `existing_firearm_${i}_`;
  return (
    (answers[`${p}use`] ?? '').trim() ||
    OWN_USE_WORDS[(answers[`${p}primary_use`] ?? '').trim()] ||
    // ⚠️ EMPTY, NOT AN EM DASH. The battery table drops its whole Purpose
    // column when nothing was stated, and an em dash is a non-empty string —
    // so returning one here made every battery print a column of dashes. The
    // section column keeps its dash (a wrong section is worse than a gap); a
    // purpose is only ever the member's own word, so nothing stated prints
    // nothing.
    ''
  );
}

/**
 * The card keys as a table cell, in three or four words.
 *
 * ⚠️ NOT THE CARD'S OWN SENTENCE. PRIMARY_USE stores first-person sentences —
 * "I use it for plains game." — which is right in the picker and wrong in a
 * column six centimetres wide beside three other columns.
 */
const OWN_USE_WORDS: Record<string, string> = {
  self_defence_carry: 'Self-defence, carried',
  home_defence: 'Home defence',
  small_game: 'Small game',
  plains_game: 'Plains game',
  dangerous_game: 'Dangerous game',
  wingshooting: 'Birds',
  clays: 'Clay targets',
  sport_competition: 'Sport, competition',
  sport_practice: 'Sport, practice',
  collection: 'Collection',
  unused: 'No longer used',
  culling: 'Culling',
  livestock_protection: 'Livestock protection',
  training_others: 'Teaching others',
  range_practice: 'Range practice',
  dedicated_status: 'Dedicated status',
  business_use: 'Business use',
  inherited: 'Inherited',
  spare_for_repair: 'Spare',
};

export interface OwnedFirearmRow {
  make: string;
  calibre: string;
  serial: string;
  expiry: string;
  /** Handgun, rifle, shotgun — SAPS 271 item 2.1 prints it and the table did not. */
  type: string;
  /** "Section 16", or an em dash where no licence card established one. */
  section: string;
  /** What it is licensed or endorsed FOR, where something stated it. */
  status: string;
}

export function existingFirearms(
  answers: Record<string, string>,
): OwnedFirearmRow[] {
  const out: OwnedFirearmRow[] = [];
  for (let i = 1; i <= OWNED_ROWS; i++) {
    const make = (answers[`existing_firearm_${i}_make`] ?? '').trim();
    const model = (answers[`existing_firearm_${i}_model`] ?? '').trim();
    const calibre = displayCalibre(answers[`existing_firearm_${i}_calibre`]);
    const serial = ownedFirearmSerial(answers, i);
    const expiry = (answers[`existing_firearm_${i}_expiry`] ?? '').trim();
    if (!make && !calibre) continue;
    out.push({
      // The column is headed "Make and model"; it was fed the make alone.
      make: [make, model].filter(Boolean).join(' ') || '—',
      calibre: calibre || '—',
      serial: serial || '—',
      expiry: expiry ? saDate(expiry) : '—',
      type: (answers[`existing_firearm_${i}_type`] ?? '').trim() || '—',
      section: heldSection(answers, i),
      status: heldStatus(answers, i),
    });
  }
  return out;
}

/**
 * "CZ 6.35mm Browning, serial 81815" — the firearm, named once.
 *
 * ⚠️ MAKE, MODEL, CALIBRE AND SERIAL, IN THAT ORDER. It was make + TYPE +
 * serial, so the PAJA letter read "for CZ Handgun, serial 81815" — a firearm
 * identified by the word every firearm on the form shares, with the two facts
 * that actually distinguish it (the model and the cartridge) missing. A request
 * to the Registrar that cannot name the firearm it is about is a request about
 * a category.
 *
 * ⚠️ AND A FIELD THE CARD PRINTS AS "NONE" STAYS OUT OF THE LINE. The make and
 * model are joined for prose; "CZ NONE" is a licence card's placeholder read
 * aloud, not a model name. The 271 and the cover still print NONE verbatim —
 * this is only the running sentence, where the word is noise.
 *
 * Extracted because three surfaces need the identical string and were about
 * to hold three copies of it: the running footer of every page, the cover's
 * identification block, and the opening sentence of the prior-notice request.
 * A footer and a request that name the firearm differently is the kind of
 * inconsistency a reviewer notices and nobody testing would.
 */
function firearmLine(answers: Record<string, string>): string | undefined {
  const clean = (v: string | undefined) =>
    /^(none|n\/?a|-+)$/i.test((v ?? '').trim()) ? '' : (v ?? '').trim();
  const makeModel = [clean(answers.firearm_make), clean(answers.firearm_model)]
    .filter(Boolean)
    .join(' ');
  const calibre = displayCalibre(clean(answers.firearm_calibre));
  const base = [
    makeModel,
    // ⚠️ NOT TWICE. "Browning" is both a model and part of the calibre's name
    // ("6.35mm Browning"); a line reading "CZ Browning 6.35mm Browning" is the
    // same fact said twice.
    calibre && !makeModel.toLowerCase().includes(calibre.toLowerCase())
      ? calibre
      : '',
  ]
    .filter(Boolean)
    .join(' ');
  if (!base) {
    // No make and no calibre is still not nothing: a serial with no firearm
    // named is better than dropping the identification entirely.
    const onlySerial = clean(answers.firearm_serial);
    return onlySerial ? `firearm, serial ${onlySerial}` : undefined;
  }
  const serial = clean(answers.firearm_serial);
  return serial ? `${base}, serial ${serial}` : base;
}

/**
 * The cartridge feature, out of the research the writer was already given.
 *
 * ⚠️ NO SECOND MODEL CALL, AND THERE MUST NOT BE ONE. This runs in the
 * DOWNLOAD path, where an outbound request sits inside our sixty-second nginx
 * ceiling on a request the applicant is waiting on - the same rule that keeps
 * the cover photograph out of here. The block is already on the row.
 *
 * ⚠️ AND IT IS ABOUT THE CARTRIDGE, NEVER THE APPLICANT. That is what makes
 * it safe to print prose we did not have a person check: it carries no claim
 * about who they are or what they have done. It has also been through the
 * same scrub as everything the writer sees, so it cannot carry vocabulary the
 * document itself would be refused for.
 */
function cartridgeArticle(
  researchEncrypted: string | null,
  title: string | undefined,
): { title: string; paragraphs: string[] } | undefined {
  if (!researchEncrypted || !title) return undefined;
  const block = tryDecryptText(researchEncrypted);
  if (!block) return undefined;
  const section = sectionOf(withoutRefusedCopy(block), BLOCK_LABELS.calibre);
  if (!section) return undefined;
  const paragraphs = section
    .split(String.fromCharCode(10))
    .map((l) => l.trim())
    .filter(Boolean);
  /**
   * ⚠️ A THIN BRIEF IS NOT WORTH A FEATURE. Two lines under a drawing reads
   * as a page that ran out of things to say, which is worse for the
   * application than the drawing standing alone.
   *
   * ⚠️ BUT ONE FULL PARAGRAPH IS. The old floor counted LINES, so a grounded
   * answer delivered as a single 350-word block was discarded and 5.2 fell
   * back to generic exhibit captions (MO000099). The floor is now the word
   * count; the page sets the block as prose if it has no line breaks.
   */
  const words = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
  return words >= 60 ? { title, paragraphs } : undefined;
}

/**
 * The display line under the cover's cartridge hero.
 *
 * Operator, 2026-09-09: "the Firearm manufacturer and caliber as a nice
 * biggish readable subscript for it."
 *
 * ⚠️ THE MAKE AND THE CALIBRE, AND NOT THE REST OF THE LINE ABOVE. It is a
 * label on a picture, not a second identification block: the model, the
 * action and the serial are rows in the particulars grid further down the same
 * page, where a DFO transcribes them onto the 271 one at a time.
 *
 * ⚠️ AND THE CALIBRE IS NORMALISED WITH `displayCalibre`, THE SAME AS EVERY
 * OTHER SURFACE OF THE PACK. The drawing is of "6,5 Creedmoor" because that is
 * what the figures were found under; the card says "6.5MM CREEDMOOR". Printing
 * the card's raw shouting on the cover while the particulars grid below — and
 * the body, and the battery table — set the tidied form would read as a
 * discrepancy on the first page the DFO sees.
 */
function heroSubtitle(answers: Record<string, string>): string | undefined {
  const make = (answers.firearm_make ?? '').trim();
  const calibre = displayCalibre(answers.firearm_calibre);
  if (!calibre) return undefined;
  return make ? `${make} · ${calibre}` : calibre;
}

/**
 * The cover's particulars table, in the book's own order.
 *
 * MOTIVATION-GUIDE-BOOK Part 7.2: "a particulars table (Applicant, Identity
 * number, Firearm type and action, Make, Model, Calibre, Serial number(s),
 * Section applied under, Date). … Nothing else."
 *
 * ⚠️ ROWS, NOT ONE COMBINED LINE, AND THAT IS THE POINT OF THE TABLE. A DFO
 * transcribing onto the SAPS 271 copies these one field at a time; a single
 * "Howa 1500 bolt-action rifle, serial B742119" makes them parse a sentence to
 * find the model. The combined line survives for the footer and the PAJA
 * letter, where it is prose.
 *
 * ⚠️ AN ABSENT FIELD DROPS ITS ROW RATHER THAN PRINTING A DASH. A blank
 * against "Serial number" on the cover of a licence application reads as a
 * firearm with no serial.
 *
 * ⚠️ AND A FIELD THE CARD PRINTS AS "NONE" PRINTS AS "NONE". Operator,
 * 2026-09-20: "When a NONE value is read from a license disk, it must display
 * NONE. It may never be altered or thrown away. It is how it was captured by
 * SAPS and they expect it should stay like that." The row is the card's own
 * value, not our house style.
 */
function coverParticulars(
  answers: Record<string, string>,
  licenceTypeLabel: string,
  generatedAt: Date,
): [string, string][] {
  const v = (k: string) => (answers[k] ?? '').trim();
  /**
   * ⚠️ THE ACTION IS NOT A CHOICE LABEL ON PAPER. "Semi-automatic
   * (self-loading)" on the cover's identification row reads as two different
   * things listed under one heading; the SAPS 271's own word is what the row
   * should say. See displayAction.
   */
  const typeAndAction = [v('firearm_type'), displayAction(v('firearm_action'))]
    .filter(Boolean)
    .join(', ');
  const rows: [string, string][] = [];
  const push = (label: string, value: string) => {
    if (value) rows.push([label, value]);
  };
  push('Firearm type and action', typeAndAction);
  push('Make', v('firearm_make'));
  push('Model', v('firearm_model'));
  // ⚠️ THE SAME TIDIED STRING THE BODY USES. The card stores ".45-70
  // GOVERNMENT"; the prose and the cartridge heading both say ".45-70
  // Government". A cover reading one way and a body the other is the
  // inconsistency this closes. (The consent annexure is a copy of the licence
  // and keeps the card's own string verbatim.)
  push('Calibre', displayCalibre(v('firearm_calibre')));
  push('Serial number', v('firearm_serial'));
  push('Section applied under', licenceTypeLabel);
  push(
    'Date',
    generatedAt.toLocaleDateString('en-ZA', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }),
  );
  return rows;
}
/**
 * Heading -> subject mark, read off the stored structure plan.
 *
 * ⚠️ NOTHING IS INVENTED WHEN THE PLAN IS MISSING. Motivations written before
 * plans were stored, and any row whose JSON does not parse, simply get no
 * marks — the document renders exactly as it does today. Guessing a mark from
 * the heading text would put a trophy beside a self-defence section the first
 * time somebody's wording happened to contain the word "hunt".
 */
function sectionMarksFor(
  plan: unknown,
  firearmType?: string,
): Record<string, MarkName> | undefined {
  const sections = (plan as { sections?: { id?: string; heading?: string }[] })
    ?.sections;
  if (!Array.isArray(sections)) return undefined;

  const out: Record<string, MarkName> = {};
  for (const s of sections) {
    if (!s?.id || !s?.heading) continue;
    const mark = markForSection(s.id as SectionId, firearmType);
    if (!mark) continue;
    // The renderer uppercases and strips a trailing colon before it draws.
    out[s.heading.replace(/:\s*$/, '').toUpperCase()] = mark;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * The heading of the battery section, as the renderer will print it.
 *
 * ⚠️ THE TABLE BELONGS UNDER THE ARGUMENT IT IS EVIDENCE FOR. It printed as a
 * section of its own AFTER the summary and before the signature, which is
 * where a reviewer has already stopped reading — while the section three pages
 * earlier discussed the same firearms in prose with nothing to check them
 * against.
 *
 * ⚠️ READ OFF THE PLAN, NOT ASSUMED, EVEN THOUGH THE HEADINGS ARE FIXED NOW.
 * The section is dropped entirely on a first application, and rows written
 * before the fixed skeleton carry the old `comparison` id and its wording — so
 * both ids are looked for, and a row with neither simply gets no table rather
 * than one under a heading that is not there.
 */
function batteryHeadingOf(plan: unknown): string | undefined {
  return headingOf(plan, 'held_firearms') ?? headingOf(plan, 'comparison');
}

/**
 * The printed heading of one section of the stored plan.
 *
 * ⚠️ READ OFF THE PLAN, NEVER MATCHED ON WORDS. The wording is fixed today,
 * but a section is dropped when the applicant's facts do not carry it, and
 * rows written before the fixed skeleton carry their own picked-by-seed
 * alternates — so a regex over "already hold" or "risk" would find nothing on
 * an old document and something on a new one that has no such section.
 */
function headingOf(plan: unknown, id: string): string | undefined {
  const sections = (plan as { sections?: { id?: string; heading?: string }[] })
    ?.sections;
  if (!Array.isArray(sections)) return undefined;
  const hit = sections.find((s) => s?.id === id && s?.heading);
  return hit?.heading?.replace(/:\s*$/, '').toUpperCase();
}

/**
 * The plan's purpose heading — heading 3, whichever of the four ids the plan
 * chose (the_threat, the_quarry, the_discipline).
 *
 * ⚠️ READ OFF THE PLAN, NEVER MATCHED ON WORDS. The three ids share number 3
 * but not wording, and the renderer places the purpose exhibits when this
 * heading's section ends — the same rule `exposureHeading` and `batteryHeading`
 * already follow.
 */
function purposeHeadingOf(plan: unknown): string | undefined {
  return (
    headingOf(plan, 'the_threat') ??
    headingOf(plan, 'the_quarry') ??
    headingOf(plan, 'the_discipline')
  );
}

@Injectable()
export class MotivationRenderService {
  private readonly logger = new Logger(MotivationRenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: MotivationQuotaService,
    private readonly files: SecureFileStorageService,
    private readonly pdf: MotivationPdfService,
    private readonly settings: SettingsService,
    private readonly cip: CipSheetService,
    private readonly saps271: Saps271Service,
    private readonly sellerConsent: MotivationSellerConsentService,
    private readonly firearmImages: FirearmImageService,
    private readonly witnesses: MotivationWitnessService,
    private readonly shared: MotivationSharedService,
    private readonly news: NewsService,
    private readonly crimeStats: CrimeStatsService,
    // ⚠️ RETIRED 2026-10-15 — no longer read. Kept so callers/specs that build
    // this service positionally are untouched; the quarry line-up is gone.
    private readonly quarry: QuarryPlateService,
    // The purpose exhibits under heading 3 — read here, drawn at generation.
    private readonly plates: MotivationPlatesService,
    private readonly pageRaster: DocumentPageRasterService,
  ) {}

  /**
   * Render the PDF. Nothing is stored — it is rebuilt from the encrypted text
   * on every download, so erasure has no assets to chase and a lost file is
   * impossible.
   */
  /**
   * Decrypt every upload that can be reprinted into the pack, in annexure
   * order, and name the ones that cannot.
   *
   * ⚠️ ONE MEMBER'S OWN DOCUMENTS, ALREADY OWNERSHIP-CHECKED. The rows are
   * handed in from the motivation's own `findFirst`, which is scoped by
   * userId — this must never be called with rows fetched any other way.
   *
   * ⚠️ IT NEVER THROWS. A pack is worth printing without one copy in it; it
   * is not worth failing to print at all. Every failure — purged, unreadable
   * on disk, a format pdfkit cannot take, a header we cannot measure — comes
   * back as a named line on the index telling the applicant to bring that one
   * themselves.
   */
  /**
   * ⚠️ THE LETTERING IS PASSED IN, NOT RECOMPUTED. This method used to call
   * buildAnnexures itself, with the uploads only — while renderPdf called it
   * again WITH the generated prior-notice request. Two lists, two different
   * letterings, and the copies came out disagreeing with the index they are
   * indexed by: the pack's index said "Annexure F — Existing firearm
   * licence(s)" while the licence pages themselves were captioned
   * "Annexure E", because the copies' lettering never reserved a letter for
   * the document we generate.
   *
   * An annexure index that does not match its own annexures is worse than no
   * index. One list, computed once, handed to both.
   */
  private async annexureImages(
    uploads: {
      id: string;
      kind: MotivationUploadKind;
      storageKey: string | null;
      mimeType: string | null;
      purgedAt: Date | null;
      /** Plaintext hash — the key a PDF's cached page images are filed under. */
      sha256?: string;
      sourceCredentialId?: string | null;
      sourceCredential?: {
        otherSideId: string | null;
        detailsEncrypted: string | null;
      } | null;
      /**
       * ⚠️ THE CONTAINER, AND THE ONLY WAY AN EVIDENCE UPLOAD FINDS ITS LETTER.
       * Every evidence copy shares the kind EVIDENCE, so the kind-keyed map has
       * nothing to tell two of them apart; the container id does. Null on
       * everything that is not evidence.
       */
      evidenceType?: string | null;
    }[],
    annexures: AnnexureEntry[],
  ): Promise<{
    images: AnnexureImagePage[];
    notPrinted: { letter: string; label: string; why: string }[];
    /**
     * ⚠️ ALWAYS EMPTY NOW, AND KEPT ONLY AS A SEAM. PDF annexures used to be
     * handed to pdf-lib to splice into the finished pack; they are rasterised
     * to page images instead, so every annexure is one document type and the
     * planner, the captions and the letter order apply to all of them. The
     * merge machinery is still here for the C.I.P. datasheet, which is body
     * content rather than an annexure — see motivation-pdf-merge.ts.
     */
    pdfs: {
      letter: string;
      label: string;
      index: number;
      total: number;
      bytes: Buffer;
    }[];
  }> {
    // ⚠️ RESOLVED THROUGH annexureByKind, WHICH KNOWS ABOUT THE GROUPS. A
    // map built straight off the entry list is keyed by each group's
    // REPRESENTATIVE kind, so an ajar-safe photograph or a good-standing
    // letter finds nothing and prints "Annexure ?" with the raw enum name as
    // its caption. That shipped.
    const byKind = annexureByKind(annexures);
    /**
     * ⚠️ EVIDENCE RESOLVES BY CONTAINER, NOT BY KIND. Every evidence copy
     * shares the kind EVIDENCE, so annexureByKind has nothing to tell two of
     * them apart and one letter would capture both. The container id — the
     * value of `evidenceType` — is the key. Evidence with no entry here is a
     * body-placed or unplaced item: it prints on the Activities page, not as
     * an annexure, and is skipped below.
     */
    const byContainer = annexureByContainer(annexures);
    // How many printed pages share each letter's document, so a caption can
    // say "1 of 2". Keyed by a bucket rather than by kind, because two
    // evidence containers are two documents under one kind.
    const seen = new Map<string, number>();
    let safePrinted = 0;

    const images: AnnexureImagePage[] = [];
    const notPrinted: { letter: string; label: string; why: string }[] = [];
    const pdfs: {
      letter: string;
      label: string;
      index: number;
      total: number;
      bytes: Buffer;
    }[] = [];

    const proficiencyGroup = (u: (typeof uploads)[number]) =>
      [u.sourceCredentialId ?? u.id, u.sourceCredential?.otherSideId]
        .filter((id): id is string => !!id)
        .sort()[0];
    const groupRole = new Map<string, number>();
    for (const upload of uploads) {
      if (upload.kind !== MotivationUploadKind.PROFICIENCY_CERTIFICATE)
        continue;
      let text = '';
      try {
        text = upload.sourceCredential?.detailsEncrypted
          ? JSON.stringify(
              decryptJson<Record<string, unknown>>(
                upload.sourceCredential.detailsEncrypted,
              ),
            ).toLowerCase()
          : '';
      } catch {
        // Unknown credential text remains in stable upload order.
      }
      const group = proficiencyGroup(upload);
      if (/(1196\d{2}|11965\d)/.test(text)) groupRole.set(group, 0);
      else if (!groupRole.has(group)) groupRole.set(group, 1);
    }

    /**
     * ⚠️ LETTER ORDER FIRST, THEN THE PROFICIENCY'S OWN ORDER. The copies must
     * print in the sequence the index letters them — a DFO reads the list and
     * turns to the pages in that order, and a pack whose pages run C, A, B, D
     * is a pack they have to hunt through. The proficiency needs a SECOND sort
     * inside its single letter (certificate, its statement of results
     * immediately behind it, then the Act standard), which is what the rest of
     * this comparator does. An earlier version hoisted every proficiency upload
     * to the front of the whole pack instead, which printed the rifle pages
     * before the applicant's identity document.
     */
    const letterRank = new Map(
      annexures.map((entry, index) => [entry.letter, index]),
    );
    const rankOf = (u: (typeof uploads)[number]) => {
      const entry =
        u.kind === MotivationUploadKind.EVIDENCE && u.evidenceType
          ? byContainer.get(u.evidenceType)
          : byKind.get(u.kind);
      const letter = entry?.letter;
      if (letter === undefined) return Number.MAX_SAFE_INTEGER;
      return letterRank.get(letter) ?? Number.MAX_SAFE_INTEGER;
    };

    const orderedUploads = [...uploads].sort((a, b) => {
      const rankDiff = rankOf(a) - rankOf(b);
      if (rankDiff) return rankDiff;
      const proficiency = (u: typeof a) =>
        u.kind === MotivationUploadKind.PROFICIENCY_CERTIFICATE;
      if (!proficiency(a) || !proficiency(b)) return 0;
      const aGroup = proficiencyGroup(a);
      const bGroup = proficiencyGroup(b);
      const roleDiff =
        (groupRole.get(aGroup) ?? 1) - (groupRole.get(bGroup) ?? 1);
      if (roleDiff) return roleDiff;
      if (aGroup !== bGroup) return aGroup.localeCompare(bGroup);
      const side = (u: typeof a) => {
        try {
          const details = u.sourceCredential?.detailsEncrypted
            ? decryptJson<Record<string, unknown>>(
                u.sourceCredential.detailsEncrypted,
              )
            : undefined;
          return details?.document_side === 'front'
            ? 0
            : details?.document_side === 'back'
              ? 1
              : 2;
        } catch {
          return 2;
        }
      };
      return side(a) - side(b);
    });

    /**
     * ⚠️ TWO PASSES, BECAUSE ONE UPLOAD IS NO LONGER ONE PAGE. A photographed
     * licence is a single picture; the same document uploaded as a PDF is one
     * image per page. The "(2 of 4)" caption counts PRINTED PAGES under the
     * letter, so the total cannot be known until every upload has been resolved
     * — a first pass turns each upload into its pages, a second numbers them.
     */
    interface Resolved {
      kind: MotivationUploadKind;
      /**
       * The caption's page-counter bucket. Kind for every ordinary document;
       * the container for evidence, because all evidence shares one kind and
       * each container is a different document.
       */
      bucket: string;
      letter: string;
      label: string;
      safe: boolean;
      /** An evidence annexure: takes its own letter AND its own full page. */
      solo: boolean;
      /** A licence-card copy: three to a sheet. See AnnexureImagePage.threeUp. */
      threeUp: boolean;
      certification: AnnexureEntry['certification'];
      pages: { bytes: Buffer; width: number; height: number }[];
    }
    const resolved: Resolved[] = [];

    for (const u of orderedUploads) {
      // The consent form already contains both sides of the current owner's
      // licence. Keep the vault row, but never duplicate it as an annexure.
      if (u.kind === MotivationUploadKind.SELLER_LICENCE) continue;
      /**
       * ⚠️ A BODY-PLACED OR UNPLACED EVIDENCE COPY PRINTS ELSEWHERE. It takes
       * no annexure letter, so it is skipped here rather than landing under
       * "Annexure ?" with the raw kind for a caption.
       */
      const evidenceEntry =
        u.kind === MotivationUploadKind.EVIDENCE && u.evidenceType
          ? byContainer.get(u.evidenceType)
          : undefined;
      if (u.kind === MotivationUploadKind.EVIDENCE && !evidenceEntry) continue;
      const entry = evidenceEntry ?? byKind.get(u.kind);
      const bucket = evidenceEntry ? `EVIDENCE:${u.evidenceType}` : u.kind;
      const letter = entry?.letter ?? '?';
      const label = entry?.label ?? UPLOAD_KIND_LABELS[u.kind] ?? u.kind;
      if (isSafeAnnexureKind(u.kind) && safePrinted >= 4) {
        notPrinted.push({
          letter,
          label,
          why: 'maximum of four safe photographs printed',
        });
        continue;
      }

      if (!u.storageKey || u.purgedAt) {
        notPrinted.push({ letter, label, why: 'no longer stored' });
        continue;
      }
      // ⚠️ A PDF IS NO LONGER A REASON TO LEAVE A DOCUMENT OUT, AND NO LONGER
      // A SECOND DOCUMENT TYPE EITHER. pdfkit cannot place a PDF page, so these
      // are rasterised to images and go through the same planner as a
      // photograph — see document-page-raster.service.ts. Read the bytes first,
      // because every path needs them.
      const isPdf = (u.mimeType ?? '') === 'application/pdf';
      if (!isPdf && !isEmbeddable(u.mimeType ?? '')) {
        notPrinted.push({ letter, label, why: 'not a JPG, PNG or PDF' });
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = await this.files.read(u.storageKey);
      } catch {
        notPrinted.push({ letter, label, why: 'we could not read it back' });
        continue;
      }

      let pages: { bytes: Buffer; width: number; height: number }[];
      if (isPdf) {
        const rastered = await this.pageRaster.pagesFor({
          bytes,
          sha256: u.sha256 ?? '',
        });
        if (!rastered.length) {
          // ⚠️ NOT "NOT A PDF" — WE COULD NOT RENDER IT. The rasteriser fails
          // closed (a corrupt file, a crash in the helper, a cache miss it
          // could not fill), and the applicant is told to bring that one
          // themselves rather than the pack losing it silently.
          notPrinted.push({ letter, label, why: 'we could not reprint it' });
          continue;
        }
        pages = rastered.map((p) => ({
          bytes: p.bytes,
          width: p.width,
          height: p.height,
        }));
      } else {
        const size = imageSize(bytes);
        if (!size) {
          // Measuring is not optional: the alternative is guessing an aspect
          // ratio and printing somebody's licence stretched.
          notPrinted.push({ letter, label, why: 'we could not measure it' });
          continue;
        }
        pages = [{ bytes, ...size }];
      }

      resolved.push({
        kind: u.kind,
        bucket,
        letter,
        label,
        safe: isSafeAnnexureKind(u.kind),
        // ⚠️ EVIDENCE ONLY. An evidence annexure is a printed document that is
        // reprinting its own possession, so it gets a whole sheet; an ordinary
        // copy keeps the pack-as-many-as-fit rule.
        solo: !!evidenceEntry,
        // ⚠️ KEYED OFF THE KIND, NEVER THE LABEL. A licence card is small and
        // uncertified, so three pack a sheet with nothing a commissioner needs.
        // Operator, 2026-10-15: "we can fit 3 licenses per page." See the same
        // warning on `safe` above for why the label is not consulted.
        threeUp: u.kind === MotivationUploadKind.CURRENT_LICENCE,
        certification: entry?.certification ?? 'none',
        pages,
      });
      if (isSafeAnnexureKind(u.kind)) safePrinted++;
    }

    // The caption's "(n of m)": m is every PRINTED page under the letter, n is
    // this page's place in that run.
    const pageTotals = new Map<string, number>();
    for (const r of resolved) {
      pageTotals.set(
        r.bucket,
        (pageTotals.get(r.bucket) ?? 0) + r.pages.length,
      );
    }
    for (const r of resolved) {
      const total = pageTotals.get(r.bucket) ?? r.pages.length;
      for (const page of r.pages) {
        const index = (seen.get(r.bucket) ?? 0) + 1;
        seen.set(r.bucket, index);
        images.push({
          letter: r.letter,
          label: r.label,
          index,
          total,
          bytes: page.bytes,
          width: page.width,
          height: page.height,
          certification: r.certification,
          safe: r.safe,
          threeUp: r.threeUp,
        });
      }
    }

    return { images, notPrinted, pdfs };
  }

  /**
   * Split this pack's evidence into what is lettered and what prints in the
   * body.
   *
   * ⚠️ THE CONTAINER DECIDES, NOT THE MEMBER. A printed document — a permission
   * letter, an affidavit, a score sheet — is a reprint of possession and takes
   * its own annexure letter and page (`placement: 'annexure'`). An activity
   * photograph is argument and prints on the one "My Activities / Evidence"
   * page with no letter at all. An item with no container, or a retired one,
   * is neither and is left out: `evidenceType === null` is "we could not
   * decide", and printing nothing beats a page titled from a wrong guess.
   *
   * ⚠️ BOTH HALVES ARE CAPPED AGAIN HERE, DEFENSIVELY. The add path enforces
   * two annexures and four photographs, but the ledger is a live table: a row
   * brought in by an older route or a direct write must not push a third
   * letter into the pack or a fifth picture onto a page sized for four.
   */
  private evidenceForRender(
    uploads: EvidenceUploadForRender[],
    selectedIds?: readonly string[] | null,
  ): {
    annexures: EvidenceAnnexure[];
    bodyUploads: EvidenceUploadForRender[];
  } {
    const annexures: EvidenceAnnexure[] = [];
    const bodyUploads: EvidenceUploadForRender[] = [];

    /**
     * ⚠️ THE CURATOR'S FOUR, IN ITS ORDER. A persisted selection is a decision
     * for THIS pack; an id that has since been removed simply drops out. No
     * selection at all (an older row) keeps the previous first-four fallback.
     */
    const ordered = selectedIds
      ? selectedIds
          .map((id) => uploads.find((u) => u.id === id))
          .filter((u): u is EvidenceUploadForRender => !!u)
      : uploads;

    for (const u of ordered) {
      if (u.kind === MotivationUploadKind.EVIDENCE) {
        const known = u.evidenceType ? containerById(u.evidenceType) : null;
        if (!known) continue;
        if (bodyUploads.length < EVIDENCE_BODY_MAX) bodyUploads.push(u);
        continue;
      }
      /**
       * ⚠️ OPTIONAL DOCUMENTS ARE BODY EVIDENCE TOO (2026-10-28). An activity
       * log, incident report, character reference, employment letter or
       * previous motivation is not DFO/CFR paperwork, so it prints with the
       * applicant's evidence and takes no annexure letter.
       */
      if (
        BODY_DOCUMENT_KINDS.has(u.kind) &&
        bodyUploads.length < EVIDENCE_BODY_MAX
      ) {
        bodyUploads.push(u);
      }
    }
    return { annexures, bodyUploads };
  }

  /**
   * The member's own evidence, as one page of pictures in the body.
   *
   * ⚠️ READ AT RENDER TIME, NEVER STORED — the same rule as the press
   * clippings: the pack is rebuilt from source on every download, so a picture
   * that fails to read back costs that one picture, never the page or the
   * pack. A photograph whose bytes are gone simply does not appear; there is
   * no placeholder box, because a box would assert a picture the member cannot
   * point a DFO at.
   *
   * `undefined` when there is nothing to print, so the caller passes the
   * result straight through without a second empty check.
   */
  private async buildEvidenceBody(
    uploads: EvidenceUploadForRender[],
  ): Promise<EvidencePage[] | undefined> {
    if (!uploads.length) return undefined;

    const pages: EvidencePage[] = [];
    for (let i = 0; i < uploads.length; i++) {
      const u = uploads[i];
      if (!u.storageKey || u.purgedAt) continue;
      let bytes: Buffer;
      try {
        bytes = await this.files.read(u.storageKey);
      } catch {
        continue;
      }
      /**
       * ⚠️ A PRINTED BODY DOCUMENT IS RASTERISED TO ITS FIRST PAGE. The
       * Activities / Evidence page is a 2x2 picture block; a PDF has no image
       * bytes of its own, so its first page is rendered into one cell. A
       * document that cannot be rasterised is skipped, never a placeholder.
       */
      let size = imageSize(bytes);
      if (!size) {
        if ((u.mimeType ?? '') !== 'application/pdf' || !u.sha256) continue;
        const rastered = await this.pageRaster.pagesFor({
          bytes,
          sha256: u.sha256,
        });
        const first = rastered[0];
        if (!first) continue;
        bytes = first.bytes;
        size = { width: first.width, height: first.height };
      }
      const container = u.evidenceType ? containerById(u.evidenceType) : null;
      pages.push({
        index: pages.length + 1,
        total: uploads.length,
        label: container?.label ?? documentLabel(u.kind),
        description: tryDecryptText(u.evidenceDescriptionEncrypted ?? null),
        image: { bytes, ...size },
      });
    }
    if (!pages.length) return undefined;
    // The total is what actually printed, not what was offered.
    for (const p of pages) p.total = pages.length;
    return pages;
  }

  /**
   * Turn the chosen incidents into printable pages, fetching each picture at
   * RENDER time — never stored, per the pack-rendering rule that a pack is
   * rebuilt from source on every download. A picture fetch failing costs
   * that one clipping its picture, never the clipping or the pack: see
   * PressClippingPage.image and the "no picture, no placeholder box" rule.
   *
   * `undefined` when there is nothing to print, so the caller can pass the
   * result straight through without an extra empty-array check.
   */
  private async buildPressClippings(
    incidents: NewsIncident[],
  ): Promise<PressClippingPage[] | undefined> {
    if (!incidents.length) return undefined;

    const pages: PressClippingPage[] = [];
    for (let i = 0; i < incidents.length; i++) {
      const incident = incidents[i];
      let image: PressClippingPage['image'];
      try {
        const fetched = await this.news.clippingImage(incident);
        if (fetched) {
          image = {
            bytes: Buffer.from(fetched.data, 'base64'),
            width: fetched.width,
            height: fetched.height,
          };
        }
      } catch (err) {
        this.logger.warn(
          `Press clipping ${incident.id}: picture fetch failed — ${(err as Error).message}`,
        );
      }
      pages.push({
        index: i + 1,
        total: incidents.length,
        sourceName: incident.sourceName,
        publishedOn: incident.publishedOn,
        headline: incident.headline,
        standfirst: incident.standfirst,
        url: incident.url,
        image,
      });
    }
    return pages;
  }

  /**
   * One page: this applicant's own cover, in a layout and colourway they are
   * trying on. Nothing is saved and nothing is generated.
   *
   * Operator, 2026-09-10: "Can we give them mock ups of each template which
   * costs nothing and generate the motivation from there on?"
   *
   * ⚠️ IT IS THE REAL RENDERER, NOT A MOCK, AND THAT IS THE WHOLE POINT.
   * The expensive half of a motivation is the PROSE — `motivation.generate` is
   * a model call. Rendering is a pure function over figures we already hold, so
   * a genuine cover costs nothing but the milliseconds. The picker this
   * replaces drew its own approximation in the browser, and told members Report
   * was "sans-serif throughout" while every one of their packs came out serif.
   * A drawing of a document can drift from the document; this cannot.
   *
   * ⚠️ AND IT CARRIES THE HERO, because the hero IS the cover now. A sample
   * without it would be honest about the colour and lying about the page.
   *
   * ⚠️ THE BODY IS TWO CANNED LINES AND NEVER THE APPLICANT'S OWN. A draft
   * exists only after generation, most people reach this screen before that,
   * and half a real argument shown as a sample is worse than none. What the
   * sample is FOR is the cover — the masthead, the mark, the tint, the hero and
   * the particulars — and every one of those is genuinely theirs.
   */
  /**
   * The cover alone.
   *
   * ⚠️ THE RENDERER HAS NO ONE-PAGE MODE, AND SHOULD NOT GROW ONE. Asking it
   * to stop after the cover would be a second code path through the thing the
   * sample exists to be honest about - and the first time the two diverged,
   * the sample would be the one nobody checked. So it draws the whole document
   * as it always does and this takes page one off the front.
   */
  private async firstPageOf(pdf: Uint8Array | Buffer): Promise<Buffer> {
    const src = await PDFDocument.load(pdf);
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(src, [0]);
    out.addPage(page);
    return Buffer.from(await out.save());
  }

  async designSample(
    userId: string,
    id: string,
    choice: { layout?: string; colourway?: string },
  ): Promise<Buffer> {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        referenceNumber: true,
        licenceType: true,
        answersEncrypted: true,
        completedAt: true,
        templateColourway: true,
        templateLayout: true,
        researchEncrypted: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const at = row.completedAt ?? new Date();
    const cartridge = await this.cartridgeDrawingFor(
      answers.firearm_calibre,
      heroSubtitle(answers),
      { skipCip: true },
    );

    const { pdf } = await this.pdf.render({
      referenceNumber: row.referenceNumber,
      applicantName: answers.full_name || 'The applicant',
      licenceTypeLabel: LICENCE_TYPE_LABELS[row.licenceType],
      idNumber: answers.id_number?.trim() || undefined,
      firearmLine: firearmLine(answers),
      coverParticulars: coverParticulars(
        answers,
        LICENCE_TYPE_LABELS[row.licenceType],
        at,
      ),
      /**
       * ⚠️ FALLING BACK TO WHAT IS STORED, NOT TO THE DEFAULT. The picker
       * sends one axis at a time — a colour swatch changes the colour and says
       * nothing about the layout — so an absent value means "leave that as it
       * is", never "reset it". asLayout/asScheme then validate.
       */
      layout: asLayout(choice.layout ?? row.templateLayout),
      colourway: asScheme(choice.colourway ?? row.templateColourway),
      body: SAMPLE_BODY,
      disclaimer: DISCLAIMER_TEXT,
      templateVersion: TEMPLATE_VERSION,
      generatedAt: at,
      cartridgeDrawing: cartridge,
      /**
       * ⚠️ THE CARTRIDGE, WRITTEN UP RATHER THAN TABULATED. Operator,
       * 2026-09-10: "We don't need that bunch of dimensions, rather give the
       * history and good facts about the cartridge." The two lengths that
       * matter are called out on the drawing itself, which is where a
       * dimension belongs; a table of nine beside it was the same facts with
       * the picture taken away.
       */
      cartridgeArticle: cartridgeArticle(
        row.researchEncrypted,
        cartridge?.name,
      ),
    });

    return this.firstPageOf(pdf);
  }

  async renderPdf(userId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        userId: true,
        referenceNumber: true,
        licenceType: true,
        status: true,
        documentTextEncrypted: true,
        templateVersion: true,
        answersEncrypted: true,
        completedAt: true,
        templateFormat: true,
        templateColourway: true,
        templateLayout: true,
        researchEncrypted: true,
        suitabilityEncrypted: true,
        evidenceSelectionEncrypted: true,
        structurePlan: true,
        coverPhotoChoice: true,
        coverPhotoKey: true,
        coverPhotoMime: true,
        // The one column that records money, and so the only one the mark
        // reads. betaSeatNo used to be selected beside it; see isPaidFor.
        billedCents: true,
        // ⚠️ ORDERED BY CREATION, and the bytes come with it now. The copies
        // are reprinted into the pack, so a stable order matters: "1 of 2"
        // and "2 of 2" have to mean the same two pages every download.
        uploads: {
          select: {
            id: true,
            kind: true,
            storageKey: true,
            mimeType: true,
            purgedAt: true,
            // The plaintext hash: a PDF's cached page images are filed under
            // it, so one rasterisation serves every copy of the same document.
            sha256: true,
            sourceCredentialId: true,
            sourceCredential: {
              select: { otherSideId: true, detailsEncrypted: true },
            },
            // ⚠️ EVIDENCE'S CONTAINER AND THE MEMBER'S WORDS. The container
            // decides whether a copy takes an annexure letter or prints on the
            // Activities page, and the description is the caption the member
            // wrote for it — encrypted at rest, decrypted for this render only.
            evidenceType: true,
            evidenceDescriptionEncrypted: true,
            // ⚠️ THE SAPS 271 SENTINEL RIDES HERE. A page the member uploaded
            // that is a 271 form is read but never annexed; see buildAnnexures
            // filtering below and SAPS_271_MARKER.
            extractedFields: true,
            /**
             * ⚠️ THE ANNEXURE INDEX NEEDS THE SECOND ROLE, NOT ONLY THE KIND.
             * One membership certificate is both the association card and the
             * section 16 letter of good standing — the vault records the second
             * role in `coversKinds`. The index computes what is still missing
             * from this same set, so without the column the pack printed a
             * "still to be attached" row for a paper the applicant had already
             * given us. Operator, 2026-10-16: "why is it asking for a letter of
             * good standing when the dedicated status is showing that its valid
             * until june 2027?" Every other surface counts the union; the index
             * was the one that did not.
             */
            coversKinds: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    if (
      row.status !== MotivationStatus.COMPLETED ||
      !row.documentTextEncrypted
    ) {
      throw new ConflictException('This document is not ready yet.');
    }

    const body = tryDecryptText(row.documentTextEncrypted);
    if (!body) {
      throw new ConflictException(
        'We could not open this document. Please contact support.',
      );
    }

    /**
     * ⚠️ THE PROFILE UNDERNEATH, THE SAME AS THE 271 AND THE WRITER.
     *
     * The BODY was written from merged answers, but everything this method
     * draws around it was not: the battery table, the cover particulars and
     * the statutory-cap warnings all read `answers` directly. Several of the
     * fields they need are `scope: 'profile'` and live on the member —
     * `existing_firearm_N_section_held` among them, which is what the cap
     * warnings count and what the overlap check reads. Unmerged, a printed
     * pack could show a battery table with no sections in it while the review
     * sheet showed them filled.
     */
    const answers = await this.shared.answersFor(
      row.userId,
      row.answersEncrypted,
    );

    // The annexure index closes the printed document so a reviewer can find
    // anything the body cross-references.
    //
    // THE TICK BOXES stay a live surface on the platform and in the PWA (see
    // checklist() below) — that is the operator's decision and it holds, the
    // pack stays digital until it is printed. But once it IS printed, the
    // paper has to say what goes with it: the applicant walking into the
    // station is holding a pile of documents, not a phone. So the "take these
    // with you" half of the checklist is rendered onto the last page, with
    // boxes to tick with a pen, and the "your pack" half is not — that half is
    // what they are already holding.
    // ⚠️ A SAPS 271 THE MEMBER UPLOADED IS READ, NEVER ANNEXED (2026-10-13).
    // Operator: "271 just extracts the information and adds it where it needs
    // to be. any other document that serves as evidence becomes an annexure."
    // The sentinel rides on extractedFields; the row is dropped from everything
    // that letters or prints, while staying in the database and in the reads.
    const packUploads = (row.uploads ?? []).filter(
      (u) => !(u.extractedFields ?? []).includes(SAPS_271_MARKER),
    );
    const kinds = packUploads.map((u) => u.kind);
    // ⚠️ THE CHECKLIST HAS PROMISED THIS SINCE THE MODULE SHIPPED AND NOTHING
    // PRODUCED IT. "Request for prior notice before refusal (PAJA)" sits under
    // "Your pack", owned by us, ticking itself green the moment the motivation
    // was written — and no code anywhere built the document. Found 2026-08-20.
    //
    // Built here rather than at generation time because it is derived purely
    // from the applicant's own identifying details: no Claude call, no stored
    // text, and it re-renders identically every download. See
    // motivation-prior-notice.ts for why the pack carries it at all.
    const priorNotice = buildPriorNoticeRequest({
      applicantName: answers.full_name || 'The applicant',
      idNumber: answers.id_number?.trim() || undefined,
      referenceNumber: row.referenceNumber,
      licenceTypeLabel: LICENCE_TYPE_LABELS[row.licenceType],
      firearmLine: firearmLine(answers),
    });
    // The SIGNED character witness statements.
    //
    // ⚠️ WHAT EXISTS, AND NOTHING ELSE. This used to build two BLANK forms
    // unconditionally — ruled sheets for the applicant to print and hand out.
    // Operator, 2026-08-21: "Only use the link." A witness completes and signs
    // on their own phone now, so a slot nobody has completed contributes no
    // page at all. A pack that goes to the police contains what was actually
    // said, never a placeholder for what somebody hoped would be.
    const characterStatements = await this.buildWitnessStatements(
      row.id,
      answers.full_name || 'The applicant',
      row.referenceNumber,
      LICENCE_TYPE_LABELS[row.licenceType],
    );
    const sellerConsent = await this.buildSellerConsent(row.id).catch(() => {
      // Never lose the motivation over the consent sheet.
      this.logger.error(`Motivation ${row.id}: seller consent sheet failed`);
      return undefined;
    });

    // ── Press clippings the member chose, self-defence only ──────────
    //
    // ⚠️ FETCHED BEFORE buildAnnexures, NOT AFTER. Whether a PRESS_CLIPPINGS
    // annexure exists at all decides whether it takes a letter, and that has
    // to be known before the SAME lettering call the index and every reprint
    // caption below depend on. See the identical ordering in
    // MotivationGenerationService, which the writer's citation must agree
    // with.
    //
    // ⚠️ FAIL-SOFT. A bad id, an empty answer or NewsService throwing all
    // collapse to "no clippings" — the pack renders exactly as it would have
    // before this feature existed, never a failed download.
    let pressIncidents: NewsIncident[] = [];
    if (isSelfDefence(row.licenceType)) {
      const ids = parsePressClippingIds(answers[PRESS_CLIPPINGS_KEY]);
      if (ids.length) {
        try {
          pressIncidents = await this.news.byIds(ids);
        } catch (err) {
          this.logger.warn(
            `Motivation ${row.id}: press clippings lookup failed — ${(err as Error).message}`,
          );
        }
      }
    }

    // ONE lettering, built once, used by the index AND by the captions on the
    // reprinted copies. See annexureImages.
    /**
     * ⚠️ NOTHING GENERATED TAKES A LETTER ANY MORE. Operator, 2026-09-09:
     * "only paperwork required by the dfo are attached as annexures." An
     * annexure is a copy of a document the applicant possesses; the PAJA
     * request and the press cuttings are neither, so the first is its own
     * lodged page and the second prints inside the exposure section.
     */
    /**
     * ⚠️ THE CONSENT TAKES A LETTER, so it has to be known here rather than
     * discovered later: this same call feeds the index, every "Refer to
     * Annexure X" the writer is given, and the captions on the pages
     * themselves. It is built above, so its presence is already settled.
     */
    /**
     * ⚠️ EVIDENCE IS SPLIT BEFORE THE LETTERING, because the container decides
     * which half of it takes a letter. The annexure-placed items are lettered
     * here with everything else; the body-placed photographs take no letter
     * and are built into the Activities page below. See evidenceForRender.
     */
    /**
     * ⚠️ THE CURATOR'S SELECTION, WHEN THE PACK HAS ONE. An older row has no
     * selection and keeps the first-four fallback. An empty selection means the
     * curator deliberately chose nothing.
     */
    let selectedEvidenceIds: string[] | null = null;
    if (row.evidenceSelectionEncrypted) {
      try {
        const parsed = JSON.parse(
          tryDecryptText(row.evidenceSelectionEncrypted) ?? 'null',
        ) as { selected?: { id?: unknown }[] } | null;
        selectedEvidenceIds = (parsed?.selected ?? [])
          .map((s) => (typeof s.id === 'string' ? s.id : ''))
          .filter(Boolean);
      } catch {
        selectedEvidenceIds = null;
      }
    }
    const evidence = this.evidenceForRender(packUploads, selectedEvidenceIds);
    const annexures = buildAnnexures(
      kinds,
      sellerConsent ? ['SELLER_CONSENT'] : [],
      evidence.annexures,
    );
    /**
     * ⚠️ THE GAP IS PRINTED, NOT SILENT. Operator, 2026-09-20, on MO000002: the
     * letter of good standing is a required section 16 document and the pack
     * simply had no trace of it when the upload was absent. Blocking the pack
     * would contradict the module's "SAPS requires it, we do not refuse to
     * proceed" posture, so the pack states the gap plainly on the annexure
     * index: the applicant sees what to bring, and a DFO sees it was not
     * withheld.
     */
    /**
     * ⚠️ THE UNION, NOT THE KIND ALONE. `kinds` above is what LETTERS the
     * annexures and must stay kind-only (one document, one letter). What is
     * still MISSING is a different question and takes every role a row fills,
     * exactly as the sheet, the documents endpoint and the generation blocker
     * already do — see the note on the `coversKinds` select.
     */
    const coveredKinds = packUploads.flatMap((u) => [
      u.kind,
      ...(u.coversKinds ?? []),
    ]);
    const missingDocuments = documentStatus(
      row.licenceType,
      coveredKinds,
      answers,
    ).missingRequired.map((kind) => documentLabel(kind));
    const printable = await this.annexureImages(packUploads, annexures);
    const pressClippings = await this.buildPressClippings(pressIncidents);
    const evidenceBody = await this.buildEvidenceBody(evidence.bodyUploads);

    /**
     * ⚠️ ONE LOOKUP, TWO PLACES ON THE PAGE. The drawing is the cover's hero
     * and the figures go in the body beside the firearm, and both come off the
     * same matched sheet — built once so a round that matches for one can
     * never fail to match for the other.
     */
    const cartridge = await this.cartridgeDrawingFor(
      answers.firearm_calibre,
      heroSubtitle(answers),
    );

    /**
     * ⚠️ BUILT ONCE AND SHARED — the cartridge text and the C.I.P. inset are
     * both read from this one article.
     *
     * ⚠️ NO QUARRY PHOTOGRAPH (retired 2026-10-15). The composite line-up that
     * used to print across the foot of this page is gone; each animal now has
     * its own picture under heading 3 (motivation-plates.ts). The page keeps
     * its cartridge text.
     */
    const article = cartridgeArticle(row.researchEncrypted, cartridge?.name);
    // A round The Bench does not hold can still have a C.I.P. page. Try the
    // sheet directly so the dimension page is not lost with the drawing.
    const standaloneCip = cartridge
      ? null
      : await this.cipInset((answers.firearm_calibre ?? '').trim());
    const dimensionImage = cartridge?.dimension ?? standaloneCip;

    /**
     * ⚠️ THE 5.2 ARGUMENT WRITTEN FOR THIS APPLICATION. It is stored on the
     * row by generation; a missing or unreadable blob falls back to the
     * research article below, exactly as before.
     */
    let suitabilityArgument: SuitabilityArgument | null = null;
    if (row.suitabilityEncrypted) {
      try {
        const parsed = JSON.parse(
          tryDecryptText(row.suitabilityEncrypted) ?? 'null',
        ) as SuitabilityArgument | null;
        if (parsed?.question && Array.isArray(parsed.groups)) {
          suitabilityArgument = parsed;
        }
      } catch {
        suitabilityArgument = null;
      }
    }

    // The purpose exhibits — a read, on every download, never a model call.
    const storedPlates = await this.plates.storedFor(row.id).catch(() => []);

    return this.pdf.render({
      referenceNumber: row.referenceNumber,
      // The applicant's REAL name — the documented exception to the site-wide
      // username-only rule. A motivation to the Registrar with a username on it
      // is worthless.
      applicantName: answers.full_name || 'The applicant',
      licenceTypeLabel: LICENCE_TYPE_LABELS[row.licenceType],
      body,
      disclaimer: DISCLAIMER_TEXT,
      templateVersion: row.templateVersion ?? TEMPLATE_VERSION,
      // Validated on read: the columns are plain VARCHARs so adding a template
      // costs no migration, which also means they can hold anything. An
      // unrecognised value falls back rather than failing the download.
      format: asFormat(row.templateFormat),
      colourway: asScheme(row.templateColourway),
      layout: asLayout(row.templateLayout),
      // ⚠️ NO WATERMARK. Operator, 2026-10-15: "remove the watermark." The
      // unpaid "NOT FOR USE" mark that used to stamp every un-paid pack is
      // gone from the product; the field is left in place (always false) so no
      // caller can turn it back on by accident, and the renderer no longer
      // draws it.
      watermark: false,
      // Named in the running footer of every page, the way a professional
      // pack does it — a loose sheet has to identify its own application.
      firearmLine: firearmLine(answers),
      generatedAt: row.completedAt ?? new Date(),
      // The cover's particulars table, Part 7.2, one field per row.
      coverParticulars: coverParticulars(
        answers,
        LICENCE_TYPE_LABELS[row.licenceType],
        row.completedAt ?? new Date(),
      ),
      // ⚠️ ON THE COVER BECAUSE THE DFO FILES ON IT. Every professional pack
      // identifies the applicant by ID number on its first page: it is the
      // key the Central Firearms Register runs on, and a folder that carries
      // it cannot be confused with another Gerhard Fourie.
      idNumber: answers.id_number?.trim() || undefined,
      // What they already hold. Section 13(3) caps a self-defence applicant
      // at one firearm and section 15(3) an occasional sport shooter at four,
      // so this is a statutory precondition the DFO checks — set out as a
      // table a reviewer can read at a glance instead of mining it out of a
      // paragraph. Empty is meaningful too: the renderer prints "this is a
      // first application" rather than dropping the section.
      ownedFirearms: existingFirearms(answers),
      annexures,
      // ⚠️ THE GAP IS STATED ON THE INDEX PAGE. See the note where this is
      // built: a required document that is absent is named, so the applicant
      // knows what to bring and the DFO sees it was not withheld.
      missingDocuments,
      priorNotice,
      pressClippings,
      // ⚠️ THE MEMBER'S OWN EVIDENCE, IN THE BODY. Activity photographs are
      // argument rather than annexures, so they print on one page beside the
      // argument they support — the same posture as the press clippings under
      // the exposure section. Lettered evidence is NOT here; it went into the
      // annexure images above.
      evidencePages: evidenceBody,
      // ⚠️ THE FIGURES THE CUTTINGS ARE EXAMPLES OF. The body argues "eleven
      // house robberies in the quarter, and here are three of them", and the
      // annexure carried only the three — so a reviewer checking the claim had
      // nowhere to turn. Empty for a non-S13, for a station we cannot place,
      // or when there are no cuttings to head.
      // ⚠️ KEYED ON THE SELF-DEFENCE QUESTION, NOT ON WHETHER THERE ARE
      // CUTTINGS. The body cites the SAPS quarterly figures on S13 AND S14;
      // gating this on press clippings dropped the table from every S14 pack
      // and from any S13 where the member picked no cuttings.
      precinctTables: isSelfDefence(row.licenceType)
        ? await this.precinctTablesFor(answers)
        : undefined,
      // ⚠️ KEYED ON THE HEADING AS IT IS PRINTED — uppercased, colon stripped —
      // because that is the only string the renderer has when it draws one.
      // See sectionMarks on MotivationPdfInput for why this is built from the
      // stored plan rather than inferred from the words.
      sectionMarks: sectionMarksFor(row.structurePlan, answers.firearm_type),
      // ⚠️ THE BATTERY TABLE GOES UNDER THE COMPARISON HEADING, not after the
      // summary where a reviewer has stopped reading. Undefined on a plan with
      // no comparison section — a first application holds nothing to compare —
      // and the renderer then prints it as its own section as it always did.
      batteryHeading: batteryHeadingOf(row.structurePlan),
      // ⚠️ THE PRECINCT FIGURES AND THE CUTTINGS PRINT UNDER THE EXPOSURE
      // SECTION, at the foot of the paragraphs that cite them. Operator,
      // 2026-09-09: they "must be in the body of the document itself and form
      // part of the flow, it must not be just placed there because it has to
      // be there."
      exposureHeading: headingOf(row.structurePlan, 'the_threat'),
      // ⚠️ THE PURPOSE EXHIBITS PRINT UNDER HEADING 3, at the foot of the
      // paragraphs that argue the purpose. One to two pages of pictures drawn
      // at generation; the heading comes off the plan, never matched on words.
      purposeHeading: purposeHeadingOf(row.structurePlan),
      purposePlates: storedPlates.map((p) => ({
        pageIndex: p.pageIndex,
        plateIndex: p.plateIndex,
        title: p.title,
        description: p.description,
        image: { bytes: p.bytes, width: p.width, height: p.height },
      })),
      // ⚠️ THE SAME WORDS THE EXHIBITS PRINT, so the suitability sheet can
      // still argue the applicant's actual purpose when the calibre research
      // failed or predates the purpose-specific ask.
      purposeNotes: storedPlates.map((p) => `${p.title}: ${p.description}`),
      // ⚠️ THE CARTRIDGE FEATURE FOLLOWS THE FIREARM SECTION. Operator,
      // 2026-09-20: "move THE CARTRIDGE straight after THE FIREARM APPLIED FOR
      // AND WHY IT SUITS THE PURPOSE as they are very relevant to each other".
      // The renderer draws the feature when this heading's section ends; the
      // heading itself comes off the plan, never matched on words.
      firearmHeading: headingOf(row.structurePlan, 'the_firearm'),
      firearmPhoto: await this.coverPhotoForRender(row, answers),
      characterStatements,
      sellerConsent,
      annexureImages: printable.images,
      annexuresNotPrinted: printable.notPrinted,
      // Merged into the finished pack by pdf-lib after pdfkit has drawn the
      // body — these used to be listed as "bring your own copy".
      annexurePdfs: printable.pdfs,
      // ⚠️ THE CARTRIDGE'S OWN DATASHEET, AS BODY CONTENT. Operator,
      // 2026-08-23: "i want to insert the full cartridge page into the
      // motivation. Showing the dimensions and everything on the page" and
      // "it not an annexure. Its part of the motivation itself."
      //
      // Matched on the calibre EXACTLY — see CipSheetService for why fuzzy
      // matching is refused here. No match means no page, which costs nothing;
      // a WRONG datasheet would assert chamber dimensions and a maximum
      // pressure for another cartridge inside a document the applicant signs.
      // ⚠️ THE C.I.P. DATASHEET IS NOW A FULL BODY PAGE, NOT A SPLICE. The
      // renderer places it under its own numbered heading so the running
      // header, footer and page numbers stay with it. See dimensionSheet.
      cipSheet: undefined,
      // ⚠️ AND THE DRAWING, WHICH TAKES PRECEDENCE OVER THAT PAGE. Operator,
      // 2026-09-09: "why arent we pulling in the dimension sheet of the
      // cartridge its using from The Bench?" Both are still built because the
      // spliced page is the fallback when we hold no figures for the round;
      // the renderer prints one or the other, never both.
      cartridgeDrawing: cartridge,
      /**
       * ⚠️ THE FIGURES GO WHERE THE PICTURE NO LONGER IS. The drawing is the
       * cover's hero and carries two lengths; the set a reviewer checks a
       * chambering against belongs beside the prose describing the firearm.
       * Operator, 2026-09-09: "the CIP dimensions should be inside the
       * application where the firearm is described."
       */
      /**
       * ⚠️ THE CARTRIDGE, WRITTEN UP RATHER THAN TABULATED. Operator,
       * 2026-09-10: "We don't need that bunch of dimensions, rather give the
       * history and good facts about the cartridge." The two lengths that
       * matter are called out on the drawing itself, which is where a
       * dimension belongs; a table of nine beside it was the same facts with
       * the picture taken away.
       */
      cartridgeArticle: article,
      /**
       * ⚠️ THE TWO FULL CARTRIDGE SHEETS (2026-10-17). The first is the
       * dimension sheet — the C.I.P. page when we hold one, our own full-width
       * drawing otherwise. The second is why this round suits the applied-for
       * purpose. `cartridgeDrawing` above remains the cover hero.
       */
      dimensionSheet: dimensionImage
        ? {
            label: `The cartridge \u2014 ${
              displayCalibre(answers.firearm_calibre) ||
              cartridge?.name ||
              'this round'
            } \u2014 dimensions`,
            image: dimensionImage,
            specs:
              cartridge && !cartridge.dimensionIsCip
                ? cartridge.specs
                : undefined,
          }
        : undefined,
      suitabilitySheet: suitabilityArgument
        ? {
            label: suitabilityArgument.question,
            lines: suitabilityPageLines(suitabilityArgument),
          }
        : dimensionImage || cartridge
          ? {
              label: `Why ${
                displayCalibre(answers.firearm_calibre) ||
                cartridge?.name ||
                'this cartridge'
              } suits this purpose`,
            }
          : undefined,
      // Which purpose the fallback argues, from the same resolver the exhibits
      // use — a self-defence page, a hunting page and a sport page make
      // different cases even when the cartridge is the same.
      purposeKind: purposeFor(row.licenceType, answers) ?? undefined,
      // The "take these to the police station" half of the checklist, and only
      // that half — the other half is the pack they are already holding.
      // ⚠️ THE APPLICANT'S PAGE, NOT THE REGISTRAR'S. See MotivationPdfInput.
      warnings: applicationWarnings(row.licenceType, answers).map((w) => ({
        authority: w.authority,
        message: w.message,
      })),
      // ⚠️ THE "TAKE THESE WITH YOU" END PAGES ARE GONE. Operator, 2026-10-15:
      // "remove the before you go pages at the end." Not passing `takeWithYou`
      // means the renderer draws neither the worksheet nor its continuation;
      // the annexure-insertion fallback already handles a null anchor.
    });
  }

  /**
   * The cartridge drawn from the figures we hold, or nothing.
   *
   * ⚠️ FAIL-SOFT, like every other supplied fact in this pack. A cartridge we
   * have no sheet for simply arrives without a drawing; the writer's prose
   * still stands, and the rule against recalled ballistics still holds. The
   * absence costs a picture, never the document.
   *
   * ⚠️ RASTERISED HERE, NOT IN THE RENDERER. pdfkit cannot place an SVG, and
   * the density is chosen for PAPER rather than for a screen: the drawing is
   * 166 mm wide, so 300 dpi is a little under two thousand pixels across the
   * column and the leader lines stay hairlines when printed.
   */
  private async cartridgeDrawingFor(
    calibre: string | undefined,
    /**
     * The make-and-calibre line for the cover. Present means the drawing is
     * the pack's hero; absent means it stays a figure in the body.
     */
    heroLine?: string,
    opts: { skipCip?: boolean } = {},
  ): Promise<
    | {
        png: Buffer;
        widthMm: number;
        heightMm: number;
        texts: DrawingText[];
        label: string;
        /** The cartridge's standardised name, for the feature's headline. */
        name: string;
        /**
         * The figures for the feature page's dimensions table, in the order a
         * reader wants them. Built from the same `completeDims` set the drawing
         * cuts its silhouette from, so the table and the callouts can never
         * quote two different measurements of one round. Only letters the sheet
         * printed appear; a stood-in shoulder or groove is omitted.
         */
        specs: { label: string; value: string }[];
        hero?: { subtitle: string };
        /** The full-page dimension image: the C.I.P. sheet or our drawing. */
        dimension: {
          png: Buffer;
          widthMm: number;
          heightMm: number;
          texts: DrawingText[];
        };
        /** True when `dimension` is the C.I.P. page rather than our drawing. */
        dimensionIsCip: boolean;
      }
    | undefined
  > {
    const printed = (calibre ?? '').trim();
    if (!printed) return undefined;
    try {
      const all = await this.prisma.benchCartridge.findMany({
        select: {
          name: true,
          slug: true,
          pmaxBar: true,
          aliases: { select: { printed: true } },
          dims: {
            select: {
              R: true,
              R1: true,
              E: true,
              E1: true,
              P1: true,
              P2: true,
              L1: true,
              L2: true,
              L3: true,
              L6: true,
              H1: true,
              H2: true,
              G1: true,
              pmaxBar: true,
            },
          },
        },
      });
      const hit = findCartridge(all, printed);
      if (!hit?.dims) return undefined;

      const completed = completeDims(hit.dims);
      if (!completed) return undefined;

      const label = {
        name: hit.name,
        pmaxBar: hit.dims.pmaxBar ?? hit.pmaxBar,
      };
      const raster = async (opts: { hero: boolean }) => {
        const d = cartridgeDrawing(completed.dims, label, {
          derived: completed.derived,
          hero: opts.hero,
        });
        return {
          png: await sharp(Buffer.from(d.svg), { density: 300 })
            .flatten({ background: '#ffffff' })
            .png()
            .toBuffer(),
          widthMm: d.widthMm,
          heightMm: d.heightMm,
          texts: d.texts,
        };
      };

      const drawing = await raster({ hero: !!heroLine });

      /**
       * ⚠️ THE DIMENSION SHEET IS THE C.I.P. PAGE WHEN WE HOLD ONE.
       *
       * Operator, 2026-10-17: "the rendered cartridge shows on the first page
       * of the application. Currently it renders the cartridge on the cartridge
       * page inside the application and should be the full page CIP dimension
       * sheet." The sheet is placed FULL WIDTH on its own page, not as a
       * half-column inset. Our own full drawing is the fallback for a round
       * with no C.I.P. page (a wildcat) or a raster that failed.
       *
       * `hit.name` is the canonical spelling the index holds ("9 mm Luger"),
       * which is what `CipSheetService` resolves; the card's spelling is not.
       */
      const cip = opts.skipCip ? null : await this.cipInset(hit.name);
      const dimension =
        cip ?? (heroLine ? await raster({ hero: false }) : drawing);

      const png = drawing.png;

      return {
        png,
        widthMm: drawing.widthMm,
        heightMm: drawing.heightMm,
        texts: drawing.texts,
        /**
         * ⚠️ NO SOURCE IN THE HEADING. This lands in the contents page, and
         * CLAUDE.md's Bench rule is a copyright boundary rather than a style
         * note — the spliced page it replaces was captioned "(C.I.P. data)"
         * and printed straight into the table of contents.
         */
        /**
         * ⚠️ THE HEADING USES THE DOCUMENT'S OWN CALIBRE, NOT THE REFERENCE
         * NAME. It lands in the contents page beside prose that says ".45-70
         * Government", and the reference file files the round as "45-70 Govt."
         * — so the contents read one way and the body another. `displayCalibre`
         * is the same string the writer was handed, so the two agree. Falls
         * back to the reference name only if the applicant's calibre is blank,
         * which cannot happen here.
         */
        label: `The cartridge \u2014 ${displayCalibre(printed) || hit.name}`,
        name: hit.name,
        /**
         * ⚠️ THE TABLE'S FIGURES ARE THE DRAWING'S FIGURES. Both read
         * `completed`, and `cartridgeDimRows` refuses every derived letter, so
         * a cartridge with no shoulder prints no shoulder diameter — the same
         * rule the callouts follow. See motivation-cartridge-drawing.ts.
         */
        specs: cartridgeDimRows(
          completed.dims,
          completed.derived,
          label.pmaxBar,
        ),
        /**
         * ⚠️ THE LABEL IS STILL BUILT ON A HERO PACK. It is the contents-page
         * entry and the fallback heading, and a later change that gives the
         * body its figure back must not have to remember to reinstate it.
         */
        ...(heroLine ? { hero: { subtitle: heroLine } } : {}),
        /** The full-page dimension image: C.I.P. sheet or our own drawing. */
        dimension,
        dimensionIsCip: !!cip,
      };
    } catch (err) {
      this.logger?.warn?.(
        `Cartridge drawing failed for "${printed}": ${(err as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * The SAPS quarterly figures for the precincts this pack cites, as tables.
   *
   * ⚠️ THE HOME STATION AND THE ONES THEY TICKED, IN THAT ORDER, AND NO MORE
   * THAN THREE ALTOGETHER. Twelve stations of quarterly tables is not evidence,
   * it is a spreadsheet — the same finding the fact-pack side already applies
   * to the precincts the writer is given.
   *
   * ⚠️ FAIL-SOFT PER STATION. One precinct we cannot place costs its own table
   * and nothing else; the release name travels on every table, because a
   * figure whose release is not named is a figure a reviewer cannot check.
   */
  private async precinctTablesFor(answers: Record<string, string>): Promise<
    | {
        station: string;
        source: string;
        rows: { category: string; latest: string; trend: string }[];
      }[]
    | undefined
  > {
    const home = (answers.police_station ?? '').trim();
    if (!home) return undefined;
    const province =
      (answers.police_station_province ?? '').trim() || undefined;

    /**
     * ⚠️ THE AREAS THEY TICKED, NOT A RADIUS WE DREW. `travelled_areas` is an
     * answer the member gave — which is exactly what makes another precinct's
     * numbers admissible about THIS applicant. The key is the area name, which
     * is what CrimeStatsService resolves a station from.
     */
    const wanted = [
      home,
      ...parseTravelledAreas(answers[TRAVELLED_AREAS_KEY]).map((a) => a.key),
    ]
      .map((v) => v.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: {
      station: string;
      source: string;
      rows: { category: string; latest: string; trend: string }[];
    }[] = [];

    for (const name of wanted) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (out.length >= 3) break;
      try {
        /**
         * ⚠️ A PROVINCE THAT DOES NOT MATCH MUST NOT COST THE TABLE. The
         * figures were cited in the body from a lookup that resolved, and the
         * render then asks the same question with the same answer — so a table
         * that silently disappears between generation and download is either
         * a changed station answer or a province string that no longer matches
         * the workbook ("Western Cape" against "WC"). The name alone is enough
         * to resolve a station, so a province-filtered miss retries without it
         * rather than printing a page of prose citing figures with no table
         * under them.
         */
        const f =
          (await this.crimeStats.precinct(name, province)) ??
          (province ? await this.crimeStats.precinct(name) : null);
        if (!f) {
          // ⚠️ THE HOME STATION IS THE LOAD-BEARING ONE and the one a reviewer
          // checks against the address; a travelled area the workbook cannot
          // place is the member's tick, not a defect, so it stays quiet.
          if (name === home) {
            this.logger.warn(
              `Precinct table: no SAPS figures for the home station "${name}"${province ? ` in ${province}` : ''} — the pack prints without its table`,
            );
          }
          continue;
        }
        out.push({
          station: `${f.station.name} — ${f.station.district}, ${f.station.province}`,
          source: `SAPS quarterly crime statistics, ${f.release.periodLabel} release`,
          rows: f.categories.map((c) => ({
            category: c.category,
            latest: `${c.latest.count} in ${c.latest.label}`,
            trend:
              c.yearOnYearPct === null
                ? (c.note ?? '—')
                : `${c.yearOnYearPct >= 0 ? 'up' : 'down'} ${Math.abs(
                    c.yearOnYearPct,
                  ).toFixed(0)}% year on year`,
          })),
        });
      } catch (err) {
        this.logger.warn(
          `Precinct table skipped for "${name}": ${(err as Error).message}`,
        );
      }
    }
    return out.length ? out : undefined;
  }

  /**
   * The C.I.P. datasheet for a calibre, or nothing.
   *
   * ⚠️ FAIL-SOFT AND FLAG-GATED. A pack must never fail to render because a
   * reference page could not be found, read or licensed. The flag exists
   * because reproducing C.I.P.'s own typeset page inside a document we sell is
   * republication of somebody else's work, and that question was still open
   * when this shipped — turning it off costs the page and nothing else.
   */
  /**
   * The C.I.P. datasheet for a round, rasterised for the feature's inset.
   *
   * ⚠️ RASTER, BECAUSE THE BODY IS pdfkit AND pdfkit TAKES PNG OR JPEG. At
   * scale 4 an A4 sheet comes back about 2 450 px wide, which set into an
   * 82 mm column is roughly a thousand dots to the inch — crisp in print and
   * still real detail at 400% on screen. Vector through pdf-lib would be
   * smaller and sharper still, but it needs the rectangle and the page index
   * threaded out of pdfkit and back in afterwards; that is the upgrade if the
   * small type ever disappoints, not the first attempt.
   *
   * ⚠️ TRIMMED, BECAUSE `sheetFor` CENTRES US LETTER ONTO A4 and the white
   * bands that leaves are inset height spent on nothing. `trim()` stops at the
   * sheet's own printed border, so what is placed is the frame and its
   * contents and no margin.
   *
   * ⚠️ AND IT NEVER THROWS. Every failure here — no sheet for the round, the
   * data directory absent, a page that will not rasterise — returns undefined
   * and the caller falls back to our own drawing.
   */
  // ⚠️ THE QUARRY PHOTOGRAPH IS RETIRED (2026-10-15). The composite line-up on
  // the cartridge page was replaced by one animal per picture under heading 3;
  // there is nothing to read here any more. quarry-plate.service is left in
  // place but is no longer drawn or shown.

  private async cipInset(
    calibre: string,
  ): Promise<
    | { png: Buffer; widthMm: number; heightMm: number; texts: DrawingText[] }
    | undefined
  > {
    const name = calibre.trim();
    if (!name) return undefined;
    const on = await this.settings.get(FLAGS.cipSheetEnabled).catch(() => true);
    if (!on) return undefined;
    /**
     * ⚠️ THE RAW FILE, NOT THE A4-FITTED COPY. `sheetFor` re-embeds the page
     * as a Form XObject so it can be scaled onto A4; pdf.js cannot rasterise
     * that and threw out of `paintFormXObjectBegin` on every render since the
     * inset shipped. The trim below removes the margins the A4 fitting was for.
     */
    const sheet = await this.cip.rawSheetFor(name).catch(() => null);
    if (!sheet) return undefined;

    /**
     * ⚠️ RASTERISED IN A HELPER PROCESS, BECAUSE IT CAN KILL THE SERVER. See
     * pdf-raster.child.ts: inside a booted Nest process this render has crashed
     * node with an access violation, which no try/catch can see. A crash here
     * now costs one inset — the caller falls back to our own dimension drawing
     * — and never the request process.
     */
    let dir: string | undefined;
    try {
      dir = await mkdtemp(path.join(os.tmpdir(), 'cip-inset-'));
      const inPath = path.join(dir, 'sheet.pdf');
      await writeFile(inPath, sheet.bytes);
      await rasterisePdfToDir(inPath, dir, CIP_INSET_SCALE);

      const raw = await readFile(path.join(dir, 'page-1.png'));
      const png = await sharp(raw).trim().png().toBuffer();
      const { width, height } = await sharp(png).metadata();
      if (!width || !height) return undefined;

      /**
       * Only the ASPECT matters: `placeDrawing` scales to the column width it
       * is given, so these two are a ratio wearing units.
       */
      return {
        png,
        widthMm: 210,
        heightMm: (210 * height) / width,
        // The sheet carries its own labels; ours belong to our own geometry.
        texts: [],
      };
    } catch (err) {
      /**
       * ⚠️ THE STACK, BECAUSE THE MESSAGE ALONE WAS NOT ENOUGH. This failed
       * on every render in production on 2026-09-10 with "Value is none of
       * these types `String`, `Path`," and nothing else — a napi-level type
       * error with no indication of which library raised it. The same call
       * succeeded from a script on the same box, in the same directory, with
       * the same bytes, five at a time. Without a frame there is nothing to
       * work from. A helper that SEGFAULTS reports the same way now — as a
       * non-zero exit with no message — which is why the reason is logged.
       */
      const e = err as Error;
      this.logger?.warn?.(
        `C.I.P. inset failed for "${name}": ${e.message} | ${(e.stack ?? '')
          .split(String.fromCharCode(10))
          .slice(1, 4)
          .map((l) => l.trim())
          .join(' <- ')}`,
      );
      return undefined;
    } finally {
      if (dir)
        await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async cipSheetFor(
    calibre: string | undefined,
  ): Promise<{ bytes: Buffer; label: string } | undefined> {
    const name = (calibre ?? '').trim();
    if (!name) return undefined;
    const on = await this.settings.get(FLAGS.cipSheetEnabled).catch(() => true);
    if (!on) return undefined;
    try {
      const sheet = await this.cip.sheetFor(name);
      if (!sheet) return undefined;
      return {
        bytes: sheet.bytes,
        /**
         * ⚠️ NO SOURCE IN THE HEADING. It lands in the contents page, and
         * CLAUDE.md's Bench rule is a copyright boundary rather than a style
         * note: nothing on any surface built from that corpus names where a
         * figure comes from. This label read "(C.I.P. data)" and printed it
         * straight into the table of contents of a document we sell.
         */
        label: `The cartridge — ${displayCalibre(name) || sheet.name}`,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * The signed statements, ready to print.
   *
   * ⚠️ THE SIGNATURE IS DECRYPTED FOR THIS RENDER AND NOT KEPT. It lives in
   * the encrypted tree like the applicant's own documents — it is a third
   * party's handwriting, given to us on a favour — and it exists in the clear
   * only inside the buffer that becomes the PDF.
   */
  /**
   * The previous owner's signed consent, as a sheet for the pack.
   *
   * ⚠️ THIS DID NOT EXIST, AND THE APPLICANT WAS TOLD IT DID. consentFormFor()
   * has built this sheet since the consent flow shipped and NOTHING EVER
   * CALLED IT — the module had zero callers. Meanwhile the panel on the
   * applicant's screen reads "their signed consent and a copy of their licence
   * are in your pack". Only the licence PHOTOGRAPHS were in the pack, as
   * SELLER_LICENCE annexures. The signed declaration — the document that
   * actually says the owner agrees to the transfer, the one a DFO needs — was
   * never rendered at all.
   *
   * Fail-soft like every other pack input: a consent we cannot read costs its
   * own sheet and nothing else.
   */
  private async buildSellerConsent(motivationId: string) {
    const row = await this.prisma.motivationSellerConsent.findUnique({
      where: { motivationId },
      select: {
        id: true,
        status: true,
        invitedPhone: true,
        answersEncrypted: true,
        firearmSnapshotEncrypted: true,
        signatureKey: true,
        licenceFrontKey: true,
        licenceBackKey: true,
        signedPlace: true,
        signedAt: true,
      },
    });
    if (!row || row.status !== 'COMPLETED') return undefined;

    let answers: Record<string, string> = {};
    let firearm: Record<string, unknown> = {};
    try {
      answers = JSON.parse(
        tryDecryptText(row.answersEncrypted) ?? '{}',
      ) as Record<string, string>;
      firearm = JSON.parse(
        tryDecryptText(row.firearmSnapshotEncrypted) ?? '{}',
      ) as Record<string, unknown>;
    } catch {
      this.logger.error(
        `Motivation ${motivationId}: seller consent ${row.id} would not decrypt`,
      );
      return undefined;
    }

    // The three stored files. Any that will not read is simply left out — the
    // declaration and the firearm list are the load-bearing part.
    const read = async (key: string | null) =>
      key ? await this.files.read(key).catch(() => null) : null;
    const [signature, front, back] = await Promise.all([
      read(row.signatureKey),
      read(row.licenceFrontKey),
      read(row.licenceBackKey),
    ]);

    return consentFormFor(
      {
        sellerFullName: answers.fullName ?? '',
        sellerIdNumber: answers.idNumber ?? '',
        sellerPhone: row.invitedPhone,
        firearm: firearm as never,
        signedPlace: row.signedPlace,
        signedAt: row.signedAt,
      },
      { signature, front, back },
    );
  }

  /**
   * The current owner's consent letter as a STANDALONE read-only PDF.
   *
   * ⚠️ THE SAME SHEET THE PACK PRINTS, FROM THE SAME BUILDER. It is
   * `buildSellerConsent` (above), so the view cannot disagree with the document
   * a DFO reads. Only the PRESENTATION differs: default scheme and no pack
   * chrome or annexure caption — operator, 2026-10-13: "Just show the consent
   * letter using a default style. We can rerender it according to the user
   * picked style when we create the whole motivation."
   *
   * Returns null when there is no completed consent — the caller answers 404.
   */
  async renderConsentLetter(
    applicantId: string,
    motivationId: string,
  ): Promise<{ pdf: Buffer; filename: string } | null> {
    // ⚠️ OWNERSHIP FIRST, the same check deleteFor makes. The letter is a named
    // third party's declaration and licence; serving it to anybody who guesses
    // an id would be handing over somebody else's paperwork.
    const owned = await this.prisma.motivation.findFirst({
      where: { id: motivationId, userId: applicantId },
      select: { id: true },
    });
    if (!owned) throw new NotFoundException('Motivation not found');

    const form = await this.buildSellerConsent(motivationId);
    if (!form) return null;
    const pdf = await this.pdf.renderStandaloneStatement(form);
    return { pdf, filename: `consent-${motivationId}.pdf` };
  }

  private async buildWitnessStatements(
    motivationId: string,
    applicantName: string,
    referenceNumber: string,
    licenceTypeLabel: string,
  ) {
    const rows = await this.prisma.motivationWitness.findMany({
      where: { motivationId, status: 'COMPLETED' },
      orderBy: { slot: 'asc' },
      select: {
        id: true,
        answersEncrypted: true,
        signedPlace: true,
        signedAt: true,
      },
    });
    if (!rows.length) return undefined;

    const out = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const plain = tryDecryptText(r.answersEncrypted);
      let parsed: Record<string, string> = {};
      try {
        parsed = plain ? (JSON.parse(plain) as Record<string, string>) : {};
      } catch {
        // A statement we cannot read must not take the whole pack down, and
        // must not print half-empty either — skip it and let the applicant
        // see it is missing from their own preview.
        this.logger.error(
          `Motivation ${motivationId}: witness ${r.id} answers would not decrypt`,
        );
        continue;
      }
      const signature = await this.witnesses.signature(r.id).catch(() => null);
      out.push(
        buildCompletedStatement({
          index: i + 1,
          total: rows.length,
          applicantName,
          referenceNumber,
          licenceTypeLabel,
          answers: parsed,
          signature: signature ?? undefined,
          signedPlace: r.signedPlace,
          signedAt: r.signedAt,
          version: parsed._version ?? WITNESS_FORM_VERSION,
        }),
      );
    }
    return out.length ? out : undefined;
  }

  // ── The cover photograph ────────────────────────────────────────
  //
  // Three sources, in the order that puts the applicant's own decision ahead
  // of ours. See motivation-cover-photo.ts for why "none" has to be stored
  // rather than inferred.

  /**
   * Which bytes go on the cover of THIS render.
   *
   * ⚠️ RESOLVED AT RENDER TIME, NOT STORED. The pack is rebuilt on every
   * download, so a decision the applicant changed five minutes ago only takes
   * effect if the choice is read here rather than baked in anywhere earlier.
   */
  private async coverPhotoForRender(
    row: { coverPhotoChoice: string | null; coverPhotoKey: string | null },
    answers: Record<string, string>,
  ): Promise<string | Buffer | undefined> {
    const choice = asCoverChoice(row.coverPhotoChoice);
    if (choice === 'NONE') return undefined;

    if (row.coverPhotoKey && choice !== 'STOCK') {
      // ⚠️ FAIL SOFT. A cover photograph that will not decrypt must not take
      // the whole motivation down — the applicant would lose the document
      // over its decoration.
      const own = await this.files.read(row.coverPhotoKey).catch(() => null);
      if (own) return own;
    }

    // Pure disk — see the note at the fetch site in the background pass.
    // Absent until that has run, and absent for good where Commons holds
    // nothing: the cover simply renders without a frame.
    if (!answers.firearm_make) return undefined;
    return this.firearmImages.find(
      answers.firearm_make,
      answers.firearm_model ?? '',
    )?.file;
  }

  /**
   * What to show the applicant when they open the cover-photograph card.
   *
   * Names the source of a stock photograph deliberately. Somebody being asked
   * "keep this or replace it?" is entitled to know the picture came off
   * Wikimedia Commons and shows the MODEL rather than their own firearm.
   */
  async coverPhoto(userId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        answersEncrypted: true,
        coverPhotoChoice: true,
        coverPhotoKey: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.shared.readAnswers(row.answersEncrypted);
    const make = (answers.firearm_make ?? '').trim();
    const model = (answers.firearm_model ?? '').trim();
    const stock = make ? this.firearmImages.find(make, model) : null;

    return {
      choice: asCoverChoice(row.coverPhotoChoice),
      hasOwn: Boolean(row.coverPhotoKey),
      firearmLine: [make, model].filter(Boolean).join(' ') || null,
      stock: stock
        ? {
            // The Commons file title, e.g. "File:Tikka-T3-Sporter.jpg", so the
            // applicant can go and look at it themselves if they want to.
            source: stock.source.split(/\s+/)[0] ?? '',
          }
        : null,
      // ⚠️ SENT, NOT HARD-CODED IN THE BUNDLE. The trim box locks to this
      // ratio and the frame prints at this size; a copy in the frontend would
      // go stale the first time the cover layout moved, and the symptom would
      // be a red box that promises a crop the cover does not print.
      aspect: COVER_ASPECT,
      frameMm: COVER_FRAME_MM,
      maxPx: COVER_MAX_PX,
    };
  }

  /** The bytes currently destined for the cover, for the on-screen preview. */
  async coverPhotoBytes(
    userId: string,
    id: string,
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        answersEncrypted: true,
        coverPhotoChoice: true,
        coverPhotoKey: true,
        coverPhotoMime: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    if (row.coverPhotoKey && asCoverChoice(row.coverPhotoChoice) !== 'STOCK') {
      const own = await this.files.read(row.coverPhotoKey).catch(() => null);
      if (own) {
        return { bytes: own, mimeType: row.coverPhotoMime ?? 'image/jpeg' };
      }
    }

    const answers = this.shared.readAnswers(row.answersEncrypted);
    if (!answers.firearm_make) return null;
    const stock = this.firearmImages.find(
      answers.firearm_make,
      answers.firearm_model ?? '',
    );
    if (!stock) return null;
    const bytes = await readFile(stock.file).catch(() => null);
    if (!bytes) return null;
    return {
      bytes,
      mimeType: stock.file.endsWith('.png') ? 'image/png' : 'image/jpeg',
    };
  }

  /** Record the applicant's decision. */
  async setCoverPhotoChoice(userId: string, id: string, choice: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const wanted = asCoverChoice(choice);
    if (!wanted) throw new BadRequestException('Unknown cover choice.');

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, coverPhotoKey: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    // ⚠️ "USE MY OWN" WITH NOTHING UPLOADED WOULD FALL THROUGH TO THE STOCK
    // PHOTOGRAPH, which is the opposite of what was asked for.
    if (wanted === 'OWN' && !row.coverPhotoKey) {
      throw new BadRequestException(
        'Upload a photograph first, then choose to use it.',
      );
    }
    await this.prisma.motivation.update({
      where: { id: row.id },
      data: { coverPhotoChoice: wanted },
    });
    return { choice: wanted };
  }

  /** Store the applicant's own cover photograph and select it. */
  async uploadCoverPhoto(
    userId: string,
    id: string,
    file: { buffer: Buffer; mimetype: string },
  ) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, coverPhotoKey: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const check = checkCoverPhoto(file.buffer, file.mimetype);
    if (!check.ok) throw new BadRequestException(check.problem);

    // ⚠️ THE ENCRYPTED TREE, like every other document they give us. A
    // photograph the applicant took of their own firearm can show its serial
    // number; it is not the shared, git-tracked stock asset in assets/firearms
    // and must not be stored beside one.
    const stored = await this.files.write(
      'motivations',
      file.buffer,
      new Date(),
    );
    const previous = row.coverPhotoKey;

    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        coverPhotoKey: stored.storageKey,
        coverPhotoMime: file.mimetype,
        coverPhotoChoice: 'OWN',
      },
    });

    // Replace rather than accumulate — and only AFTER the row points at the
    // new file, so a crash between the two leaves an orphan on disk rather
    // than a cover referencing bytes we already deleted.
    if (previous) {
      await this.files.remove(previous).catch(() => undefined);
    }
    return { choice: 'OWN' as const, hasOwn: true };
  }

  /** Discard their own photograph and fall back to whatever we found. */
  async removeCoverPhoto(userId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { id: true, coverPhotoKey: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    await this.prisma.motivation.update({
      where: { id: row.id },
      // Back to null rather than to STOCK: they have discarded a decision,
      // not made a new one, and the card should offer the stock photograph
      // afresh.
      data: {
        coverPhotoKey: null,
        coverPhotoMime: null,
        coverPhotoChoice: null,
      },
    });
    if (row.coverPhotoKey) {
      await this.files.remove(row.coverPhotoKey).catch(() => undefined);
    }
    return { choice: null, hasOwn: false };
  }

  /**
   * The pre-filled SAPS 271 — ONLY for applicants who asked for it.
   *
   * The 271 is an opt-in addition, not the product (operator, 2026-08-19):
   * most dealers complete the form with the buyer, so the default path never
   * asks the form-tier questions and never produces this document. Requesting
   * it without opting in is answered with a plain explanation, not a 404 —
   * the motivation exists; the form was declined.
   *
   * Available from the moment they opt in, not only after generation: the
   * whole point is that the form and the motivation are separate deliverables,
   * and leftBlank tells them exactly which boxes still need a pen.
   *
   * ⚠️ EXCEPT THAT NOBODY IS TOLD ANYTHING YET, AND THE LINE ABOVE HAS BEEN
   * WRONG FOR AS LONG AS IT HAS BEEN THERE. `leftBlank` is built, returned
   * from here — and DROPPED at motivations.controller.ts:415, which
   * destructures `{ pdf, filename }` and streams the PDF. The route returns a
   * file, so there is nowhere in this response for it to go; it needs an
   * endpoint of its own (or a header) and a panel to render it.
   *
   * So every entry the map records — "mark Marital status yourself", "you have
   * not answered this history question", and now the barrel-serial column of
   * item 2.1 — reaches the member as an EMPTY BOX ON A PDF and nothing else.
   * That is worth fixing and it is not a reason to stop recording them: the
   * facts are pinned by saps271-owned-firearms.spec.ts and the day a panel
   * exists it is already correct. Do not "simplify" leftBlank away on the
   * grounds that nothing reads it.
   */
  async renderSaps271(userId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        userId: true,
        referenceNumber: true,
        licenceType: true,
        answersEncrypted: true,
        uploads: { select: { kind: true } },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    // ⚠️ A RENEWAL IS A DIFFERENT FORM, AND THE ANSWER CANNOT OVERRIDE THAT.
    //
    // This gate read the opt-in and nothing else, while saps271Map throws for
    // a section 24 further down ("the SAPS 271 is an application for a NEW
    // licence (sections 13-20); a section 24 renewal uses a different form")
    // — a bare Error, surfaced as a 409, AFTER the member had answered the
    // roughly forty-eight extra questions the opt-in un-hides. A renewal uses
    // the SAPS 518(a), which this product does not fill in.
    //
    // Refused here, by name, before any of that. Old drafts can still hold the
    // answer, which is exactly why the licence type decides rather than it.
    if (row.licenceType === MotivationLicenceType.S24_RENEWAL) {
      throw new ConflictException(
        'A section 24 renewal is lodged on the SAPS 518(a), not the SAPS 271, so there is no form for us to fill in here. Your motivation goes with it as it stands.',
      );
    }

    // ⚠️ NO OPT-IN GATE HERE ANY MORE. Until 2026-09-08 this is where a member
    // who had answered "My dealer will fill it in" was turned away with a 409.
    // The 271 is no longer something the applicant elects to receive — every
    // pack ships one (D, G and H are always ours to complete; section F below
    // is filled or left blank by `firearm_source`, never by this choice) — so
    // there is nothing left to check the answer against. Brief §2.5,
    // `MOTIVATION-INTAKE-PLAN.md` §1. `fill_saps271` itself is retired in
    // motivation-fields.ts and kept only so an old draft still saves.
    /**
     * ⚠️ THE PROFILE UNDERNEATH, OR HALF THE FORM PRINTS BLANK.
     *
     * `readAnswers` opens THIS APPLICATION's blob and nothing else. Every
     * `scope: 'profile'` field — the safe, whether it is mounted and to what,
     * marital status, the premises — is stored on the MEMBER
     * (MemberProfileAnswers), because a wall does not move between
     * applications. So the 271 asked `a('safe_present')`, got nothing, and
     * left items 26/27 and the whole of 68, 68.1, 69 and 69.1 unticked on a
     * form the applicant signs — while the review sheet, which does layer the
     * profile, showed those answers as given.
     *
     * Operator, 2026-09-09: "Maritial status missing", "All safe questions
     * ticks missing".
     *
     * `answersFor` is the same door the writer already uses (see
     * motivation-generation.service.ts) — profile underneath, application on
     * top, because a value on this application is the member having changed it
     * here.
     */
    const answers = await this.shared.answersFor(
      row.userId,
      row.answersEncrypted,
    );

    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });

    try {
      // ⚠️ THE LETTER, NOT A GUESS AT IT. Items 68.1 and 69.1 are answered by
      // citing the photographs of the safe, so the citation has to carry the
      // letter this pack's index actually gives them — which moves with what
      // else was uploaded. annexureByKind rather than a find() over the
      // entries, because the safe kinds collapse onto one letter and a lookup
      // by member kind misses every member but the group's representative.
      const safeAnnexureLetter = annexureByKind(
        buildAnnexures((row.uploads ?? []).map((u) => u.kind)),
      ).get(MotivationUploadKind.SAFE_PHOTOGRAPHS)?.letter;

      // ⚠️ SECTION F, AT LAST. Twenty-two boxes were mapped, tested and
      // UNREACHABLE: this call never passed a seller, so the current owner's
      // half of the form went to every DFO blank while the coverage panel
      // told the applicant it was done. Operator, 2026-08-28: "F should be
      // filled, type A."
      //
      // ⚠️ NULL ON EVERY ROUTE BUT A SIGNED PRIVATE SALE, and that is the
      // point: sectionF() returns nothing until the seller has actually
      // completed and signed, and saps271-map refuses to fill the block
      // unless the applicant said the route was private. Two independent
      // gates, because printing one person's particulars under another
      // person's declaration is the failure this section can produce.
      const seller = (await this.sellerConsent.sectionF(row.id)) ?? undefined;

      const { pdf, leftBlank } = await this.saps271.build({
        licenceType: row.licenceType,
        answers,
        email: account?.email ?? undefined,
        motivationReference: row.referenceNumber,
        safeAnnexureLetter,
        seller,
      });
      return {
        pdf,
        filename: `saps271-${row.referenceNumber}.pdf`,
        leftBlank,
      };
    } catch (err) {
      // buildSaps271 throws a plain Error for a section 24 renewal — the 271
      // is the wrong form for it. Said plainly rather than surfaced as a 500.
      throw new ConflictException((err as Error).message);
    }
  }
}
