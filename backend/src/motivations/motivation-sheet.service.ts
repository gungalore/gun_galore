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
  OWNED_SECTION,
  PREMISES_SECTION,
  fieldsFor,
  isVisible,
  missingRequired,
} from './motivation-fields';
import { ServedField, expandFields } from './motivation-field-options';
import { UPLOAD_KIND_LABELS, buildAnnexures } from './motivation-checklist';
import { documentStatus } from './motivation-documents';
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
    title: 'Competency',
    blurb: 'Read off your certificates — there is usually nothing to do here.',
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
    blurb: 'Six questions everybody is asked, and answering "no" adds nothing to your motivation.',
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
  ): SheetItemState {
    if (!isVisible(field, answers)) return 'na';
    if (!answerValue(answers[field.key] ?? '').trim()) return 'needs_you';
    return provenance[field.key]?.inferred ? 'suggested' : 'filled';
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
        answersEncrypted: true,
        answerProvenance: true,
        uploads: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            kind: true,
            mimeType: true,
            extractionOk: true,
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

    const served = expandFields(fieldsFor(row.licenceType));

    const items: SheetItem[] = served.map((f) => {
      const state = this.stateOf(f, answers, provenance);
      const item: SheetItem = {
        key: f.key,
        label: f.label,
        kind: f.kind,
        state,
        // ⚠️ IN FULL. See the masking note at the top of this file.
        value: answerValue(answers[f.key] ?? ''),
        provenance: provenance[f.key] ?? null,
        section: SECTION_OF[f.section] ?? 'case',
        scope: f.scope ?? 'application',
        required: !!f.required,
      };
      if (f.help) item.help = f.help;
      if (f.options) item.options = f.options;
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

    const annexures = buildAnnexures((row.uploads ?? []).map((u) => u.kind));
    const byKind = new Map(annexures.map((a) => [a.kind, a.letter]));

    return {
      application: {
        id: row.id,
        referenceNumber: row.referenceNumber,
        licenceType: row.licenceType,
        licenceTypeLabel: LICENCE_TYPE_LABELS[row.licenceType],
        label: row.label,
        status: row.status,
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
      })),
      needs: documentStatus(
        row.licenceType,
        (row.uploads ?? []).map((u) => u.kind),
        answers,
      ),
      coverage: saps271Coverage(row.licenceType, answers),
      overlap: overlapFromAnswers(row.licenceType, answers),
      preview: previewFor(row.licenceType, answers).sections,
      missing: [...missingSet],
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
