'use client';

import { useEffect, useRef, useState } from 'react';
import type { IntakeGroup, IntakeQuestion } from '@/lib/motivations-api';
import DateField from '@/components/date-field';

export interface GroupAnswer {
  fieldKey: string;
  value?: string;
  values?: string[];
  message?: string;
  fields?: Record<string, string>;
  /** Optional question the member has chosen not to answer. */
  skip?: boolean;
}

interface Draft {
  picked: string[];
  typed: string;
  details: Record<string, string>;
}

const EMPTY: Draft = { picked: [], typed: '', details: {} };

/**
 * ⚠️ THE TICK AND THE CROSS ARE THE "DID MY TAP REGISTER" SIGNAL. A card of
 * six questions gives no feedback between the tap and Continue; a member who
 * cannot see that an answer landed taps again. Green tick = this question has
 * an answer on the card; red cross = it is required and still empty. An
 * optional question with no answer carries neither.
 */
function AnsweredMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 20 20"
      role="img"
      aria-label="Answered"
      className="ml-2 inline-block align-[-2px]"
    >
      <path
        d="M3.5 10.5l4.2 4.2L16.5 5.6"
        fill="none"
        stroke="var(--success)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NeedsAnswerMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 20 20"
      role="img"
      aria-label="Still needs an answer"
      className="ml-2 inline-block align-[-2px]"
    >
      <path
        d="M5 5l10 10M15 5L5 15"
        fill="none"
        stroke="var(--red)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function draftWords(draft: Draft): number {
  const said = [...draft.picked, draft.typed].join(' ').trim();
  return said ? said.split(/\s+/).filter(Boolean).length : 0;
}

/**
 * THE WHOLE CARD, IN ONE TAP-THROUGH.
 *
 * ⚠️ ONE SCREEN, ONE SUBMIT. Every question in the category is on the card at
 * once and the member answers them with chips, then presses Continue once. The
 * old card showed a single question and posted after each answer — six
 * questions meant six round-trips and six waits. The server validates the
 * whole card before writing and rebuilds the interview once, so this is both
 * faster and no less safe.
 *
 * ⚠️ IT IS NOT A FORM. A closed choice has no text box; a chip question is
 * answered with a tap; the only typing is the free-text answer that genuinely
 * needs it. The reason each fact matters (`why`) sits under the question, so
 * the card reads as an interviewer asking rather than a form to fill.
 *
 * ⚠️ OPTIONAL QUESTIONS CAN BE SKIPPED, AND A SKIP IS SENT WITH THE CARD. The
 * card posts the answers and the skips in one request; the server records the
 * decision so the question is not asked again.
 */
export default function IntakeGroupCard({
  group,
  busy,
  onSubmit,
  onStuck,
}: {
  group: IntakeGroup;
  busy: boolean;
  onSubmit: (answers: GroupAnswer[]) => void | Promise<void>;
  /** Called when the answer did not land and the field came back unchanged. */
  onStuck?: (message: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [stuck, setStuck] = useState(false);

  const submittedKey = useRef<string | null>(null);
  const groupAtSubmit = useRef<IntakeGroup | null>(null);

  const first = group.questions[0];

  /**
   * ⚠️ COMPARING GROUP IDENTITY, NOT JUST THE KEY. The parent re-renders with
   * a NEW group object on every server reply; the same object still showing
   * the same key is just the period between submit and response, which is not
   * a failure.
   */
  useEffect(() => {
    if (!first || !submittedKey.current) return;
    if (groupAtSubmit.current === null || group === groupAtSubmit.current) return;
    if (group.questions[0]?.fieldKey !== submittedKey.current) return;
    setStuck(true);
    onStuck?.('We could not save that answer. Try again.');
  }, [group, first, onStuck]);

  // A new card means the previous one landed; drop drafts for questions that
  // are no longer here and clear the slate.
  useEffect(() => {
    if (!first) return;
    if (submittedKey.current && group.questions[0]?.fieldKey !== submittedKey.current) {
      setStuck(false);
      setDrafts({});
    }
  }, [group, first]);

  function draftFor(key: string): Draft {
    return drafts[key] ?? EMPTY;
  }

  function update(key: string, patch: Partial<Draft>): void {
    setStuck(false);
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? EMPTY), ...patch },
    }));
  }

  function toggle(question: IntakeQuestion, value: string): void {
    const draft = draftFor(question.fieldKey);
    update(question.fieldKey, {
      picked: question.multi
        ? draft.picked.includes(value)
          ? draft.picked.filter((v) => v !== value)
          : [...draft.picked, value]
        : [value],
    });
  }

  function answerFor(question: IntakeQuestion): GroupAnswer | null {
    const draft = draftFor(question.fieldKey);
    /**
     * ⚠️ A TICK IS NOT AN ANSWER IF THE GATE WILL REFUSE IT. The shooting
     * history has a twelve-word floor; one chip ("At the range most weekends",
     * five words) used to tick, enable Continue and then be refused by the
     * server. Below the floor the question stays open and is not submitted, so
     * the rest of the card saves and this comes back for a sentence or a few
     * more ticks.
     */
    if (question.minWords && draftWords(draft) < question.minWords) return null;
    const out: GroupAnswer = { fieldKey: question.fieldKey };
    if (draft.picked.length) {
      if (question.multi) out.values = draft.picked;
      else out.value = draft.picked[0];
    }
    const text = draft.typed.trim();
    if (text) {
      /**
       * ⚠️ A DATE TRAVELS AS `value`, NOT AS A TYPED `message`. The batch
       * handler routes `message` through the chip matcher, which has no
       * customKey for a date field and refuses it ("choose one of the options")
       * — so a date question could not be saved at all. `value` is the field's
       * own answer and is what the single-question path has always sent.
       */
      if (question.kind === 'date') out.value = text;
      else out.message = text;
    }
    if (Object.keys(draft.details).length) out.fields = draft.details;
    return out.values?.length || out.value || out.message ? out : null;
  }

  const answered = group.questions
    .map((question) => ({ question, answer: answerFor(question) }))
    .filter((entry) => entry.answer !== null);
  const required = group.questions.filter((question) => !question.optional);
  const missingRequired = required.filter(
    (question) => answerFor(question) === null,
  );
  /**
   * ⚠️ ONE ANSWER IS ENOUGH TO CONTINUE. This used to require every required
   * question on the card, so a member who tapped "Main firearm licence holder"
   * found the button dead until they had also typed an occupation further down
   * the card — the tap looked broken. Continue now saves whatever has been
   * answered; anything still open stays pending and is served again (the
   * generation gate still refuses without it).
   */
  const canContinue = !busy && answered.length > 0;

  function submit(skipKey?: string): void {
    if (busy) return;
    /**
     * ⚠️ A RETRY MUST BE POSSIBLE. The card used to replace itself with a bare
     * "could not save" box when the server sent the same first question back,
     * which hid the question AND the member's draft: the only way forward was
     * to reload and start the answer again. The banner stays, the question
     * stays, the draft stays, and the next tap tries again.
     */
    setStuck(false);
    const answers: GroupAnswer[] = answered.map((entry) => entry.answer!);
    const firstAnswered = answered[0]?.question.fieldKey ?? null;
    if (skipKey) {
      answers.push({ fieldKey: skipKey, skip: true });
    }
    if (!answers.length) return;
    /**
     * ⚠️ ONLY A REAL ANSWER SETS THE STUCK GUARD. A pure skip leaves the card
     * in place (minus that question), and the first field is still the same —
     * which would read as "your answer did not save" on a request that worked
     * exactly as intended.
     */
    submittedKey.current = firstAnswered;
    groupAtSubmit.current = group;
    void onSubmit(answers);
  }

  if (!first) return null;

  return (
    <section
      className="mt-4 rounded-2xl border p-4"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-[15px] font-medium text-[var(--text-primary)]">
          {group.title}
        </h2>
        <span className="text-[12px] text-[var(--text-tertiary)]">
          Step {group.index} of {group.total} · {group.answered}/
          {group.totalInGroup} answered
        </span>
      </div>

      {stuck ? (
        <p className="mb-0 mt-2 text-[13px] leading-5" style={{ color: 'var(--red)' }}>
          We could not save that answer. Try again — your answer is still here.
        </p>
      ) : null}

      <div className="mt-3 grid gap-4">
        {group.questions.map((question) => {
          const draft = draftFor(question.fieldKey);
          const answeredNow = answerFor(question) !== null;
          const closedChoice =
            question.choices.length > 0 &&
            (question.kind === 'choice' || question.kind === 'yesno');
          const showDetails =
            question.details?.length &&
            draft.picked.some((value) => value.toLowerCase() === 'yes');
          return (
            <fieldset
              key={question.fieldKey}
              className="m-0 min-w-0 border-0 p-0"
            >
              <legend className="m-0 p-0 text-[13.5px] font-medium text-[var(--text-primary)]">
                {question.label}
                {question.optional ? (
                  <span className="ml-2 text-[11px] uppercase tracking-[0.1em] text-[var(--text-tertiary)]">
                    Optional
                  </span>
                ) : null}
                {answeredNow ? (
                  <AnsweredMark />
                ) : question.optional ? null : (
                  <NeedsAnswerMark />
                )}
              </legend>
              {question.why || question.help ? (
                <p className="mb-0 mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  {question.why || question.help}
                </p>
              ) : null}

              {question.choices.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {question.choices.map((choice) => {
                    const on = draft.picked.includes(choice.value);
                    return (
                      <button
                        key={choice.value}
                        type="button"
                        disabled={busy}
                        aria-pressed={on}
                        onClick={() => toggle(question, choice.value)}
                        className="rounded-full border px-3 py-2 text-left text-[12.5px] leading-4"
                        style={{
                          borderColor: on ? 'var(--red)' : 'var(--border)',
                          background: on ? 'var(--red-wash)' : 'var(--bg-inset)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {choice.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}

              {closedChoice ? null : question.kind === 'date' ? (
                /**
                 * ⚠️ THE HOUSE DATE CONTROL, NOT THE BROWSER'S. A native
                 * `<input type="date">` opens whatever picker the OS ships —
                 * on Windows a month/year wheel that has to be scrolled twice
                 * before a day can be picked. DateField is the control the
                 * rest of the Licence Centre uses: type it, or open the
                 * year → month → day sheet.
                 */
                <div className="mt-2">
                  <DateField
                    value={draft.typed}
                    onChange={(iso) =>
                      update(question.fieldKey, { typed: iso })
                    }
                    label={question.label}
                    placeholder="yyyy-mm-dd"
                  />
                </div>
              ) : (
                <input
                  value={draft.typed}
                  type="text"
                  onChange={(e) =>
                    update(question.fieldKey, { typed: e.target.value })
                  }
                  placeholder={
                    question.choices.length
                      ? 'Or type your own answer…'
                      : question.customPlaceholder
                  }
                  className="mt-2 min-h-[44px] w-full rounded-lg border px-3 text-[13.5px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--bg-inset)',
                    color: 'var(--text-primary)',
                  }}
                />
              )}

              {showDetails ? (
                <div className="mt-2 grid gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
                  {question.details!.map((detail) => (
                    <label key={detail.key} className="block">
                      <span className="block text-[12px] font-medium text-[var(--text-primary)]">
                        {detail.label}
                      </span>
                      <input
                        value={draft.details[detail.key] ?? ''}
                        onChange={(e) =>
                          update(question.fieldKey, {
                            details: {
                              ...draft.details,
                              [detail.key]: e.target.value,
                            },
                          })
                        }
                        className="mt-1 min-h-[44px] w-full rounded-lg border px-3 text-[13px]"
                        style={{
                          borderColor: 'var(--border)',
                          background: 'var(--bg-inset)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </label>
                  ))}
                </div>
              ) : null}

              {question.minWords && draftWords(draft) < question.minWords ? (
                <p
                  className="mb-0 mt-1 text-[12px] leading-5"
                  style={{ color: 'var(--warning)' }}
                >
                  Pick a few of these, or add a sentence — who introduced you,
                  what you shoot and how often.
                </p>
              ) : null}

              {question.optional ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => submit(question.fieldKey)}
                  className="mt-2 text-[12px] text-[var(--text-secondary)] underline"
                >
                  Skip this one
                </button>
              ) : null}
            </fieldset>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[12px] text-[var(--text-tertiary)]">
          {answered.length === 0
            ? 'Tap an answer to carry on.'
            : missingRequired.length
              ? `${missingRequired.length} still to answer — Continue saves what you have.`
              : 'Tap Continue to save these answers.'}
        </span>
        <button
          type="button"
          disabled={!canContinue}
          onClick={() => submit()}
          className="rounded-lg px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--red)' }}
        >
          Continue
        </button>
      </div>
    </section>
  );
}
