import { Injectable, NotFoundException } from '@nestjs/common';
import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AnswerProvenance,
  ProvenanceMap,
  parseProvenance,
} from '../common/answer-provenance';
import { answerValue } from '../common/card-placeholder';
import {
  LICENCE_TYPE_LABELS,
  MotivationField,
  OWNED_ROWS,
  OWNED_SECTION,
  PREMISES_SECTION,
  fieldsFor,
  isVisible,
  missingRequired,
  OVERLAP_ANGLE_KEY,
  ownedFirearmSerial,
  ownedRowTaken,
} from './motivation-fields';
import { ServedField, expandFields } from './motivation-field-options';
import { UPLOAD_KIND_LABELS, buildAnnexures } from './motivation-checklist';
import { overlapAnglesFor } from './motivation-cards';
import { documentStatus } from './motivation-documents';
import { requiredEndorsement } from './motivation-eligibility';
import {
  credentialSlots,
  type SheetCredentials,
} from './motivation-credential-slots';
import { overlapFromAnswers } from './motivation-overlap';
import { saps271Coverage } from './saps271-coverage';
import { previewFor, type PreviewSection } from './motivation-preview';
import { MotivationSharedService } from './motivation-shared.service';
import { MemberProfileAnswersService } from './member-profile-answers.service';

// ────────────────────────────────────────────────────────────────────
// EVERYTHING THE REVIEW SHEET NEEDS, IN ONE CALL.
//
// `GET /motivations/:id/sheet` — the one read behind the whole of
// `/licence-centre/[id]`. MOTIVATION-REBUILD-BRIEF.md §5.2.
//
// ⚠️ THIS SERVICE COMPUTES `state`, AND NOTHING ELSE IN THE SYSTEM MAY.
// That is the point of the endpoint existing at all. Until today the frontend
// carried `visibleFields()` — a hand-written mirror of isVisible() including
// the SAPS 271 gate — and the two had to be kept in step by a comment saying
// so. A flag honoured by one side and not the other puts a question in front
// of somebody that we have already answered, or hides one the server insists
// on. There is one implementation now, it is this one, and the screen renders
// what it is told.
//
// ⚠️ IT COMPOSES; IT DOES NOT DECIDE. Visibility comes from isVisible(),
// completeness from missingRequired(), documents from documentStatus(),
// coverage from saps271Coverage(), the overlap from overlapFromAnswers(), the
// prose from previewFor(). A rule implemented HERE would be a second copy of
// one that already exists somewhere better tested.
//
// ⚠️ NOTHING IS MASKED. `sensitive` drives masking in logs, in admin views and
// in anything another person can see — never on the applicant's own screen.
// They are about to sign these values onto a police form and they have to be
// able to read them. The live walkthrough found a full name rendered
// "GE••••••••" and an ID as "8905 •••• •••" on the applicant's own
// application; that is what this rule exists to stop repeating.
// ────────────────────────────────────────────────────────────────────

/**
 * Sources that mean "this came off a document".
 *
 * ⚠️ A CARD PLACEHOLDER IS A REAL ANSWER WHEN A CARD IS WHAT SAID IT. The
 * operator's Glock licence prints "Model NONE"; the consent stored NONE, the
 * SAPS 271 prints NONE — and this sheet blanked it, so the row read "Still
 * needed" and asked him to fill in a box that was already correctly answered.
 * Operator, 2026-09-08: "Model is still not filled for sellers firearm", and
 * before that: "DO NOT LEAVE A NONE BLANK EVER unless I tell you to."
 *
 * ⚠️ SCOPED TO DOCUMENT SOURCES, NOT APPLIED EVERYWHERE. `answerValue()` is
 * still what stops a placeholder becoming an answer at every OFFER boundary —
 * that rule is why "Firearm 6 — frame serial NONE" stopped being proposed. It
 * was never meant to blank a value we had already accepted and printed. The
 * card-placeholder module says so itself: "the readers and the vault keep the
 * card verbatim". This screen is a reader.
 */
const FROM_A_DOCUMENT: ReadonlySet<string> = new Set([
  'VAULT',
  'READ',
  'SELLER',
]);

/**
 * The value to SHOW, and whether it counts as answered.
 *
 * Returns the card's own word where a document gave us one, and '' where a
 * placeholder arrived from anywhere else — a profile, a derivation, or a blob
 * old enough to carry no provenance at all.
 */
function shownValue(
  raw: string | undefined,
  entry: AnswerProvenance | undefined,
): string {
  const text = (raw ?? '').trim();
  if (!text) return '';
  if (FROM_A_DOCUMENT.has(entry?.source ?? '')) return text;
  return answerValue(text);
}

/** How the sheet renders one item. */
export type SheetItemState = 'filled' | 'suggested' | 'needs_you' | 'na';

export interface SheetItem {
  key: string;
  label: string;
  kind: MotivationField['kind'];
  state: SheetItemState;
  /** Full, never masked. Empty string when there is nothing yet. */
  value: string;
  /** Where it came from, or null when the member typed it or nobody has. */
  provenance: AnswerProvenance | null;
  /** Which sheet section it belongs under — see SECTION_OF. */
  section: string;
  scope: 'profile' | 'application';
  required: boolean;
  help?: string;
  /** The tiles, for `kind: 'cards'`. */
  options?: readonly { key: string; sentence: string }[];
  /** Grouped options, for a field whose list comes from a data module. */
  optionGroups?: ServedField['optionGroups'];
  /** For `choice` / `yesno` / `multi`. */
  choices?: readonly string[];
  /**
   * The optional "in your own words" box that belongs under a card grid.
   *
   * ⚠️ A PAIRING, NOT A FIELD PROPERTY. Both halves are ordinary registry
   * fields; what makes them a pair is a rendering decision, so it is stated
   * here rather than in the registry, where it would be a layout hint sitting
   * in the contract between the form, the fact pack and the quality gate.
   */
  ownWordsKey?: string;
}

export interface SheetSection {
  id: string;
  title: string;
  blurb: string;
  /** Required keys in this section that are still empty. */
  missing: string[];
}

export interface SheetResponse {
  application: {
    id: string;
    referenceNumber: string;
    licenceType: MotivationLicenceType;
    licenceTypeLabel: string;
    label: string | null;
    status: MotivationStatus;
    /**
     * When the applicant confirmed the declaration, or null.
     *
     * ⚠️ THE SHEET HAD NO IDEA THIS GATE EXISTED. `generate()` refuses with a
     * 409 until it is set, and the wizard screen that asked has been deleted
     * since Phase 4 — so every section read Done, the button was enabled, and
     * the click failed. It is served so the footer can ask once and never ask
     * again.
     */
    declarationAcceptedAt: string | null;
  };
  sections: SheetSection[];
  items: SheetItem[];
  documents: {
    id: string;
    kind: string;
    letter: string | null;
    label: string;
    mime: string | null;
    state: 'read' | 'check';
    /** Copied in from the Document Centre, or added here by the member. */
    origin: 'vault' | 'member';
  }[];
  /**
   * What the pack still wants, by tier.
   *
   * ⚠️ SEPARATE FROM `documents` ABOVE, AND THE TWO ANSWER DIFFERENT QUESTIONS.
   * `documents` is what is ATTACHED — the shelf across the top. This is what
   * is still WANTED, and it is what "Your pack" renders. A member with an
   * empty vault has an empty shelf and a full list here; that is the correct
   * appearance of a first-timer, not an error state.
   */
  needs: ReturnType<typeof documentStatus>;
  /**
   * The competency and its proficiency, as one pair.
   *
   * ⚠️ ITS OWN BLOCK BECAUSE THE PAIR IS NOT A FIELD. The registry carries
   * four competency ANSWERS — number, covers, issued, expiry — and no
   * question at all about the two DOCUMENTS behind them, so a member who had
   * never uploaded a statement of results saw a section that looked finished.
   * Operator, 2026-09-08: "the proficiency needs to be added with the
   * competency from the same catogory. One can't be without the other."
   */
  credentials: SheetCredentials;
  coverage: ReturnType<typeof saps271Coverage>;
  overlap: ReturnType<typeof overlapFromAnswers>;
  preview: PreviewSection[];
  /**
   * Required keys still unanswered, across the whole sheet.
   *
   * ⚠️ ONE NUMBER, THREE VIEWS. The progress pill, the dot on each section chip
   * and the footer's disabled button all read THIS list and nothing else. The
   * live walkthrough found four separate progress systems that could and did
   * contradict each other — a step showing a green tick while its own panel
   * read "0%". Three views of one number cannot disagree.
   */
  missing: string[];
  /**
   * The owned-firearm rows that actually hold a firearm, in order.
   *
   * ⚠️ THE SERVER DECIDES THIS, LIKE EVERY OTHER VISIBILITY DECISION ON THE
   * SHEET. The registry serves all fourteen rows whatever a member owns, and
   * the live sheet rendered every one of them flat: five real firearms and
   * NINE empty ones, no heading between them, and each empty row carrying the
   * full eleven-tile "what it is for" grid — ninety-nine dead tap targets.
   * "Firearms you own" alone measured 15,840px, sixty per cent of a 26,351px
   * page.
   *
   * ⚠️ AND IT USES ownedRowTaken, WHICH IS THE ONE RULE. That function's own
   * note records what happened when three readers disagreed about whether a
   * row was in use: the next licence uploaded was proposed straight over a
   * firearm that was already there. A fourth reader in the browser, working
   * off whichever keys happen to reach it, is exactly that bug again — so the
   * page is told, not left to work it out.
   */
  ownedRows: SheetOwnedRow[];
}

/** One owned firearm, as its collapsed header reads. */
export interface SheetOwnedRow {
  /** 1-based, matching the `existing_firearm_N_` key prefix. */
  index: number;
  /** "MAUSER · .30-06 SPRINGFIELD", or "Firearm 3" when nothing names it. */
  summary: string;
  /** "96008993 · licence expires 2034-10-28", or null when neither is known. */
  note: string | null;
}

/**
 * The owned rows a member actually holds, headed the way a licence card reads.
 *
 * ⚠️ answerValue ON EVERY DISPLAYED FIELD, ownedRowTaken ON THE DECISION. The
 * two disagree deliberately: a card printing "NONE" against the frame is
 * EVIDENCE somebody has been in the row (so the row is taken) and is NOT a
 * serial (so the header must not print it). Running answerValue on the
 * taken-test would lose a row; skipping it on the header would head a fold
 * "Firearm 3 · NONE".
 */
export function ownedRowsFor(
  answers: Record<string, string>,
): SheetOwnedRow[] {
  const out: SheetOwnedRow[] = [];
  for (let n = 1; n <= OWNED_ROWS; n++) {
    if (!ownedRowTaken(answers, n)) continue;
    const p = `existing_firearm_${n}_`;
    const at = (col: string) => answerValue(answers[`${p}${col}`] ?? '').trim();

    // Make and calibre, because that is how a member says which rifle they
    // mean. Model is often blank and the serial means nothing to the eye.
    const summary =
      [at('make'), at('calibre')].filter(Boolean).join(' · ') ||
      at('model') ||
      `Firearm ${n}`;

    const serial = ownedFirearmSerial(answers, n);
    const expiry = at('expiry');
    const note =
      [serial, expiry ? `licence expires ${expiry}` : '']
        .filter(Boolean)
        .join(' · ') || null;

    out.push({ index: n, summary, note });
  }
  return out;
}

/**
 * Registry section → the eight sections the sheet renders, in order.
 *
 * ⚠️ THE SHEET HAS EIGHT AND THE REGISTRY HAS ELEVEN, DELIBERATELY. The
 * registry groups by SUBJECT because that is what the fact pack and the
 * coverage meter need; the sheet groups by WHAT A MEMBER IS DOING, and a
 * section 16 sport applicant does not experience "Dedicated status" and
 * "Experience" as two different jobs. Anything unmapped falls to 'case', which
 * is the section that answers "why you".
 */
const SECTION_OF: Record<string, string> = {
  'The firearm': 'firearm',
  'About you': 'you',
  'Your competency': 'competency',
  [OWNED_SECTION]: 'own',
  [PREMISES_SECTION]: 'premises',
  'Storage and safety': 'premises',
  History: 'declarations',
  'Your circumstances': 'case',
  Experience: 'case',
  'Dedicated status': 'case',
  'The existing licence': 'case',
};

/** The eight, in the order brief §6.1 lists them. One sentence each. */
const SECTIONS: { id: string; title: string; blurb: string }[] = [
  {
    id: 'firearm',
    title: 'The firearm',
    blurb: 'What you are applying for, read off whatever you have uploaded.',
  },
  {
    id: 'you',
    title: 'You',
    blurb: 'Your details as they will appear on the form.',
  },
  {
    id: 'competency',
    // ⚠️ THE WORD "PROFICIENCY" IS IN THE TITLE ON PURPOSE. The section
    // carried four competency ANSWERS and never named the statement of results
    // behind them, so the operator asked for a proficiency section three times
    // while looking straight at the section it belongs in. The chip strip
    // scrolls; a longer chip costs nothing.
    title: 'Competency and proficiency',
    // ⚠️ TRUE IN BOTH STATES. It read "there is usually nothing to do here"
    // above a row marked "Still needed", which is the page arguing with
    // itself. This says what we do without promising what is left.
    blurb: 'Read off your certificates wherever we hold them.',
  },
  {
    id: 'own',
    title: 'Firearms you own',
    blurb: 'What you already hold, and what each one is for.',
  },
  {
    id: 'premises',
    title: 'Premises and storage',
    blurb: 'Where the firearm will live. Asked once and kept on your profile.',
  },
  {
    id: 'case',
    title: 'Your case',
    blurb: 'Tap what is true of you. We write the argument.',
  },
  {
    id: 'declarations',
    title: 'Declarations',
    // ⚠️ FIVE AND THE SIXTH, BECAUSE THE TWO NUMBERS ON THIS SCREEN DISAGREED.
    // The registry carries six history questions and the 271 coverage meter
    // counts six, correctly; `history_negligence` only appears once a firearm
    // has been lost or stolen, so five is what most members are asked. Saying
    // "five" flatly left a member reading "Five questions" beside a meter
    // scoring them out of six on the same page, with nothing explaining it.
    // Naming the condition costs eight words and settles it.
    blurb:
      'Five questions everybody is asked, and one more if a firearm has ever ' +
      'been lost or stolen. Answering "no" adds nothing to your motivation.',
  },
  {
    id: 'pack',
    title: 'Your pack',
    blurb: 'What you will take to the DFO.',
  },
];

/**
 * Card set → the optional long box that belongs under it.
 *
 * See SheetItem.ownWordsKey for why this is here and not in the registry.
 */
const OWN_WORDS: Record<string, string> = {
  s13_reasons: 'threat_circumstances',
  s13_movements: 'daily_movements',
  hunt_reasons: 'hunting_history',
  hunt_game_class: 'intended_quarry',
  hunt_where: 'hunting_locations',
  sport_reasons: 'competition_record',
  overlap_angle: 'overlap_justification',
};

@Injectable()
export class MotivationSheetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shared: MotivationSharedService,
    private readonly profileAnswers: MemberProfileAnswersService,
  ) {}

  /**
   * Decide how one field renders.
   *
   * ⚠️ FOUR STATES, AND `suggested` IS THE ONLY ONE THAT ASKS FOR ANYTHING.
   * The operator's standing rule (2026-08-25) is fill it in, arm it, let them
   * change it — so a value we are confident about is `filled` and carries no
   * task. `suggested` is reserved for a value we INFERRED rather than read,
   * which is the one case where a confirm step is not work we invented.
   */
  private stateOf(
    field: MotivationField,
    answers: Record<string, string>,
    provenance: ProvenanceMap,
    overlap: ReturnType<typeof overlapFromAnswers>,
  ): SheetItemState {
    if (!isVisible(field, answers)) return 'na';
    /**
     * ⚠️ NEVER ASK SOMEBODY WHY THEY WANT THIS ONE "AS WELL" WHEN THEY HOLD
     * NOTHING. The overlap question exists to answer a Registrar who has
     * noticed the applicant already owns something similar; put in front of a
     * first-time applicant it invents a difficulty to argue against and implies
     * they hold firearms they do not.
     *
     * OverlapCard used to carry this rule by rendering itself away — "⚠️
     * RENDERS NOTHING WHEN THE VERDICT IS CLEAR" — and that component is gone
     * now that the question has one control instead of two. The rule outlived
     * it and belongs here anyway: this service is the only visibility decision
     * in the system.
     */
    if (field.key === OVERLAP_ANGLE_KEY && !overlap.suggestedAngle?.length) {
      return 'na';
    }
    /**
     * ⚠️ A CARD THAT SAYS "NONE" HAS ANSWERED THE QUESTION. Reading this
     * through answerValue made a licence printing "Model NONE" render as
     * `needs_you` — a row marked Still needed, in the outstanding count, on a
     * fact the seller had already signed for and the 271 already prints.
     */
    if (!shownValue(answers[field.key], provenance[field.key]).trim()) {
      return 'needs_you';
    }
    return provenance[field.key]?.inferred ? 'suggested' : 'filled';
  }

  /**
   * The competency/proficiency pair, and what the Document Centre could add.
   *
   * ⚠️ A COUNT, NOT A LIST. `GET :id/library` is the list, and it folds a
   * two-page proficiency into one entry, hides what is already attached and
   * respects the across-applications consent. Rebuilding any of that here
   * would be a second implementation of the machinery whose absence produced
   * the operator's "the proficiencies are still double in that dropdown". All
   * this decides is whether the door is worth showing.
   *
   * ⚠️ AND THE FOLD IS WHY THE COUNT IS NOT `prisma.count()`. A proficiency
   * certificate and its statement of results are TWO Credential rows joined
   * by `otherSideId` and ONE document; counting rows would offer a member with
   * one proficiency "2 in your Licence Centre" and then show them one entry.
   */
  private async credentialsFor(
    userId: string,
    answers: Record<string, string>,
    ctx: {
      uploads: {
        kind: string;
        extractionOk: boolean | null;
        sourceCredentialId: string | null;
      }[];
      letterFor: (kind: string) => string | null;
    },
  ): Promise<SheetCredentials> {
    const [rows, knowledge] = await Promise.all([
      this.prisma.credential.findMany({
        where: {
          userId,
          purgedAt: null,
          kind: { in: ['COMPETENCY_CERTIFICATE', 'PROFICIENCY'] },
        },
        select: { id: true, kind: true, otherSideId: true },
      }),
      this.shared.proficiencyFor(userId),
    ]);

    // What is already on this application, so the Centre count is what is
    // LEFT to add rather than what exists.
    const here = new Set(
      ctx.uploads
        .map((u) => u.sourceCredentialId)
        .filter((v): v is string => !!v),
    );

    const countFor = (kind: 'COMPETENCY_CERTIFICATE' | 'PROFICIENCY') => {
      const mine = rows.filter((r) => r.kind === kind && !here.has(r.id));
      const ids = new Set(mine.map((r) => r.id));
      let n = 0;
      for (const r of mine) {
        // Only the page whose id sorts first counts, and only when its
        // partner is present — a lone follower whose lead was deleted is
        // still a document the member can attach.
        if (r.otherSideId && ids.has(r.otherSideId) && r.otherSideId < r.id) {
          continue;
        }
        n++;
      }
      return n;
    };

    return credentialSlots({
      needed: requiredEndorsement(answers),
      attached: ctx.uploads.map((u) => ({
        kind: u.kind,
        letter: ctx.letterFor(u.kind),
        origin: u.sourceCredentialId ? ('vault' as const) : ('member' as const),
        unread: !u.extractionOk,
      })),
      inCentre: {
        COMPETENCY_CERTIFICATE: countFor('COMPETENCY_CERTIFICATE'),
        PROFICIENCY_CERTIFICATE: countFor('PROFICIENCY'),
      },
      knowledge: { state: knowledge.state, alert: knowledge.alert },
    });
  }

  async sheetFor(clerkId: string, id: string): Promise<SheetResponse> {
    const user = await this.shared.requireUser(clerkId);

    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        referenceNumber: true,
        licenceType: true,
        label: true,
        status: true,
        declarationAcceptedAt: true,
        answersEncrypted: true,
        answerProvenance: true,
        uploads: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            // ⚠️ THE SECOND ROLE THIS DOCUMENT PLAYS, and it was not selected.
            // One membership certificate is the association card AND the
            // letter of good standing; without this the sheet's checklist
            // could only ever count the first. See the documentStatus call.
            coversKinds: true,
            mimeType: true,
            extractionOk: true,
            // Which Document Centre credential this page is a copy of, or null
            // when the member added it here. It is the whole of `origin`.
            sourceCredentialId: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    // ⚠️ THE PROFILE UNDERNEATH, THE APPLICATION ON TOP — the same layering
    // findOne uses, and for the same reason: a profile answer is an offer, and
    // a value on this application is the member having changed it here.
    const profile = await this.profileAnswers.readFor(user.id);
    const answers = {
      ...profile.answers,
      ...this.shared.readAnswers(row.answersEncrypted),
    };
    const provenance: ProvenanceMap = {
      ...profile.provenance,
      ...parseProvenance(row.answerProvenance),
    };

    // ⚠️ BEFORE THE ITEMS, because stateOf reads it — the overlap question is
    // not applicable to somebody who holds nothing similar.
    const overlap = overlapFromAnswers(row.licenceType, answers);

    /**
     * ⚠️ THE SIX COMPONENT ROWS STAY OFF THE SHEET UNTIL SOMETHING FILLS ONE.
     *
     * Barrel, frame and receiver — serial and make each — are SAPS 271 section
     * E 1.7–1.12, and on a real card two of the three read NONE. Walking an
     * S13 handgun with no licence card read yet, they sat there as six empty
     * boxes asking a member to describe parts of a firearm they have not
     * bought, on a form where a wrong answer is an offence under section
     * 120(9)(f).
     *
     * ⚠️ THE READER IS THE TRIGGER, NOT THE MEMBER. `common/firearm-identity`
     * reads all four serials off a licence card or a dealer's invoice, so the
     * moment one is read every one of the six appears — including the empty
     * ones, because a card that prints NONE against the barrel is a fact worth
     * showing and correcting. Before that they are the 271's to fill and
     * nobody's to type.
     *
     * ⚠️ SERVED, NOT REGISTERED. `showIf` takes ONE key, and gating each row on
     * one of its five siblings either loops or hides everything when the card
     * happened to number a different component. The condition is "has any of
     * these six been filled", which the server can ask and a per-field clause
     * cannot.
     */
    const COMPONENT_ROWS = [
      'barrel_serial',
      'barrel_make',
      'frame_serial',
      'frame_make',
      'receiver_serial',
      'receiver_make',
    ];
    const componentsRead = COMPONENT_ROWS.some(
      (k) => (answers[k] ?? '').trim() !== '',
    );

    const served = expandFields(fieldsFor(row.licenceType)).filter(
      (f) => componentsRead || !COMPONENT_ROWS.includes(f.key),
    );

    const items: SheetItem[] = served.map((f) => {
      const state = this.stateOf(f, answers, provenance, overlap);
      const item: SheetItem = {
        key: f.key,
        label: f.label,
        kind: f.kind,
        state,
        // ⚠️ IN FULL. See the masking note at the top of this file.
        value: shownValue(answers[f.key], provenance[f.key]),
        provenance: provenance[f.key] ?? null,
        section: SECTION_OF[f.section] ?? 'case',
        scope: f.scope ?? 'application',
        required: !!f.required,
      };
      if (f.help) item.help = f.help;
      /**
       * ⚠️ THE OVERLAP ANGLES ARE FILTERED BY SECTION, HERE AND NOWHERE ELSE.
       * The registry serves all sixteen; five argue the sport and four argue
       * hunting, and the operator's own section 13 carries
       * `overlap_angle: "different_division"` — "a different division of the
       * sport" — because that sentence was on the screen of a self-defence
       * application. The tapped sentence goes into the document verbatim, so
       * this is not a bad option shown to a model, it is a refusal trigger the
       * applicant put there because we offered it.
       *
       * ⚠️ OFFERED, NEVER ACCEPTED. allowedValues still takes the whole set —
       * a draft holding a now-unoffered angle must keep saving rather than
       * failing on every keystroke. See the retiredChoices rule.
       */
      if (f.options) {
        item.options =
          f.key === OVERLAP_ANGLE_KEY
            ? overlapAnglesFor(row.licenceType)
            : f.options;
      }
      if (f.optionGroups) item.optionGroups = f.optionGroups;
      if (f.choices) item.choices = f.choices;
      if (f.kind === 'cards') {
        // The registry names owned-row purposes `existing_firearm_3_primary_use`
        // and there is one pairing for all fourteen, so the lookup is on the
        // set rather than on the key.
        const setName = f.key.replace(/^existing_firearm_\d+_/, '');
        const own = OWN_WORDS[setName] ?? OWN_WORDS[f.key];
        if (own) item.ownWordsKey = own;
      }
      return item;
    });

    const missing = missingRequired(row.licenceType, answers);
    const missingSet = new Set(missing);
    const sectionOfKey = new Map(items.map((i) => [i.key, i.section]));

    const sections: SheetSection[] = SECTIONS.map((s) => ({
      ...s,
      missing: missing.filter((k) => sectionOfKey.get(k) === s.id),
    }));

    // ⚠️ A REQUIRED KEY WITH NO SHEET SECTION WOULD BE UNREACHABLE — a member
    // told something is outstanding with nowhere on the page to answer it,
    // which is the exact failure frontend/lib/wizard-coverage.spec.ts was
    // written for. SECTION_OF falls back to 'case' precisely so this cannot
    // happen; the assertion is here so a future section name that nobody maps
    // fails loudly in a spec rather than quietly on somebody's application.
    const homeless = missing.filter((k) => !sectionOfKey.has(k));
    if (homeless.length) {
      throw new Error(
        `Sheet has required keys with no section: ${homeless.join(', ')}`,
      );
    }

    // Where the seller's half stands, for the coverage below. One copy, on the
    // shared service — see its own note about the two screens that disagreed.
    const seller = await this.shared.sellerState(row.id);

    const annexures = buildAnnexures((row.uploads ?? []).map((u) => u.kind));
    const byKind = new Map(annexures.map((a) => [a.kind, a.letter]));

    const credentials = await this.credentialsFor(user.id, answers, {
      uploads: row.uploads ?? [],
      letterFor: (kind: string) => byKind.get(kind as never) ?? null,
    });

    return {
      application: {
        id: row.id,
        referenceNumber: row.referenceNumber,
        licenceType: row.licenceType,
        licenceTypeLabel: LICENCE_TYPE_LABELS[row.licenceType],
        label: row.label,
        status: row.status,
        declarationAcceptedAt: row.declarationAcceptedAt
          ? row.declarationAcceptedAt.toISOString()
          : null,
      },
      sections,
      items,
      documents: (row.uploads ?? []).map((u) => ({
        id: u.id,
        kind: u.kind,
        letter: byKind.get(u.kind) ?? null,
        // ⚠️ THE MEMBER'S WORDS, NOT THE ENUM'S. This shipped as `u.kind`,
        // so the shelf rendered "ADDRESS_CONFIRMATION" and
        // "PROFICIENCY_CERTIFICATE" — clipped to "ADDRESS_CO" in a 72px tile.
        // UPLOAD_KIND_LABELS is the one place those names are written for a
        // person and it is already imported for the annexures.
        label: UPLOAD_KIND_LABELS[u.kind] ?? u.kind,
        mime: u.mimeType,
        // Gold, not red: a document we could not read is still attached and
        // still goes in the pack. It is a "look at this", never a failure.
        state: u.extractionOk ? ('read' as const) : ('check' as const),
        /**
         * ⚠️ DERIVED, NOT STORED, AND `sourceCredentialId` IS ALREADY THE
         * ANSWER. A page copied in from the Document Centre carries the
         * credential it came from; one the member scanned or uploaded here
         * carries null. No column and no migration — the fact was on the row
         * the whole time, it had simply never been shown.
         *
         * Operator, 2026-09-08: "indicate where a document origin is from,
         * Added by License centre or User added."
         *
         * ⚠️ AND IT DECIDES WHO IS OFFERED THE SAVE. Only a `member` document
         * can be saved INTO the Centre; a `vault` one is already there, and
         * offering to save it again is an invitation to make a duplicate.
         */
        origin: u.sourceCredentialId
          ? ('vault' as const)
          : ('member' as const),
      })),
      needs: documentStatus(
        row.licenceType,
        /**
         * ⚠️ kind AND coversKinds, WHICH THIS ONE CALLER WAS DROPPING. One
         * membership certificate is both the association card and the letter
         * of good standing — that is why DEDICATED_DISCIPLINE maps to both
         * upload kinds, and why the vault records the second role in
         * `coversKinds`. Counting only `kind` leaves the review sheet asking
         * for a paper already in the pack.
         *
         * Operator, 2026-09-09: "it askes for my letter of good standing if my
         * status says its valid until next year." Their MO000075 carries
         * exactly one such row — ASSOCIATION_CARD with {GOOD_STANDING_LETTER}
         * against it — and the sheet was reading past the second half of it.
         *
         * ⚠️ THE OTHER TWO CALLERS ALREADY DID THIS and say so in as many
         * words (motivation-documents.service.ts, motivation-generation
         * .service.ts). The sheet is the surface the member actually reads,
         * so it was the one place the mistake was visible.
         *
         * ⚠️ buildAnnexures STILL SEES `kind` ALONE, deliberately: the
         * document gets ONE annexure letter, because it is one page.
         */
        (row.uploads ?? []).flatMap((u) => [u.kind, ...(u.coversKinds ?? [])]),
        answers,
      ),
      credentials,
      // ⚠️ WITH THE SELLER, WHICH THIS SHIPPED WITHOUT. saps271Coverage only
      // pushes section F when it is TOLD where the seller's half stands, so
      // with no context the sheet had no F row at all: the pack meter showed
      // no "Current owner" line, and `sellerSigned` in the page — which reads
      // F.done — was false however signed the consent was. A seller signed at
      // 12:02 and the line under the panel still read "When they sign…".
      coverage: saps271Coverage(row.licenceType, answers, {
        seller: { status: seller.status, name: seller.name },
      }),
      overlap,
      preview: previewFor(row.licenceType, answers).sections,
      missing: [...missingSet],
      ownedRows: ownedRowsFor(answers),
    };
  }

  /** The preview alone — the drawer refetches this on every saved answer. */
  async previewOnly(clerkId: string, id: string): Promise<PreviewSection[]> {
    const user = await this.shared.requireUser(clerkId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: { licenceType: true, answersEncrypted: true },
    });
    if (!row) throw new NotFoundException('Motivation not found');

    const profile = await this.profileAnswers.readFor(user.id);
    const answers = {
      ...profile.answers,
      ...this.shared.readAnswers(row.answersEncrypted),
    };
    return previewFor(row.licenceType, answers).sections;
  }
}
