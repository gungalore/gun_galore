'use client';

import { useEffect, useRef, useState } from 'react';
import type { IntakeGroup, IntakeQuestion } from '@/lib/motivations-api';

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
    const out: GroupAnswer = { fieldKey: question.fieldKey };
    if (draft.picked.length) {
      if (question.multi) out.values = draft.picked;
      else out.value = draft.picked[0];
    }
    const text = draft.typed.trim();
    if (text) out.message = text;
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
  const canContinue = !busy && !stuck && answered.length > 0;

  function submit(skipKey?: string): void {
    if (busy || stuck) return;
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

  if (stuck) {
    return (
      <section
        className="mt-4 rounded-2xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}
      >
        <h2 className="m-0 text-[15px] font-medium text-[var(--text-primary)]">
          {group.title}
        </h2>
        <p className="mb-0 mt-2 text-[13px] leading-5 text-[var(--red)]">
          We could not save that answer. Try again.
        </p>
      </section>
    );
  }

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

      <div className="mt-3 grid gap-4">
        {group.questions.map((question) => {
          const draft = draftFor(question.fieldKey);
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

              {closedChoice ? null : (
                <input
                  value={draft.typed}
                  type={question.kind === 'date' ? 'date' : 'text'}
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
