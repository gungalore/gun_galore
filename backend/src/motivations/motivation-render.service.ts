import {
  BLOCK_LABELS,
  sectionOf,
} from './motivation-research.service';
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
import { tryDecryptText } from '../common/blob-crypto';

import { MotivationQuotaService } from './motivation-quota.service';
import { CipSheetService } from './cip-sheet.service';
import { QuarryPlateService } from './quarry-plate.service';
import { quarryCaption, quarryFromKey } from './motivation-quarry';
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
import { TRAVELLED_AREAS_KEY } from './motivation-fields';
import type { NewsIncident } from '../news/news.types';
import { imageSize, isEmbeddable } from './motivation-annexure-layout';
import { SettingsService, FLAGS } from '../settings/settings.service';

/**
 * How hard the C.I.P. sheet is rasterised for the feature's inset.
 *
 * ⚠️ 4 IS CHOSEN, NOT DEFAULTED. It puts an A4 page at about 2 450 px wide;
 * set into an 82 mm column that is roughly 1 000 dpi, and the trimmed PNG runs
 * around 470 KB against packs that are already eleven megabytes. Lower and the
 * sheet's small type breaks up under a reader zooming in on it, which is the
 * whole reason it is on the page.
 */
const CIP_INSET_SCALE = 4;

/** The half of `pdf-to-img` this uses: PDF bytes in, one PNG per page out. */
type CipRasteriser = (
  input: Buffer,
  opts: { scale: number },
) => Promise<AsyncIterable<Buffer>>;
import { type SectionId } from './motivation-structure';
import {
  buildAnnexures,
  buildChecklist,
  UPLOAD_KIND_LABELS,
  annexureByKind,
  type AnnexureEntry,
} from './motivation-checklist';
import { MotivationSellerConsentService } from './motivation-seller-consent.service';
import { buildPriorNoticeRequest } from './motivation-prior-notice';
import { applicationWarnings } from './motivation-warnings';
import { buildCompletedStatement } from './motivation-character-statement';
import { WITNESS_FORM_VERSION } from './motivation-witness-form';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { findCartridge } from './motivation-cartridge';
import {
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
  ownedFirearmSerial,
  PRESS_CLIPPINGS_KEY,
  parsePressClippingIds,
} from './motivation-fields';
import { Saps271Service } from './saps271.service';
import {
  MotivationSharedService,
  TEMPLATE_VERSION,
  isPaidFor,
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
  'I prepared this motivation with assistance from All Outdoor, from ' +
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
    '—'
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
    const calibre = (answers[`existing_firearm_${i}_calibre`] ?? '').trim();
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
 * "Howa 1500 bolt-action rifle, serial B742119" — the firearm, named once.
 *
 * Extracted because three surfaces need the identical string and were about
 * to hold three copies of it: the running footer of every page, the cover's
 * identification block, and the opening sentence of the prior-notice request.
 * A footer and a request that name the firearm differently is the kind of
 * inconsistency a reviewer notices and nobody testing would.
 */
function firearmLine(answers: Record<string, string>): string | undefined {
  const base = [answers.firearm_make, answers.firearm_type]
    .map((v) => (v ?? '').trim())
    .filter(Boolean)
    .join(' ');
  if (!base) return undefined;
  const serial = answers.firearm_serial?.trim();
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
   */
  return paragraphs.length >= 3 ? { title, paragraphs } : undefined;
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
 * ⚠️ AND THE CALIBRE IS THE APPLICANT'S OWN, NOT THE CARTRIDGE'S STANDARDISED
 * NAME. The drawing is of "6,5 Creedmoor" because that is what the figures
 * were found under; the card says "6.5MM CREEDMOOR", and the card is what the
 * DFO is checking the application against. Printing the standardised spelling
 * on the cover would read as a discrepancy on the first page.
 */
function heroSubtitle(answers: Record<string, string>): string | undefined {
  const make = (answers.firearm_make ?? '').trim();
  const calibre = (answers.firearm_calibre ?? '').trim();
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
 */
function coverParticulars(
  answers: Record<string, string>,
  licenceTypeLabel: string,
  generatedAt: Date,
): [string, string][] {
  const v = (k: string) => (answers[k] ?? '').trim();
  const typeAndAction = [v('firearm_type'), v('firearm_action')]
    .filter(Boolean)
    .join(', ');
  const rows: [string, string][] = [];
  const push = (label: string, value: string) => {
    if (value) rows.push([label, value]);
  };
  push('Firearm type and action', typeAndAction);
  push('Make', v('firearm_make'));
  push('Model', v('firearm_model'));
  push('Calibre', v('firearm_calibre'));
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
    private readonly quarry: QuarryPlateService,
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
    }[],
    annexures: AnnexureEntry[],
  ): Promise<{
    images: AnnexureImagePage[];
    notPrinted: { letter: string; label: string; why: string }[];
    /** Annexures that arrived as PDFs — merged into the pack, not skipped. */
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
    // How many copies share each letter, so a caption can say "1 of 2".
    const totals = new Map<string, number>();
    for (const u of uploads) {
      totals.set(u.kind, (totals.get(u.kind) ?? 0) + 1);
    }
    const seen = new Map<string, number>();

    const images: AnnexureImagePage[] = [];
    const notPrinted: { letter: string; label: string; why: string }[] = [];
    const pdfs: {
      letter: string;
      label: string;
      index: number;
      total: number;
      bytes: Buffer;
    }[] = [];

    for (const u of uploads) {
      const entry = byKind.get(u.kind);
      const letter = entry?.letter ?? '?';
      const label = entry?.label ?? UPLOAD_KIND_LABELS[u.kind] ?? u.kind;
      const index = (seen.get(u.kind) ?? 0) + 1;
      seen.set(u.kind, index);
      const total = totals.get(u.kind) ?? 1;

      if (!u.storageKey || u.purgedAt) {
        notPrinted.push({ letter, label, why: 'no longer stored' });
        continue;
      }
      // ⚠️ A PDF IS NO LONGER A REASON TO LEAVE A DOCUMENT OUT. pdfkit cannot
      // embed one, but pdf-lib can copy its pages into the finished pack —
      // see motivation-pdf-merge.ts. Read the bytes first, because both paths
      // need them.
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
      if (isPdf) {
        pdfs.push({ letter, label, index, total, bytes });
        continue;
      }
      const size = imageSize(bytes);
      if (!size) {
        // Measuring is not optional: the alternative is guessing an aspect
        // ratio and printing somebody's licence stretched.
        notPrinted.push({ letter, label, why: 'we could not measure it' });
        continue;
      }
      images.push({
        letter,
        label,
        index,
        total,
        bytes,
        certification: entry?.certification ?? 'none',
        ...size,
      });
    }

    return { images, notPrinted, pdfs };
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
    clerkId: string,
    id: string,
    choice: { layout?: string; colourway?: string },
  ): Promise<Buffer> {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);

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

  async renderPdf(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);

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
    const kinds = (row.uploads ?? []).map((u) => u.kind);

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
    if (row.licenceType === MotivationLicenceType.S13_SELF_DEFENCE) {
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
    const annexures = buildAnnexures(kinds);
    const printable = await this.annexureImages(row.uploads ?? [], annexures);
    const pressClippings = await this.buildPressClippings(pressIncidents);

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
     * ⚠️ BUILT ONCE AND SHARED, because the quarry is chosen FROM it. The
     * species on the photograph comes out of the same prose the page prints,
     * so calling `cartridgeArticle` twice would let the picture and the words
     * disagree the day one of them changes.
     */
    const article = cartridgeArticle(row.researchEncrypted, cartridge?.name);
    const cartridgePhoto = await this.quarryPhotoFor(row.id, answers);

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
      // See isPaidFor. Payments are not live, so today this stamps almost
      // every download — which is the right way round.
      watermark: !isPaidFor(row),
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
      priorNotice,
      pressClippings,
      // ⚠️ THE FIGURES THE CUTTINGS ARE EXAMPLES OF. The body argues "eleven
      // house robberies in the quarter, and here are three of them", and the
      // annexure carried only the three — so a reviewer checking the claim had
      // nowhere to turn. Empty for a non-S13, for a station we cannot place,
      // or when there are no cuttings to head.
      precinctTables: (pressClippings ?? []).length
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
      cipSheet: await this.cipSheetFor(answers.firearm_calibre),
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
      cartridgePhoto,
      // The "take these to the police station" half of the checklist, and only
      // that half — the other half is the pack they are already holding.
      // ⚠️ THE APPLICANT'S PAGE, NOT THE REGISTRAR'S. See MotivationPdfInput.
      warnings: applicationWarnings(row.licenceType, answers).map((w) => ({
        authority: w.authority,
        message: w.message,
      })),
      takeWithYou: buildChecklist(row.licenceType, kinds)
        .sections.find((sec) => sec.key === 'theirs')
        ?.items.map((i) => ({ label: i.label, note: i.note })),
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
  ): Promise<
    | {
        png: Buffer;
        widthMm: number;
        heightMm: number;
        texts: DrawingText[];
        label: string;
        /** The cartridge's standardised name, for the feature's headline. */
        name: string;
        hero?: { subtitle: string };
        inset?: {
          png: Buffer;
          widthMm: number;
          heightMm: number;
          texts: DrawingText[];
        };
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

      const label = { name: hit.name, pmaxBar: hit.dims.pmaxBar ?? hit.pmaxBar };
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
       * ⚠️ THE SAME ROUND, DRAWN TWICE, BECAUSE THE TWO PLACES WANT DIFFERENT
       * DRAWINGS. A hero is a cover picture: two lengths, big, no engineering.
       * The feature's inset is the DIMENSION SHEET the operator asked to have
       * back on 2026-09-10 — "the dimension sheet should shrink to a third of
       * the page with the history, description and facts written around it" —
       * and it carries the full set of callouts at a third of the width.
       *
       * ⚠️ WHICH REVERSES THE 09-09 RULE THAT THE BODY GIVES UP ITS FIGURE
       * WHEN THE COVER TAKES ONE. That rule was written to stop the SAME
       * picture printing twice, and it was right about that. Two different
       * renderings of one round, on the cover and inside, is what a magazine
       * does with a photograph and a diagram — and the sketch that arrived the
       * next day puts a drawing on the feature page explicitly.
       *
       * Only built when the cover took the hero; without one the body already
       * receives the full drawing and a second raster would be waste.
       */
      /**
       * ⚠️ THE FEATURE'S INSET IS THE C.I.P. SHEET ITSELF, NOT OUR DRAWING.
       *
       * Operator, 2026-09-10, having seen the page render with our own
       * geometry in it: "rendered correctly but it's the wrong image. I need
       * this as the scaled down image", and then "i want the CIP sheet in
       * there, not negotiable ... we are not selling the sheet itself, we are
       * using it in our document as proof."
       *
       * ⚠️ THE SHEET CARRIES A REPRODUCTION NOTICE ON ITS FACE — "Reproduction
       * forbidden as well as in the form of extracts without approval of
       * C.I.P." That was put to the operator and this is their decision on
       * their own company's exposure, recorded here rather than argued again
       * in a later session. The mechanism is not new either: `cipSheetFor`
       * has spliced the whole page into packs as a fallback since it shipped,
       * behind FLAGS.cipSheetEnabled, which this respects.
       *
       * Falls back to our own drawing when there is no sheet for the round,
       * when the flag is off, or when the raster fails — the feature page must
       * never lose its picture over this.
       */
      const inset = heroLine
        ? ((await this.cipInset(printed)) ?? (await raster({ hero: false })))
        : undefined;

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
        label: `The cartridge \u2014 ${hit.name}`,
        name: hit.name,
        /**
         * ⚠️ THE LABEL IS STILL BUILT ON A HERO PACK. It is the contents-page
         * entry and the fallback heading, and a later change that gives the
         * body its figure back must not have to remember to reinstate it.
         */
        ...(heroLine ? { hero: { subtitle: heroLine } } : {}),
        ...(inset ? { inset } : {}),
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
    const province = (answers.police_station_province ?? '').trim() || undefined;

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
        const f = await this.crimeStats.precinct(name, province);
        if (!f) continue;
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
  /**
   * The quarry photograph for the cartridge page, or nothing.
   *
   * ⚠️ A READ. The picture was drawn during GENERATION, beside the research
   * and the cover photograph; this path renders on every download and may not
   * spend twenty seconds on a picture model against a sixty-second nginx
   * ceiling. See quarry-plate.service.
   */
  private async quarryPhotoFor(
    motivationId: string,
    answers: Record<string, string>,
  ): Promise<
    { png: Buffer; widthMm: number; heightMm: number; caption: string } | undefined
  > {
    /**
     * ⚠️ GATED ON THE APPLICANT HAVING SAID THEY HUNT, NOT ON THE CARTRIDGE.
     * A 6,5 Creedmoor suits impala whether or not this applicant has ever
     * hunted one, and MO000075 is a DEDICATED SPORT application. Game in it
     * would argue a purpose nobody applied for — the same fault CLAUDE.md
     * already names for putting range or farm words in a self-defence
     * document, and section 16 splits hunter from sports person precisely
     * because they are different licences.
     */
    if (!(answers.hunt_game_class ?? '').trim()) return undefined;

    const plate = await this.quarry.storedFor(motivationId).catch(() => undefined);
    if (!plate) return undefined;

    return {
      png: plate.bytes,
      // Only the ratio matters — the page places it in a fixed slot.
      widthMm: 210,
      heightMm: (210 * plate.height) / plate.width,
      caption: quarryCaption(quarryFromKey(plate.speciesKeys)),
    };
  }

  private async cipInset(calibre: string): Promise<
    | { png: Buffer; widthMm: number; heightMm: number; texts: DrawingText[] }
    | undefined
  > {
    const name = calibre.trim();
    if (!name) return undefined;
    const on = await this.settings.get(FLAGS.cipSheetEnabled).catch(() => true);
    if (!on) return undefined;
    try {
      /**
       * ⚠️ THE RAW FILE, NOT THE A4-FITTED COPY. `sheetFor` re-embeds the page
       * as a Form XObject so it can be scaled onto A4; pdf.js cannot rasterise
       * that here and threw out of `paintFormXObjectBegin` on every render
       * since the inset shipped. The trim below removes the margins the A4
       * fitting was for.
       */
      const sheet = await this.cip.rawSheetFor(name);
      if (!sheet) return undefined;

      // ⚠️ ESM-ONLY, AND THE BACKEND COMPILES TO CommonJS. TypeScript lowers
      // this to require(), which Node 22.12+ resolves for an ES module — the
      // same mechanism the PDF spec's reader relies on. Verified on the box
      // before it was written in; it is not an assumption.
      const mod = (await import('pdf-to-img')) as unknown as {
        pdf?: CipRasteriser;
        default?: { pdf?: CipRasteriser };
      };
      const toImages = mod.pdf ?? mod.default?.pdf;
      if (!toImages) return undefined;

      const pages = await toImages(sheet.bytes, { scale: CIP_INSET_SCALE });
      let first: Buffer | undefined;
      for await (const page of pages) {
        first = page;
        break;
      }
      if (!first) return undefined;

      const png = await sharp(first).trim().png().toBuffer();
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
       * work from.
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
        label: `The cartridge — ${sheet.name}`,
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
      answers = JSON.parse(tryDecryptText(row.answersEncrypted) ?? '{}') as Record<
        string,
        string
      >;
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
  async coverPhoto(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
    clerkId: string,
    id: string,
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
  async setCoverPhotoChoice(clerkId: string, id: string, choice: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
    clerkId: string,
    id: string,
    file: { buffer: Buffer; mimetype: string },
  ) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
  async removeCoverPhoto(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
  async renderSaps271(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
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
