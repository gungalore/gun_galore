import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MotivationStatus, MotivationUploadKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { tryDecryptText } from '../common/blob-crypto';

import { MotivationQuotaService } from './motivation-quota.service';
import { CipSheetService } from './cip-sheet.service';
import { asLayout } from './motivation-pdf-layouts';
import { consentFormFor } from './motivation-consent-statement';
import {
  AnnexureImagePage,
  MotivationPdfService,
  asScheme,
  asFormat,
} from './motivation-pdf.service';
import { imageSize, isEmbeddable } from './motivation-annexure-layout';
import { SettingsService, FLAGS } from '../settings/settings.service';
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
import { buildCompletedStatement } from './motivation-character-statement';
import { WITNESS_FORM_VERSION } from './motivation-witness-form';
import { readFile } from 'node:fs/promises';
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
  SAPS271_FILL,
  SAPS271_OPT_KEY,
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
const DISCLAIMER_TEXT =
  'I prepared this motivation with assistance from All Outdoor, from ' +
  'information I supplied, and I submit it as my own. It is not legal ' +
  'advice. I confirm that the facts stated in it are true and correct to the ' +
  'best of my knowledge.';

/**
 * The firearms the applicant already holds, read out of the numbered answer
 * fields and into a table the PDF can print.
 *
 * ⚠️ MAKE AND CALIBRE ARE THE IDENTITY, SERIALS ARE NOT PRINTED HERE. The
 * interview collects barrel and frame serials and the licence number for each
 * existing firearm, because the SAPS 271 asks for them — but a serial in a
 * table on a motivation is a line a reviewer has to check against a licence
 * that is already annexed, and getting it wrong is worse than omitting it.
 * The annexed licence copy is the evidence; this table is the summary.
 *
 * A row with no make AND no calibre is skipped rather than printed as a row
 * of dashes: the interview lets an applicant start firearm 2 and abandon it,
 * and half a row on a submission reads as carelessness.
 */
function existingFirearms(
  answers: Record<string, string>,
): { make: string; calibre: string; type: string; section: string }[] {
  const out: { make: string; calibre: string; type: string; section: string }[] =
    [];
  for (let i = 1; i <= 3; i++) {
    const make = (answers[`existing_firearm_${i}_make`] ?? '').trim();
    const calibre = (answers[`existing_firearm_${i}_calibre`] ?? '').trim();
    const type = (answers[`existing_firearm_${i}_type`] ?? '').trim();
    const licence = (answers[`existing_firearm_${i}_licence_no`] ?? '').trim();
    if (!make && !calibre) continue;
    out.push({
      make: make || '—',
      calibre: calibre || '—',
      type: type || '—',
      // The licence NUMBER, not the section, when we have it — that is what a
      // DFO looks up. "Licensed" alone when we do not, rather than a guess at
      // which section it was issued under.
      section: licence ? `Licence ${licence}` : 'Licensed',
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

  async renderPdf(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
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

    const answers = this.shared.readAnswers(row.answersEncrypted);

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
    // ONE lettering, built once, used by the index AND by the captions on the
    // reprinted copies. See annexureImages.
    const annexures = buildAnnexures(kinds, ['PRIOR_NOTICE_REQUEST']);
    const printable = await this.annexureImages(row.uploads ?? [], annexures);

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
      // ⚠️ KEYED ON THE HEADING AS IT IS PRINTED — uppercased, colon stripped —
      // because that is the only string the renderer has when it draws one.
      // See sectionMarks on MotivationPdfInput for why this is built from the
      // stored plan rather than inferred from the words.
      sectionMarks: sectionMarksFor(row.structurePlan, answers.firearm_type),
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
      // The "take these to the police station" half of the checklist, and only
      // that half — the other half is the pack they are already holding.
      takeWithYou: buildChecklist(row.licenceType, kinds)
        .sections.find((sec) => sec.key === 'theirs')
        ?.items.map((i) => ({ label: i.label, note: i.note })),
    });
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
        label: `The cartridge — ${sheet.name} (C.I.P. data)`,
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
   */
  async renderSaps271(clerkId: string, id: string) {
    await this.quota.assertEnabled();
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        referenceNumber: true,
        licenceType: true,
        answersEncrypted: true,
        uploads: { select: { kind: true } },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const answers = this.shared.readAnswers(row.answersEncrypted);
    if ((answers[SAPS271_OPT_KEY] ?? '') !== SAPS271_FILL) {
      throw new ConflictException(
        'You chose to let your dealer complete the SAPS 271. If you would like us to fill it in instead, change that choice in your application first.',
      );
    }

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
