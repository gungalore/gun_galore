'use client';

import { useState } from 'react';
import type { IntakeGroup, IntakeQuestion } from '@/lib/motivations-api';

export interface GroupAnswer {
  fieldKey: string;
  value?: string;
  values?: string[];
  message?: string;
}

/**
 * ONE CATEGORY, ONE CARD.
 *
 * \u26a0\ufe0f THE TAPS COME FIRST AND THE BOX IS THE ESCAPE. Every question keeps the
 * chips the single-question card gave it; the text box underneath is for the
 * answer that is not on the list. A member answering a cold application taps
 * most of this card.
 *
 * \u26a0\ufe0f REQUIRED QUESTIONS BLOCK CONTINUE, OPTIONAL ONES DO NOT. The card says
 * how many of its own questions are still open, so "why can't I continue" is
 * never a question the member has to ask.
 */
export default function IntakeGroupCard({
  group,
  busy,
  onSubmit,
}: {
  group: IntakeGroup;
  busy: boolean;
  onSubmit: (answers: GroupAnswer[]) => void | Promise<void>;
}) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});

  function answerFor(question: IntakeQuestion): GroupAnswer | null {
    const values = picked[question.fieldKey] ?? [];
    const text = (typed[question.fieldKey] ?? '').trim();
    if (values.length) {
      return question.multi
        ? { fieldKey: question.fieldKey, values }
        : { fieldKey: question.fieldKey, value: values[0] };
    }
    if (text) return { fieldKey: question.fieldKey, message: text };
    return null;
  }

  function toggle(question: IntakeQuestion, value: string) {
    setPicked((prev) => {
      const current = prev[question.fieldKey] ?? [];
      if (!question.multi) return { ...prev, [question.fieldKey]: [value] };
      return {
        ...prev,
        [question.fieldKey]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      };
    });
  }

  const answered = group.questions.filter((q) => answerFor(q));
  const missing = group.questions.filter((q) => !q.optional && !answerFor(q));
  const canContinue = !busy && answered.length > 0 && missing.length === 0;

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
          {group.answered} of {group.totalInGroup} answered
        </span>
      </div>

      <div className="mt-3 grid gap-4">
        {group.questions.map((question) => {
          const chosen = picked[question.fieldKey] ?? [];
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
              {question.help ? (
                <p className="mb-0 mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">
                  {question.help}
                </p>
              ) : null}

              {question.choices.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {question.choices.map((choice) => {
                    const on = chosen.includes(choice.value);
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

              <input
                value={typed[question.fieldKey] ?? ''}
                type={question.kind === 'date' ? 'date' : 'text'}
                onChange={(e) =>
                  setTyped((prev) => ({
                    ...prev,
                    [question.fieldKey]: e.target.value,
                  }))
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
            </fieldset>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[12px] text-[var(--text-tertiary)]">
          {missing.length
            ? `${missing.length} required ${missing.length === 1 ? 'answer' : 'answers'} still open`
            : 'All required answers on this card are filled'}
        </span>
        <button
          type="button"
          disabled={!canContinue}
          onClick={() =>
            void onSubmit(
              group.questions
                .map((q) => answerFor(q))
                .filter((a): a is GroupAnswer => Boolean(a)),
            )
          }
          className="rounded-lg px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--red)' }}
        >
          Continue
        </button>
      </div>
    </section>
  );
}
