import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MotivationLicenceType, MotivationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../common/llm/llm.service';
import { encryptText, tryDecryptText } from '../../common/blob-crypto';
import {
  parseProvenance,
  type ProvenanceMap,
} from '../../common/answer-provenance';
import {
  EDITABLE,
  MotivationSharedService,
} from '../motivation-shared.service';
import {
  MotivationSheetService,
  type SheetResponse,
} from '../motivation-sheet.service';
import { MotivationDocumentsService } from '../motivation-documents.service';
import { MotivationsService } from '../motivations.service';
import {
  fieldByKey,
  fieldsFor,
  LICENCE_TYPE_LABELS,
  type MotivationField,
} from '../motivation-fields';
import {
  applicationBlockers,
  firearmShape,
} from '../motivation-eligibility';
import { containerById, type EvidenceGroup } from '../evidence-taxonomy';
import {
  pendingFields,
  planGroup,
  planQuestion,
  purposeForAnswers,
  questionForField,
} from './intake-planner';
import { strategyFor } from './intake-strategies';
import {
  normaliseOutputMode,
  type MotivationOutputMode,
} from '../motivation-output';
import {
  MIN_HISTORY_WORDS,
  missingDetail,
  missingDetailMessage,
} from '../motivation-completeness';
import {
  MotivationIntakeAgentService,
  type InterviewAgentContext,
} from './intake-agent.service';
import type { FactCandidate } from './intake-agent.prompts';
import {
  HISTORY_CHOICES,
  addCustomChoice,
  exerciseChoices,
  historyAnswerWords,
  normaliseChoices,
} from './intake-choices';
import {
  correctionFor,
  isCorrectableField,
  parseIntakeReply,
} from './intake-reply';
import {
  INTAKE_SCHEMA,
  SPECIES_SCHEMA,
  intakeSystemPrompt,
  intakeUserPrompt,
  speciesSystemPrompt,
  speciesUserPrompt,
} from './intake-prompts';
import type {
  IntakeBlocked,
  IntakeChoice,
  IntakeDocumentItem,
  IntakeGroup,
  IntakeMode,
  IntakeQuestion,
  IntakeState,
  IntakeTopicId,
  IntakeTopicState,
  TickState,
} from './intake.types';
import {
  TOPIC_DOCUMENTS,
  TOPIC_TITLES,
  topicForField,
  topicsFor,
} from './intake-topics';

const INTERVIEW_VERSION = '2026-10-29a';
const MAX_TRANSCRIPT = 40;
/** How many grouped questions are phrased at once. */
const GROUP_CONCURRENCY = 4;


/**
 * Only these fields may be rewritten by a spelling correction — see
 * intake-reply.ts, which owns the whitelist because the one-shot path now
 * produces corrections as well as the agent path.
 */

interface TranscriptMessage {
  role: 'assistant' | 'user';
  text: string;
  at: string;
}

interface Transcript {
  version: string;
  messages: TranscriptMessage[];
}

interface IntakeRow {
  id: string;
  referenceNumber: string;
  licenceType: MotivationLicenceType;
  answersEncrypted: string | null;
  intakeMode: string | null;
  outputMode: string;
  intakeStartedAt: Date | null;
  intakeDocumentsAt: Date | null;
  intakeCompletedAt: Date | null;
  interviewEncrypted: string | null;
  answerProvenance: unknown;
  status: MotivationStatus;
}

@Injectable()
export class MotivationIntakeService {
  private readonly logger = new Logger(MotivationIntakeService.name);
  /** Calibre -> species suggestions, kept for an hour. Cheap, not a cache table. */
  private readonly speciesCache = new Map<
    string,
    { at: number; choices: IntakeChoice[] }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly shared: MotivationSharedService,
    private readonly sheets: MotivationSheetService,
    private readonly documents: MotivationDocumentsService,
    private readonly motivations: MotivationsService,
    private readonly agent: MotivationIntakeAgentService,
  ) {}

  async state(userId: string, id: string): Promise<IntakeState> {
    return this.stateInternal(userId, id);
  }

  private async stateInternal(
    userId: string,
    id: string,
    previousAnswer: string | null = null,
    previousQuestion: string | null = null,
    previousFieldKey: string | null = null,
  ): Promise<IntakeState> {
    const row = await this.load(userId, id);
    const sheet = await this.sheets.sheetFor(userId, id);
    const answers = await this.shared.answersFor(userId, row.answersEncrypted);
    const library = await this.documents.library(userId, id);
    const strategy = strategyFor(row.licenceType);
    const motivationOnly =
      normaliseOutputMode(row.outputMode) === 'MOTIVATION_ONLY';
    const blocked = this.blockedFor(row.licenceType, answers);

    const inInterview = Boolean(
      !blocked &&
        row.intakeMode === 'INTERVIEW' &&
        row.intakeDocumentsAt &&
        !row.intakeCompletedAt,
    );
    const grouped = inInterview
      ? await this.phrasedGroup(
          row,
          sheet,
          answers,
          previousAnswer,
          previousQuestion,
          previousFieldKey,
          library,
        )
      : null;
    const phrased = grouped
      ? {
          question: grouped.questions[0],
          acknowledgement: grouped.acknowledgement,
          correction: grouped.correction,
        }
      : null;
    const question = phrased?.question ?? null;
    const group: IntakeGroup | null = grouped
      ? { ...grouped.group, questions: grouped.questions }
      : null;

    /**
     * âš ï¸ A CORRECTION IS SAVED, NOT JUST SPOKEN. The next question says
     * "Mauser" even when the applicant typed "Mausser"; storing the same
     * correction is what stops the misspelling reaching the DFO's pack. The
     * whitelist and the small-edit guard are in `spellingFix` below â€” a model
     * suggestion never touches an address, an ID number or a declaration.
     */
    if (
      phrased?.correction &&
      previousFieldKey &&
      isCorrectableField(previousFieldKey)
    ) {
      const original = (answers[previousFieldKey] ?? '').trim();
      if (this.spellingFix(original, phrased.correction)) {
        try {
          await this.motivations.saveAnswers(userId, id, {
            [previousFieldKey]: phrased.correction,
          });
        } catch (err) {
          this.logger.warn(
            `Intake ${row.id}: spelling correction could not be saved â€” ${
              (err as Error).message
            }`,
          );
        }
      }
    }


    const documents = this.documentState(sheet, library, answers);
    const evidence = this.evidenceState(library, row.licenceType, answers);
    const topic = this.topicState(
      sheet,
      documents,
      answers,
      question,
      motivationOnly,
      row.licenceType,
    );
    /**
     * âš ï¸ THE INTERVIEW IS NOT "OVER" WHILE A DFO DOCUMENT IS OUTSTANDING.
     * With no question left, stage REVIEW sent the member to the sheet with
     * "3 things left" and no way back to the upload drawer they had just been
     * using. Keeping the stage at INTERVIEW renders the completion screen,
     * where the documents can still be added before they choose Review.
     */
    const requiredDocsMissing =
      !motivationOnly &&
      documents.needs.some(
        (need) => need.tier === 'required' && !need.have,
      );

    /**
     * ⚠️ THE INTERVIEW IS NOT OVER WHILE THE DOCUMENT'S ARGUMENTS ARE MISSING.
     *
     * Operator, 2026-11-05: "I should not stop the interview until it has all
     * the required information." The stage used to fall to REVIEW as soon as
     * no question was left, which offered "write the motivation" and then let
     * generation refuse with "it still needs your shooting history" — the gate
     * firing after the member had been told they were done.
     *
     * `missingDetail` is the same list the generation gate throws on, so the
     * two can never disagree. A completed row is reopened the same way: an
     * application finished before these facts existed comes back to the
     * interview rather than failing at the write step.
     */
    const needsDetail = missingDetail(answers, row.licenceType);
    const detailMissing = needsDetail.length > 0;

    const stage: IntakeState['stage'] = blocked
      ? 'BLOCKED'
      : !row.intakeMode
        ? 'MODE'
        : row.intakeCompletedAt
          ? detailMissing
            ? 'INTERVIEW'
            : 'REVIEW'
          : !row.intakeDocumentsAt
            ? 'DOCUMENTS'
            : row.intakeMode === 'DOCUMENTS'
              ? 'REVIEW'
              : question || requiredDocsMissing || detailMissing
                ? 'INTERVIEW'
                : 'REVIEW';

    return {
      motivationId: row.id,
      referenceNumber: row.referenceNumber,
      licenceType: row.licenceType,
      licenceTypeLabel: sheet.application.licenceTypeLabel,
      mode: (row.intakeMode as IntakeMode | null) ?? null,
      outputMode: normaliseOutputMode(row.outputMode),
      stage,
      blocked,
      summary: blocked?.message ?? strategy.intro,
      topic,
      group,
      /**
       * ⚠️ THE SAME LIST THE GENERATION GATE REFUSES ON. Computed here so the
       * interview can say what is still missing before the member presses
       * Generate, rather than an SMS afterwards.
       */
      needsDetail,
      vaultEmpty: !(library.items ?? []).some((i) => i.source === 'credential'),
      documents,
      evidence,
      question,
      acknowledgement: phrased?.acknowledgement,
      progress: {
        answered: question?.progress.answered ?? 0,
        total: question?.progress.total ?? 0,
        sections: sheet.sections.map((s) => ({
          id: s.id,
          title: s.title,
          missing: s.missing.length,
        })),
      },
    };
  }

  async start(
    userId: string,
    id: string,
    mode: IntakeMode,
  ): Promise<IntakeState> {
    const row = await this.load(userId, id);
    this.assertEditable(row);
    if (mode !== 'DOCUMENTS' && mode !== 'INTERVIEW') {
      throw new BadRequestException('Choose how you want to build this application.');
    }
    await this.prisma.motivation.update({
      where: { id: row.id },
      data: {
        intakeMode: mode,
        intakeStartedAt: new Date(),
        /**
         * ⚠️ THE INTERVIEW STARTS DIRECTLY. The old DOCUMENTS stage made the
         * member choose from the whole vault before the interview knew which
         * section or firearm it was about. Documents are now attached per
         * topic as the interview reaches them.
         */
        intakeDocumentsAt: mode === 'INTERVIEW' ? new Date() : null,
        intakeCompletedAt: null,
        ...(mode === 'INTERVIEW'
          ? {
              interviewEncrypted: encryptText(
                JSON.stringify({
                  version: INTERVIEW_VERSION,
                  messages: [],
                } satisfies Transcript),
              ),
              interviewVersion: INTERVIEW_VERSION,
            }
          : {}),
      },
    });
    /**
     * ⚠️ DO NOT AUTOLINK THE WHOLE VAULT HERE. Starting the interview must be
     * instant. This was reading and attaching every licence before returning,
     * so the Start button sat doing nothing for minutes. Documents are taken
     * as topics reach them (and after the firearm is known).
     */
    return this.state(userId, id);
  }

  /**
   * Choose what this application must produce.
   *
   * This is deliberately separate from `start`: the member picks the
   * deliverable before they pick how they want to build it, and may change
   * their mind while the draft is still editable.
   */
  async setOutputMode(
    userId: string,
    id: string,
    outputMode: string,
  ): Promise<IntakeState> {
    const row = await this.load(userId, id);
    this.assertEditable(row);
    const next = normaliseOutputMode(outputMode);
    if (
      outputMode !== 'PRINT_READY' &&
      outputMode !== 'MOTIVATION_ONLY'
    ) {
      throw new BadRequestException('Choose what you need us to produce.');
    }
    await this.prisma.motivation.update({
      where: { id: row.id },
      data: { outputMode: next },
    });
    return this.state(userId, id);
  }

  /**
   * Change the section on an ungenerated draft, keeping the applicant's answers
   * and documents. This is the way out of "I chose a .30-06 but the application
   * is section 13": the interview blocks, the member picks a lawful section,
   * and the same facts are re-used instead of retyped.
   */
  async changeSection(
    userId: string,
    id: string,
    licenceType: string,
  ): Promise<IntakeState> {
    const row = await this.load(userId, id);
    this.assertEditable(row);
    const next = licenceType as MotivationLicenceType;
    if (!Object.values(MotivationLicenceType).includes(next)) {
      throw new BadRequestException('That is not a licence section we support.');
    }
    if (next === row.licenceType) return this.state(userId, id);
    try {
      await this.prisma.motivation.update({
        where: { id: row.id },
        data: {
          licenceType: next,
          intakeCompletedAt: null,
          // Keep the document selection: an ID, a competency certificate and
          // the applicant's own licences are section-agnostic.
        },
      });
    } catch (err) {
      this.logger.warn(
        `Intake ${row.id}: could not change section to ${next} â€” ${(err as Error).message}`,
      );
      throw new ConflictException(
        'You already have an application of that type. Open it from your applications list instead.',
      );
    }
    return this.state(userId, id);
  }

  async selectDocuments(
    userId: string,
    id: string,
    body: {
      items?: { source: 'credential' | 'upload'; sourceId: string }[];
      placeConfirmed?: boolean;
    },
  ): Promise<IntakeState> {
    const row = await this.load(userId, id);
    this.assertEditable(row);
    for (const item of body.items ?? []) {
      if (!item?.sourceId) continue;
      try {
        await this.documents.addFromLibrary(
          userId,
          id,
          item.source,
          item.sourceId,
          body.placeConfirmed === true,
        );
      } catch (err) {
        this.logger.warn(
          `Intake ${row.id}: could not attach ${item.source}:${item.sourceId} â€” ${
            (err as Error).message
          }`,
        );
      }
    }
    if (row.intakeMode === 'DOCUMENTS') {
      await this.prisma.motivation.update({
        where: { id: row.id },
        data: { intakeDocumentsAt: new Date(), intakeCompletedAt: new Date() },
      });
    } else {
      await this.prisma.motivation.update({
        where: { id: row.id },
        data: { intakeDocumentsAt: new Date() },
      });
    }
    return this.state(userId, id);
  }

  /**
   * Turn ONE submitted answer into the patch it would write, after validating
   * it exactly as the single-answer path always has.
   *
   * ⚠️ THIS IS SHARED BY BOTH PATHS ON PURPOSE. A batch that validated
   * differently would let a grouped answer store something a single answer
   * refuses, and the member would never see why. The body below is the body
   * the single-answer path always ran.
   */
  private async patchForAnswer(args: {
    row: IntakeRow;
    sheet: SheetResponse;
    answers: Record<string, string>;
    current: IntakeQuestion;
    key: string;
    field: MotivationField;
    body: {
      value?: string;
      values?: string[];
      message?: string;
      fields?: Record<string, string>;
    };
  }): Promise<Record<string, string>> {
    const { row, sheet, answers, current, key, field, body } = args;

    /**
     * ⚠️ A THIN HISTORY IS REJECTED AT THE DOOR, NOT SILENTLY KEPT PENDING.
     *
     * Keeping it pending made the next group return the same question, and the
     * card reads a returning question as "we could not save that answer" — the
     * member is told the save failed when it worked and the answer was simply
     * too short. A rejection carries the real reason instead.
     *
     * ⚠️ AND THE TICKS COUNT. Only the typed text used to be measured, so two
     * ticked statements scored zero; a member who answered by tapping was told
     * he had said nothing. The floor is now twelve words, not sixty, because
     * the section is WRITTEN from these facts — sixty words of typing is not
     * what supplies them.
     */
    if (key === 'shooting_history') {
      const words = historyAnswerWords(body.values, body.message ?? body.value);
      if (words > 0 && words < MIN_HISTORY_WORDS) {
        throw new BadRequestException(
          'Please give us a little more — who introduced you, what you shoot and how often. ' +
            'Tick what is true for you, or add a sentence.',
        );
      }
    }

const sourceText = (body.message ?? body.value ?? '').trim();
    let extracted: Record<string, string> = {};
    if (
      sourceText &&
      !field.sensitive &&
      !field.formOnly &&
      sourceText.split(/\s+/).length > 1
    ) {
      const candidates: FactCandidate[] = [];
      for (const pending of pendingFields({
        type: row.licenceType,
        answers,
        sheet,
        provenance: parseProvenance(row.answerProvenance),
      })) {
        const pendingField = pending.field;
        if (pendingField.sensitive || pendingField.formOnly) continue;
        const choices =
          pending.key === key
            ? current.choices
            : pendingField.kind === 'cards'
              ? (pendingField.options ?? []).map((option) => ({
                  value: option.key,
                  label: option.sentence,
                }))
              : (pendingField.choices ??
                (pendingField.kind === 'yesno' ? ['Yes', 'No'] : [])
              ).map((choice) => ({ value: choice, label: choice }));
        candidates.push({
          key: pending.key,
          label: pendingField.label,
          kind: pendingField.kind,
          help: pendingField.help,
          choices,
        });
      }
      if (!candidates.some((candidate) => candidate.key === key)) {
        candidates.push({
          key,
          label: current.label,
          kind: current.kind,
          help: current.help,
          choices: current.choices,
        });
      }
      extracted = await this.agent.extractFacts({
        text: sourceText,
        currentKey: key,
        candidates,
      });
    }

    const patch: Record<string, string> = {};
    if (Array.isArray(body.values)) {
      patch[key] = body.values.join(', ');
    } else if (typeof body.value === 'string') {
      patch[key] = body.value;
    }
    for (const [detailKey, detailValue] of Object.entries(body.fields ?? {})) {
      if (typeof detailValue !== 'string') continue;
      if (!fieldByKey(row.licenceType, detailKey)) continue;
      patch[detailKey] = detailValue;
    }

    const message = (body.message ?? '').trim();
    if (message) {
      if (field.kind === 'short' || field.kind === 'long') {
        /**
         * ⚠️ A TYPED ANSWER ADDS TO THE BUTTONS HERE TOO. This branch used to
         * assign the typed text over the ticked values, so on the one long
         * field that carries chips - the shooting history - ticking "A friend
         * introduced me" and then typing the rest threw the tick away.
         */
        patch[key] = patch[key] ? addCustomChoice(patch[key], message) : message;
      } else {
        const matched = this.matchChoices(current.choices, message);
        if (matched.length) {
          const existing = (patch[key] ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          patch[key] = [...new Set([...existing, ...matched])].join(', ');
        } else {
          const customKey = strategyFor(row.licenceType).customKeys[key];
          if (!customKey) {
            throw new BadRequestException(
              'Choose one of the options, or type a different answer.',
            );
          }
          /**
           * ⚠️ A TYPED ANSWER ADDS TO THE BUTTONS, IT DOES NOT REPLACE THEM.
           *
           * MO000059 ticked a species chip and then typed "snakes" in the same
           * answer. The chip was written into the field, then this branch
           * assigned the typed text to the same field — because that field's
           * custom key IS the field — and the tick was gone. The document then
           * had one quarry where the applicant had named two, and the exhibits
           * fell back to whatever the calibre research suggested.
           */
          if (customKey === key) {
            patch[key] = addCustomChoice(patch[key], message);
          } else {
            patch[customKey] = message;
          }
        }
      }
    }

    /**
     * The current field gets the extractor's focused value for a free-text
     * answer ("Mauser M96 .30-06" -> make "Mauser"), while every OTHER fact it
     * found is added beside it. The whole sentence is not lost: if the
     * extractor returned nothing for the current key, the typed text stands.
     */
    for (const [extractedKey, extractedValue] of Object.entries(extracted)) {
      if (!fieldByKey(row.licenceType, extractedKey)) continue;
      if (extractedKey === key) {
        if (field.kind === 'short' || field.kind === 'long') {
          patch[key] = extractedValue;
        }
      } else if (!(extractedKey in patch)) {
        patch[extractedKey] = extractedValue;
      }
    }

    if (!Object.keys(patch).length) {
      throw new BadRequestException('Choose an answer or type one in.');
    }

    return patch;
  }

  async answer(
    userId: string,
    id: string,
    body: {
      fieldKey?: string;
      value?: string;
      values?: string[];
      message?: string;
      /** Declaration follow-ups submitted with a Yes answer. */
      fields?: Record<string, string>;
    },
  ): Promise<IntakeState & { acknowledgement?: string }> {
    const row = await this.load(userId, id);
    this.assertEditable(row);
    if (row.intakeMode !== 'INTERVIEW') {
      throw new ConflictException('Start the guided interview first.');
    }
    if (!row.intakeDocumentsAt) {
      throw new ConflictException('Confirm your documents before the interview.');
    }
    if (row.intakeCompletedAt) {
      throw new ConflictException('This application is already at the review stage.');
    }

    const sheet = await this.sheets.sheetFor(userId, id);
    const answers = await this.shared.answersFor(userId, row.answersEncrypted);
    const blocked = this.blockedFor(row.licenceType, answers);
    if (blocked) throw new ConflictException(blocked.message);
    const current = planQuestion({
      type: row.licenceType,
      answers,
      sheet,
      provenance: parseProvenance(row.answerProvenance),
    });
    if (!current) {
      await this.finish(userId, id);
      return this.state(userId, id);
    }

    const key = (body.fieldKey ?? current.fieldKey).trim();
    if (key !== current.fieldKey) {
      throw new BadRequestException('That question has moved on; reload the interview.');
    }
    const field = fieldByKey(row.licenceType, key);
    if (!field) throw new BadRequestException('Unknown question.');

    /**
     * âš ï¸ ONE TURN CAN ANSWER SEVERAL FIELDS. A person says "Mauser M96
     * straight-pull in .30-06" to the make question and expects the model and
     * calibre to land too. The extractor only sees visible, unanswered,
     * non-sensitive fields, and every value is validated below before it can be
     * saved. It is fail-soft: no model, no text, or an unparseable answer just
     * leaves the ordinary single-field path.
     */
    const patch = await this.patchForAnswer({
      row,
      sheet,
      answers,
      current,
      key,
      field,
      body,
    });

    const corePatch = { ...patch };
    this.composePurposeFields(row.licenceType, patch, answers);

    let saved = await this.motivations.saveAnswers(userId, id, patch);
    if (saved.refused.length) {
      // One bad extra must not cost the answer the applicant actually gave.
      saved = await this.motivations.saveAnswers(userId, id, corePatch);
    }
    if (saved.refused.length) {
      throw new BadRequestException(
        'That answer did not fit the question. Please choose one of the options.',
      );
    }

    // The router and the quarry are confirmed once per application even when
    // a profile or an earlier application supplied the same value. saveAnswers
    // only stamps MEMBER for a value that MOVED, so an unchanged confirmation
    // needs its own stamp or the planner asks it again on the next turn.
    if (key === 'intended_quarry' || key === 'firearm_use_kind') {
      try {
        await this.motivations.confirmAnswer(userId, id, key);
      } catch (err) {
        this.logger.warn(
          `Intake ${row.id}: confirmation of ${key} could not be recorded �?" ${(err as Error).message}`,
        );
      }
    }

    /**
     * ⚠️ AS SOON AS THE FIREARM IS KNOWN, LOOK FOR ITS CERTIFICATES.
     *
     * Autolink runs once per application and the firearm type is almost never
     * answered when the application opens. Waiting for a later screen means
     * the member answers competency questions by hand even though the right
     * certificate is already in their vault, and the 117705 knowledge page may
     * never be attached. saveAnswers re-arms autolinkedAt when the required
     * endorsement moves, so this is the trigger that was missing.
     *
     * Fail-soft: a vault lookup that fails must not cost the answer just given.
     */
    if (key === 'firearm_type' || key === 'firearm_action') {
      try {
        await this.motivations.autolink(userId, id);
      } catch (err) {
        this.logger.warn(
          `Intake ${row.id}: certificate autolink after ${key} failed �?" ${(err as Error).message}`,
        );
      }
    }
    const userText = current.sensitive
      ? 'Answered privately.'
      : Object.values(patch).join(' ');
    await this.appendTranscript(row.id, [
      {
        role: 'assistant',
        text: current.label.slice(0, 500),
        at: new Date().toISOString(),
      },
      {
        role: 'user',
        text: userText.slice(0, 500),
        at: new Date().toISOString(),
      },
    ]);

    const state = await this.stateInternal(
      userId,
      id,
      userText,
      current.label,
      current.fieldKey,
    );
    return { ...state };
  }

  /**
   * ANSWER A WHOLE GROUP IN ONE TURN.
   *
   * ⚠️ VALIDATE EVERYTHING, THEN WRITE ONCE. Each answer goes through the
   * same patch builder the single-answer path uses, so a grouped answer can
   * never store something a single answer would refuse. Nothing is written
   * until every submitted answer has passed, and a refusal names the field.
   *
   * ⚠️ ONE STATE AT THE END. Six answers each rebuilding the interview state
   * is six model rounds for one tap; the member waits once.
   */
  async answerBatch(
    userId: string,
    id: string,
    items: {
      fieldKey?: string;
      value?: string;
      values?: string[];
      message?: string;
      fields?: Record<string, string>;
    }[],
  ): Promise<IntakeState & { acknowledgement?: string }> {
    const row = await this.load(userId, id);
    this.assertEditable(row);
    if (row.intakeMode !== 'INTERVIEW') {
      throw new ConflictException('Start the guided interview first.');
    }
    if (!row.intakeDocumentsAt) {
      throw new ConflictException('Confirm your documents before the interview.');
    }
    if (row.intakeCompletedAt) {
      throw new ConflictException('This application is already at the review stage.');
    }
    if (!Array.isArray(items) || !items.length) {
      throw new BadRequestException('Answer at least one question.');
    }

    const sheet = await this.sheets.sheetFor(userId, id);
    const answers = await this.shared.answersFor(userId, row.answersEncrypted);
    const blocked = this.blockedFor(row.licenceType, answers);
    if (blocked) throw new ConflictException(blocked.message);

    const input = {
      type: row.licenceType,
      answers,
      sheet,
      provenance: parseProvenance(row.answerProvenance),
    };
    const plan = planGroup(input);
    if (!plan) {
      await this.finish(userId, id);
      return this.state(userId, id);
    }
    const allowed = new Set(plan.questions.map((q) => q.key));

    const patch: Record<string, string> = {};
    const seen = new Set<string>();
    for (const item of items) {
      const key = (item.fieldKey ?? '').trim();
      if (!key) {
        throw new BadRequestException('Every answer needs a fieldKey.');
      }
      if (!allowed.has(key)) {
        throw new BadRequestException(
          `"${key}" is not part of this group; reload the interview.`,
        );
      }
      if (seen.has(key)) {
        throw new BadRequestException(`"${key}" was answered twice.`);
      }
      const current = questionForField(input, key);
      const field = fieldByKey(row.licenceType, key);
      if (!current || !field) {
        throw new BadRequestException(
          `"${key}" is not a question any more; reload the interview.`,
        );
      }
      seen.add(key);
      /**
       * ⚠️ NO FIELD KEY IN FRONT OF THE REASON. The batch used to wrap every
       * refusal as `"shooting_history": Please give us a little more…`, and
       * that raw key was the first thing a member read on screen. One question
       * is on screen at a time now, so the message can speak for itself.
       */
      const own = await this.patchForAnswer({
        row,
        sheet,
        answers: { ...answers, ...patch },
        current,
        key,
        field,
        body: item,
      });
      Object.assign(patch, own);
    }
    if (!Object.keys(patch).length) {
      throw new BadRequestException('Choose an answer or type one in.');
    }

    const corePatch = { ...patch };
    this.composePurposeFields(row.licenceType, patch, answers);

    let saved = await this.motivations.saveAnswers(userId, id, patch);
    if (saved.refused.length) {
      saved = await this.motivations.saveAnswers(userId, id, corePatch);
    }
    if (saved.refused.length) {
      throw new BadRequestException(
        'That answer did not fit the question. Please choose one of the options.',
      );
    }

    for (const key of seen) {
      if (key === 'intended_quarry' || key === 'firearm_use_kind') {
        try {
          await this.motivations.confirmAnswer(userId, id, key);
        } catch (err) {
          this.logger.warn(
            `Intake ${row.id}: confirmation of ${key} could not be recorded — ${(err as Error).message}`,
          );
        }
      }
    }
    if (seen.has('firearm_type') || seen.has('firearm_action')) {
      try {
        await this.motivations.autolink(userId, id);
      } catch (err) {
        this.logger.warn(
          `Intake ${row.id}: certificate autolink after a group failed — ${(err as Error).message}`,
        );
      }
    }

    const first = plan.questions[0];
    const firstLabel = first
      ? questionForField(input, first.key)?.label ?? first.key
      : 'Answers';
    const userText = Object.values(corePatch).join(' ').slice(0, 500);
    /**
     * ⚠️ THE TRANSCRIPT IS BOOKKEEPING, NOT THE ANSWER. A transcript that
     * cannot be written must never cost a group the member has just filled in.
     */
    try {
      await this.appendTranscript(row.id, [
        {
          role: 'assistant',
          text: `${plan.title} — ${plan.questions.length} questions`.slice(
            0,
            500,
          ),
          at: new Date().toISOString(),
        },
        {
          role: 'user',
          text: userText,
          at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      this.logger.warn(
        `Intake ${row.id}: the group transcript could not be written — ${(err as Error).message}`,
      );
    }

    const state = await this.stateInternal(
      userId,
      id,
      userText,
      firstLabel,
      first?.key ?? null,
    );
    return { ...state };
  }

  async finish(userId: string, id: string): Promise<IntakeState> {
    const row = await this.load(userId, id);
    this.assertEditable(row);
    /**
     * ⚠️ THE INTERVIEW CANNOT BE CLOSED WHILE A FACT THE DOCUMENT NEEDS IS
     * MISSING. Without this, "finish" marked the interview complete, the pack
     * page offered to write, and generation refused — the member was told they
     * were done and then told they were not. Same list, same words.
     */
    const answers = await this.shared.answersFor(userId, row.answersEncrypted);
    const gaps = missingDetail(answers, row.licenceType);
    if (gaps.length) {
      throw new ConflictException({
        message: missingDetailMessage(gaps),
        code: 'motivation-needs-detail',
        missingDetail: gaps,
      });
    }
    await this.prisma.motivation.update({
      where: { id: row.id },
      data: { intakeCompletedAt: new Date() },
    });
    return this.state(userId, id);
  }

  // â”€â”€ document + evidence state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private documentState(
    sheet: SheetResponse,
    library: Awaited<ReturnType<MotivationDocumentsService['library']>>,
    answers: Record<string, string>,
  ): IntakeState['documents'] {
    const firearmKnown =
      Boolean(answers.firearm_type?.trim()) &&
      Boolean(answers.firearm_action?.trim());
    const required = new Map(
      sheet.needs.needs
        .filter((n) => n.tier === 'required')
        .map((n) => [n.kind, n] as const),
    );
    const requiredMissing = new Set(
      sheet.needs.needs
        .filter((n) => n.tier === 'required' && !n.have)
        .map((n) => n.kind),
    );
    const suggested = new Set(
      (library.suggested ?? []).map((i) => `${i.source}:${i.sourceId}`),
    );

    const items: IntakeDocumentItem[] = (library.items ?? []).map((row) => {
      const need = required.get(row.kind);
      let tick: TickState = row.alreadyHere
        ? 'attached'
        : need && requiredMissing.has(row.kind)
          ? 'required'
          : suggested.has(`${row.source}:${row.sourceId}`)
            ? 'suggested'
            : 'optional';
      let tickReason: string | null = need?.why ?? null;
      if (row.caution?.tone === 'stale') {
        tick = 'blocked';
        tickReason = row.caution.text;
      }
      if (row.askPlace && tick !== 'attached') {
        tickReason =
          'Confirm these are the safe at the address on this application.';
      }
      return {
        source: row.source,
        sourceId: row.sourceId,
        kind: row.kind,
        title: row.title,
        addedOn: row.addedOn,
        alreadyHere: row.alreadyHere,
        caution: row.caution,
        askPlace: row.askPlace,
        evidenceType: row.evidenceType ?? null,
        evidencePlacement: row.evidencePlacement ?? null,
        tick,
        tickReason,
      };
    });

    const missing = sheet.needs.needs
      .filter(
        (n) =>
          n.tier === 'required' &&
          !n.have &&
          !items.some((i) => i.kind === n.kind),
      )
      .map((n) => ({ kind: n.kind, label: n.label, why: n.why }));

    /**
     * The ANNEXURE list the interview asks for. Required and expected only:
     * `strengthens` is evidence for the argument, not paperwork a DFO/CFR
     * expects at the counter. The frontend renders one row per document with
     * an upload door and an "enter details instead" door.
     */
    const needs = sheet.needs.needs
      .filter(
        (n) =>
          (n.tier === 'required' || n.tier === 'expected') &&
          (firearmKnown ||
            (n.kind !== 'PROFICIENCY_CERTIFICATE' &&
              n.kind !== 'ASSOCIATION_ENDORSEMENT')),
      )
      .map((n) => ({
        kind: n.kind,
        label: n.label,
        tier: n.tier,
        why: n.why,
        have: n.have,
        ...(n.minFiles ? { minFiles: n.minFiles, minFilesNote: n.minFilesNote } : {}),
      }));

    return {
      items,
      missing,
      needs,
      attached: items.filter((i) => i.alreadyHere).length,
      required: requiredMissing.size,
      sourceProofAttached: items.some(
        (i) =>
          i.alreadyHere &&
          (i.kind === 'FIREARM_SOURCE_PROOF' ||
            i.kind === 'SELLER_LICENCE'),
      ),
      firearmKnown,
    };
  }

  /**
   * The current topic, with what we already hold and what this step still
   * needs. The frontend renders the bullets and one question — never the whole
   * document library.
   */
  private topicState(
    sheet: SheetResponse,
    documents: IntakeState['documents'],
    answers: Record<string, string>,
    question: IntakeQuestion | null,
    motivationOnly: boolean,
    type: MotivationLicenceType,
  ): IntakeTopicState | null {
    if (!question) return null;
    const current = topicForField(question.fieldKey);
    const topics = topicsFor(
      type,
      answers,
      documents.needs.map((need) => need.kind),
    );
    const ordered = topics.includes(current) ? topics : [...topics, current];
    const fieldKeys = new Set(
      fieldsFor(type)
        .filter((field) => topicForField(field.key) === current)
        .map((field) => field.key),
    );
    const have = sheet.items
      .filter(
        (item) =>
          fieldKeys.has(item.key) &&
          item.value.trim().length > 0 &&
          item.state !== 'na',
      )
      .map((item) => ({
        label: item.label,
        value: item.value,
        from: item.provenance?.from ?? 'your details',
      }));
    const docKinds = new Set(TOPIC_DOCUMENTS[current] ?? []);
    const docs = documents.needs
      .filter((need) => docKinds.has(need.kind))
      .map((need) => ({
        kind: need.kind,
        label: need.label,
        have: need.have,
        required: !motivationOnly && need.tier === 'required',
      }));
    const missingRequired = docs.some((doc) => doc.required && !doc.have);
    return {
      id: current,
      title: TOPIC_TITLES[current],
      index: ordered.indexOf(current) + 1,
      total: ordered.length,
      status: missingRequired ? 'needs_document' : 'needs_answers',
      have,
      documents: docs,
      actions: ['upload', 'scan', 'manual'],
    };
  }

  private evidenceState(
    library: Awaited<ReturnType<MotivationDocumentsService['library']>>,
    type: MotivationLicenceType,
    answers: Record<string, string>,
  ): IntakeState['evidence'] {
    const strategy = strategyFor(type);
    const groups = strategy.evidenceGroups as EvidenceGroup[];
    const purpose = purposeForAnswers(type, answers);
    const items: IntakeDocumentItem[] = [];
    for (const row of library.items ?? []) {
      if (!row.evidenceType && row.kind !== 'EVIDENCE') continue;
      const group = containerById(row.evidenceType ?? '')?.group ?? 'other';
      if (!groups.includes(group)) continue;
      items.push({
        source: row.source,
        sourceId: row.sourceId,
        kind: row.kind,
        title: row.title,
        addedOn: row.addedOn,
        alreadyHere: row.alreadyHere,
        caution: row.caution,
        askPlace: row.askPlace,
        evidenceType: row.evidenceType ?? null,
        evidencePlacement: row.evidencePlacement ?? null,
        tick: row.alreadyHere ? 'attached' : 'suggested',
        tickReason: row.alreadyHere
          ? 'Already on this application.'
          : 'Suggested for this purpose.',
      });
    }

    const note =
      purpose === 'self-defence'
        ? 'Do you have an incident report, a CCTV still, or a photograph of the gate, fence or safe that you want to add? This is optional; the report is complete without it.'
        : purpose === 'sport'
          ? 'Do you have score sheets, range photographs, competition results or an attendance register from the discipline you actually shoot? Up to four body items are printed.'
          : purpose === 'continued use'
            ? 'Do you have a log or photographs showing how you have kept using the firearm? This is optional.'
            : 'Do you have hunting photographs, register pages, permits or a written invitation from a landowner? Up to four body items are printed.';
    const ready =
      strategy.purpose !== 'sporting' ||
      (answers.firearm_use_kind ?? '').trim() !== '';
    return { items, groups, note, ready };
  }

  // â”€â”€ model phrasing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Let Gemini turn the calibre into quarry choices. This is the one place the
   * interview actively researches the firearm for the applicant: a .30-06 gets
   * kudu/wildebeest/hartebeest/impala/warthog, not a generic species list.
   * Results are cached by calibre+type+action for an hour.
   */
  private async speciesChoices(
    answers: Record<string, string>,
  ): Promise<IntakeChoice[]> {
    const calibre = (answers.firearm_calibre ?? '').trim();
    if (!calibre || !this.llm.isConfigured()) return [];
    const type = (answers.firearm_type ?? '').trim();
    const action = (answers.firearm_action ?? '').trim();
    const key = `${calibre}|${type}|${action}`.toLowerCase();
    const hit = this.speciesCache.get(key);
    if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.choices;

    try {
      const res = await this.llm.complete({
        system: speciesSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: speciesUserPrompt({ calibre, type, action }),
          },
        ],
        maxTokens: 600,
        temperature: 0.3,
        purpose: 'motivation.interview',
        json: { schema: SPECIES_SCHEMA },
        timeoutMs: 15_000,
      });
      const parsed = JSON.parse(res.text) as {
        choices?: { value?: unknown; label?: unknown }[];
      };
      const seen = new Set<string>();
      const choices: IntakeChoice[] = [];
      for (const raw of parsed.choices ?? []) {
        const value =
          typeof raw.value === 'string' ? raw.value.trim() : '';
        const label =
          typeof raw.label === 'string' ? raw.label.trim() : value;
        if (!value || !label || seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        choices.push({ value, label });
      }
      const kept = choices.slice(0, 6);
      if (kept.length) this.speciesCache.set(key, { at: Date.now(), choices: kept });
      return kept;
    } catch (err) {
      this.logger.warn(
        `Species suggestions failed for ${calibre}: ${(err as Error).message}`,
      );
      return [];
    }
  }

  private async phrasedQuestion(
    row: IntakeRow,
    sheet: SheetResponse,
    answers: Record<string, string>,
    previousAnswer: string | null,
    previousQuestion: string | null,
    previousFieldKey: string | null,
    library: Awaited<ReturnType<MotivationDocumentsService['library']>>,
    /**
     * ⚠️ THE GROUPED PATH HANDS IN THE QUESTION IT ALREADY CHOSE. Without this
     * the grouped turn would re-run the planner and phrase the first pending
     * field over and over instead of the fields in the group.
     */
    baseOverride?: IntakeQuestion,
  ): Promise<{
    question: IntakeQuestion;
    acknowledgement?: string;
    correction?: string;
  } | null> {
    const base =
      baseOverride ??
      planQuestion({
        type: row.licenceType,
        answers,
        sheet,
        provenance: parseProvenance(row.answerProvenance),
      });
    if (!base) return null;

    /**
     * ⚠️ THE HISTORY HAS ITS OWN CHIPS, AND THEY ARE NOT THE MODEL'S TO REPLACE.
     *
     * The one-shot phrasing answered this question with two topic buttons
     * ("Clay pigeon shooting", "Bird hunting") - disciplines a member can tick
     * without ever saying who introduced him or how often he shoots, which is
     * exactly what the section needs. The set below is pinned, so it is served
     * as written and this question costs no model round-trip.
     */
    if (base.fieldKey === 'shooting_history' && !base.sensitive) {
      return {
        question: { ...base, choices: [...HISTORY_CHOICES], multi: true },
      };
    }

    /**
     * THE CALIBRE IS THE RESEARCH. When the interview reaches "what do you
     * hunt", ask Gemini for the species this exact firearm/calibre is suited
     * to and show them as taps. The applicant can still type their own quarry.
     */
    if (base.fieldKey === 'intended_quarry' && !base.sensitive) {
      const choices = await this.speciesChoices(answers);
      if (choices.length) {
        return {
          question: { ...base, choices, multi: true },
        };
      }
    }

    /**
     * ⚠️ THE EXERCISE CHIPS COME FROM THE ASSOCIATION'S PUBLISHED RULES.
     *
     * The association publishes its exercises by code; the pack later appends
     * the chosen one's rules verbatim, which is where 12–23 pages of a
     * professional motivation come from. The choice list is therefore data,
     * not a static array: resolve the association the applicant named (slot
     * one, then slot two) and list the exercises that fit this firearm.
     *
     * ⚠️ VALUE IS THE TITLE, because that is what `rulesFor()` matches on and
     * what the sheet should show. An unknown association falls back to a plain
     * free-text question — never a throw.
     */
    if (base.fieldKey === 'discipline_exercise' && !base.sensitive) {
      const named =
        answers.association_name?.trim() ||
        answers.association_2_name?.trim() ||
        '';
      return {
        question: {
          ...base,
          choices: exerciseChoices(named, answers.firearm_type),
          multi: false,
        },
      };
    }

    if (base.sensitive || !this.llm.isConfigured()) {
      return { question: base };
    }
    /**
     * âš ï¸ DO NOT SPEND A MODEL ROUND-TRIP ON A SIMPLE CHOICE.
     *
     * The action-type, rifle/shotgun and yes/no questions already read as
     * questions, and the chips carry the answer. Phrasing them through Gemini
     * added ~2 seconds to every tap with no information gained, which is what
     * made the interview feel stuck. The model is kept for the purpose router
     * and the free-text answers, where wording and context actually matter.
     */
    /**
     * ⚠️ THE PURPOSE ROUTER KEEPS ITS OWN THREE CHOICES. Letting the agent
     * rewrite them produced "dangerous game hunting" / "specialized big game
     * hunting", which are not stored values; selecting two made the save fail
     * with "that answer did not fit the question".
     */
    const needsPhrasing = base.kind === 'short' || base.kind === 'long';
    if (!needsPhrasing) return { question: base };

    /**
     * âš ï¸ THE AGENT PHRASES, THE PLANNER DECIDES. The tool-using Gemini turn can
     * read the application and write the next question, but it cannot move to
     * another field: `base` is the question the deterministic planner chose,
     * and only its label is replaced. A model that invents a topic is ignored
     * on the next reload because the planner will still ask the missing field.
     */
    const agentContext: InterviewAgentContext = {
      licenceType: row.licenceType,
      licenceLabel: sheet.application.licenceTypeLabel,
      summary: strategyFor(row.licenceType).intro,
      knownFacts: this.knownFacts(answers),
      question: base,
      documents: this.documentState(sheet, library, answers),
      evidence: this.evidenceState(library, row.licenceType, answers),
      previousQuestion: previousQuestion ?? undefined,
      previousAnswer: previousAnswer ?? undefined,
      previousFieldKey: previousFieldKey ?? undefined,
    };
    /**
     * ⚠️ THE TOOL-USING AGENT IS OPT-IN, BECAUSE IT MADE THE BUTTON LOOK DEAD.
     *
     * Measured on the dev box on 2026-11-05: every `motivation.interview.agent`
     * turn took 12–19 s, and several returned twelve output tokens — a tool
     * call and no question — so the turn then paid the one-shot phrasing as
     * well. The member clicked "Start the interview", saw nothing for twenty
     * seconds, and reported the button as not responding.
     *
     * The one-shot path is ~1.2 s and, since the chips work, returns the same
     * three-to-five tap answers. Set `INTERVIEW_AGENT_PHRASING=on` to put the
     * tool loop back while its round handling is being tuned; nothing else
     * changes.
     */
    const agentReply =
      process.env.INTERVIEW_AGENT_PHRASING === 'on'
        ? await this.agent.phrase(agentContext)
        : null;
    if (agentReply) {
      /**
       * ⚠️ A QUESTION THE MEMBER CAN ONLY TYPE IS A REGRESSION, NOT A FALLBACK.
       * The agent is asked for chips on every open question and usually returns
       * them; when it does not, ask once more for the answers alone rather than
       * dropping to a blank input. The deterministic planner's own choices are
       * the last resort — they are at least correct for the field.
       */
      let choices = normaliseChoices(agentReply.choices);
      if (choices.length < 2) {
        choices = await this.agent.choicesFor({
          licenceLabel: sheet.application.licenceTypeLabel,
          question: agentReply.question,
          help: base.help,
          known: this.knownFacts(answers),
          previousAnswer: previousAnswer ?? undefined,
        });
      }
      if (!choices.length) choices = base.choices;
      return {
        question: {
          ...base,
          label: agentReply.question,
          choices,
          customPlaceholder: choices.length
            ? 'Or type your own answer…'
            : base.customPlaceholder,
        },
        acknowledgement: agentReply.acknowledgement,
        correction: agentReply.correctedAnswer,
      };
    }
    try {
      const res = await this.llm.complete({
        system: intakeSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: intakeUserPrompt({
              licenceType: sheet.application.licenceTypeLabel,
              fieldLabel: base.label,
              fieldHelp: base.help,
              choices: base.choices,
              known: this.knownFacts(answers),
              previousAnswer: previousAnswer ?? undefined,
            }),
          },
        ],
        maxTokens: 400,
        temperature: 0.5,
        purpose: 'motivation.interview',
        json: { schema: INTAKE_SCHEMA },
        timeoutMs: 20_000,
      });
      const parsed = parseIntakeReply(res.text);
      const question = parsed?.question ?? '';
      if (!question) return { question: base };
      /**
       * ⚠️ SAME RULE ON THE ONE-SHOT PATH. This is the fallback used when the
       * tool-using agent cannot answer at all, and it used to be a text box by
       * construction — the schema had no `choices` in it. It has one now, and a
       * reply that still arrives without chips keeps the pair the planner
       * already had rather than losing every button.
       *
       * ⚠️ AND IT CARRIES THE SPELLING CORRECTION. MO000063 stored `mosberg`
       * and `12 gayge` because this path answered without correcting, and the
       * writer's corrected prose was then refused against the raw strings. The
       * whitelist is checked here, and `spellingFix` still decides whether the
       * edit is small enough to be a typo in stateInternal.
       */
      const choices = normaliseChoices(parsed?.choices);
      return {
        question: {
          ...base,
          label: question,
          choices: choices.length ? choices : base.choices,
          customPlaceholder: choices.length
            ? 'Or type your own answer…'
            : base.customPlaceholder,
        },
        /**
         * ⚠️ NO GENERATED ACKNOWLEDGEMENT. It is filler, and it invents.
         *
         * A live member was told "It is great that you are keeping up the
         * tradition of hunting you learned from your father" — a father they
         * never mentioned. An acknowledgement that adds facts is worse than
         * none, and nothing downstream needs one.
         */
        acknowledgement: undefined,
        correction: correctionFor(previousFieldKey, parsed),
      };
    } catch (err) {
      this.logger.warn(
        `Interview question phrasing failed: ${(err as Error).message}`,
      );
      return { question: base };
    }
  }

  /**
   * THE NEXT CATEGORY, PHRASED DOWN TO ITS QUESTIONS.
   *
   * ⚠️ CONCURRENT, IN SMALL BATCHES. A group of six open questions phrased
   * one at a time is six model round-trips; four in flight makes it roughly
   * two. The cap is low on purpose: this runs on every turn, and the provider
   * rate-limits per key rather than per member.
   */
  private async phrasedGroup(
    row: IntakeRow,
    sheet: SheetResponse,
    answers: Record<string, string>,
    previousAnswer: string | null,
    previousQuestion: string | null,
    previousFieldKey: string | null,
    library: Awaited<ReturnType<MotivationDocumentsService['library']>>,
  ): Promise<{
    group: Omit<IntakeGroup, 
      'questions'>;
    questions: IntakeQuestion[];
    acknowledgement?: string;
    correction?: string;
  } | null> {
    const input = {
      type: row.licenceType,
      answers,
      sheet,
      provenance: parseProvenance(row.answerProvenance),
    };
    const plan = planGroup(input);
    if (!plan) return null;

    const bases: IntakeQuestion[] = [];
    for (const entry of plan.questions) {
      const base = questionForField(input, entry.key);
      if (base && !bases.some((b) => b.fieldKey === base.fieldKey)) {
        bases.push(base);
      }
    }

    const phrased: {
      question: IntakeQuestion;
      acknowledgement?: string;
      correction?: string;
    }[] = [];
    for (let i = 0; i < bases.length; i += GROUP_CONCURRENCY) {
      const chunk = bases.slice(i, i + GROUP_CONCURRENCY);
      const settled = await Promise.all(
        chunk.map((base) =>
          this.phrasedQuestion(
            row,
            sheet,
            answers,
            previousAnswer,
            previousQuestion,
            previousFieldKey,
            library,
            base,
          ),
        ),
      );
      for (const reply of settled) if (reply) phrased.push(reply);
    }
    if (!phrased.length) return null;

    return {
      group: {
        id: plan.id,
        title: plan.title,
        index: plan.index,
        total: plan.total,
        answered: plan.answered,
        totalInGroup: plan.totalInGroup,
      },
      questions: phrased.map((entry) => entry.question),
      acknowledgement: phrased[0].acknowledgement,
      correction: phrased[0].correction,
    };
  }

  private knownFacts(answers: Record<string, string>): string[] {
    const safe = [
      'firearm_make',
      'firearm_model',
      'firearm_calibre',
      'firearm_type',
      'firearm_action',
      'residence_type',
      'intended_quarry',
      'hunting_locations',
      'competition_record',
      'firearm_use_kind',
    ];
    return safe
      .map((key) => (answers[key] ?? '').trim())
      .filter(Boolean);
  }

  /**
   * A spelling correction is accepted only when it is a SMALL edit to the same
   * value. "Mausser" -> "Mauser" is one character; "GLOCK 19" -> "Glock 17" is
   * three and would be a different fact, so it is refused. Case-only changes
   * are not saved (the printed value is already the same word).
   */
  private spellingFix(original: string, corrected: string): boolean {
    const from = original.trim();
    const to = corrected.trim();
    if (!from || !to || from === to || to.length > 80) return false;
    if (from.toLowerCase() === to.toLowerCase()) return false;
    const maxEdits = Math.min(
      4,
      Math.max(2, Math.floor(Math.max(from.length, to.length) * 0.2)),
    );
    return editDistance(from.toLowerCase(), to.toLowerCase()) <= maxEdits;
  }


  /**
   * Turn the tapped purpose cards into the long answers the writer reads.
   *
   * âš ï¸ THE CARD KEY IS FOR RESEARCH, THE LONG FIELD IS FOR THE PROSE. The
   * research and exhibit pickers read `hunt_game_class`; the writer's fact pack
   * reads `intended_quarry`, `hunting_locations`, `hunting_history` and
   * `competition_record`. Writing both is what makes a tap reach the document.
   */
  private composePurposeFields(
    type: MotivationLicenceType,
    patch: Record<string, string>,
    existing: Record<string, string>,
  ): void {
    const sentencesFor = (cardKey: string): string[] => {
      const raw = (patch[cardKey] ?? '').trim();
      if (!raw) return [];
      const options = fieldByKey(type, cardKey)?.options ?? [];
      return raw
        .split(',')
        .map((key) => options.find((o) => o.key === key.trim())?.sentence)
        .filter((s): s is string => Boolean(s));
    };
    const append = (
      cardKey: string,
      textKey: string,
      onlyIfEmpty = false,
    ) => {
      if (onlyIfEmpty && (patch[textKey] ?? existing[textKey] ?? '').trim()) {
        return;
      }
      const sentences = sentencesFor(cardKey);
      if (!sentences.length) return;
      patch[textKey] = [patch[textKey], ...sentences]
        .filter(Boolean)
        .join(' ')
        .trim();
    };

    append('s13_reasons', 'threat_circumstances', true);
    append('s13_movements', 'daily_movements', true);
    /**
     * ⚠️ THE PICKED QUARRY AND THE TYPED QUARRY BOTH MATTER.
     *
     * `intended_quarry` is the one line the writer and the plates read, and the
     * cards used to fill it only when it was empty. So a member who typed
     * "vlakvark" and then ticked "I hunt medium to large plains game" kept
     * only the typed animal; their picked class never reached the document.
     * Merge the selected class sentences in, without duplicating on a reload.
     */
    const quarryBase = (
      patch.intended_quarry ??
      existing.intended_quarry ??
      ''
    ).trim();
    const quarrySentences = sentencesFor('hunt_game_class').filter(
      (sentence) => !quarryBase.toLowerCase().includes(sentence.toLowerCase()),
    );
    if (quarrySentences.length) {
      patch.intended_quarry = [quarryBase, ...quarrySentences]
        .filter(Boolean)
        .join(' ')
        .trim();
    }
    append('hunt_terrain', 'hunting_locations');
    append('hunt_where', 'hunting_locations');
    append('hunt_reasons', 'hunting_history');
    append('sport_reasons', 'competition_record');
    append('sport_formats', 'competition_record');
  }

  private matchChoices(
    choices: readonly IntakeChoice[],
    message: string,
  ): string[] {
    const tokens = message
      .toLowerCase()
      .split(/[,;/]|\band\b/)
      .map((s) => s.trim())
      .filter(Boolean);
    const out: string[] = [];
    for (const token of tokens.length ? tokens : [message.toLowerCase()]) {
      const hit = choices.find((c) => {
        const label = c.label.toLowerCase();
        const value = c.value.toLowerCase();
        return (
          token === label ||
          token === value ||
          label.includes(token) ||
          token.includes(label)
        );
      });
      if (hit) out.push(hit.value);
    }
    return [...new Set(out)];
  }

  // â”€â”€ section eligibility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private blockedFor(
    type: MotivationLicenceType,
    answers: Record<string, string>,
  ): IntakeBlocked | null {
    const blocker = applicationBlockers(type, answers).find(
      (b) => b.code === 'section-forbids-firearm',
    );
    if (!blocker) return null;
    return {
      code: blocker.code,
      field: blocker.field,
      message: blocker.message,
      suggested: this.suggestSections(type, answers),
    };
  }

  /**
   * The sections that would lawfully take the firearm the applicant described.
   * The message already says "a different section"; these are the actual doors.
   */
  private suggestSections(
    type: MotivationLicenceType,
    answers: Record<string, string>,
  ): { licenceType: MotivationLicenceType; label: string }[] {
    const shape = firearmShape(answers);
    if (!shape) return [];
    const out: MotivationLicenceType[] = [];
    const add = (t: MotivationLicenceType) => {
      if (t !== type && !out.includes(t)) out.push(t);
    };
    const rifle = shape.category === 'rifle-carbine';
    const shotgun = shape.category === 'shotgun';
    const handgun = shape.category === 'handgun';
    const selfLoading = shape.selfLoading === true;

    if (type === 'S13_SELF_DEFENCE') {
      if (rifle) {
        add('S15_OCCASIONAL_HUNTER');
        add('S16_DEDICATED_HUNTER');
        if (selfLoading) add('S16_DEDICATED_SPORT');
      }
      if (shotgun && selfLoading) {
        add('S14_RESTRICTED_SELF_DEFENCE');
        add('S16_DEDICATED_SPORT');
      }
    }

    if (type === 'S14_RESTRICTED_SELF_DEFENCE') {
      if (handgun) add('S13_SELF_DEFENCE');
      if (rifle && !selfLoading) {
        add('S15_OCCASIONAL_HUNTER');
        add('S16_DEDICATED_HUNTER');
      }
      if (shotgun && !selfLoading) add('S13_SELF_DEFENCE');
    }

    if (type === 'S15_OCCASIONAL_HUNTER' && selfLoading && !handgun) {
      add('S16_DEDICATED_SPORT');
      add('S14_RESTRICTED_SELF_DEFENCE');
    }

    return out.map((licenceType) => ({
      licenceType,
      label: LICENCE_TYPE_LABELS[licenceType],
    }));
  }

  // â”€â”€ transcript â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async appendTranscript(
    id: string,
    messages: TranscriptMessage[],
  ): Promise<void> {
    const row = await this.prisma.motivation.findUnique({
      where: { id },
      select: { interviewEncrypted: true },
    });
    const current = this.readTranscript(row?.interviewEncrypted ?? null);
    const next: Transcript = {
      version: INTERVIEW_VERSION,
      messages: [...current.messages, ...messages].slice(-MAX_TRANSCRIPT),
    };
    await this.prisma.motivation.update({
      where: { id },
      data: {
        interviewEncrypted: encryptText(JSON.stringify(next)),
        interviewVersion: INTERVIEW_VERSION,
      },
    });
  }

  private readTranscript(encrypted: string | null): Transcript {
    if (!encrypted) return { version: INTERVIEW_VERSION, messages: [] };
    try {
      const parsed = JSON.parse(tryDecryptText(encrypted) ?? '') as Transcript;
      if (!Array.isArray(parsed.messages)) throw new Error('bad transcript');
      return {
        version: parsed.version || INTERVIEW_VERSION,
        messages: parsed.messages.slice(-MAX_TRANSCRIPT),
      };
    } catch {
      return { version: INTERVIEW_VERSION, messages: [] };
    }
  }

  // â”€â”€ guards â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async load(userId: string, id: string): Promise<IntakeRow> {
    const user = await this.shared.requireUser(userId);
    const row = await this.prisma.motivation.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        referenceNumber: true,
        licenceType: true,
        answersEncrypted: true,
        intakeMode: true,
        outputMode: true,
        intakeStartedAt: true,
        intakeDocumentsAt: true,
        intakeCompletedAt: true,
        interviewEncrypted: true,
        answerProvenance: true,
        status: true,
      },
    });
    if (!row) throw new NotFoundException('Motivation not found');
    return row;
  }

  private assertEditable(row: IntakeRow): void {
    if (!EDITABLE.includes(row.status)) {
      throw new ConflictException(
        'This application is already being written or has been completed.',
      );
    }
  }
}

/** Levenshtein distance, used only by the small-edit spelling guard. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        substitution,
      );
    }
    previous = current;
  }
  return previous[b.length];
}




