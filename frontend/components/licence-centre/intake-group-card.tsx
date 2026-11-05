'use client';

import { useEffect, useRef, useState } from 'react';
import type { IntakeGroup, IntakeQuestion } from '@/lib/motivations-api';

export interface GroupAnswer {
  fieldKey: string;
  value?: string;
  values?: string[];
  message?: string;
}

/**
 * ONE QUESTION AT A TIME, INSIDE ONE CATEGORY.
 *
 * ⚠️ A CARD OF SIX QUESTIONS IS A FORM. The category still comes back as a
 * group — that is what keeps the document drawer, the topic title and the
 * progress honest — but the member answers one question, the server returns
 * the group minus that one, and the next appears. The chips are unchanged,
 * so a cold application is still mostly taps.
 *
 * ⚠️ AND A FIELD THAT COMES BACK TWICE IS NOT SHOWN TWICE. If the server
 * returns the same first field after it was submitted, the answer did not
 * land; re-rendering it would look like the tap did nothing and the member
 * would tap again forever. The card says so instead, through the parent's
 * error slot, and stops.
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
  const [picked, setPicked] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const [stuck, setStuck] = useState(false);

  const submittedKey = useRef<string | null>(null);
  const groupAtSubmit = useRef<IntakeGroup | null>(null);

  const question: IntakeQuestion | undefined = group.questions[0];

  /**
   * ⚠️ COMPARING GROUP IDENTITY, NOT JUST THE KEY. The parent re-renders with
   * a NEW group object on every server reply; the same object still showing
   * the same key is just the period between submit and response, which is not
   * a failure.
   */
  useEffect(() => {
    if (!question || !submittedKey.current) return;
    if (groupAtSubmit.current === null || group === groupAtSubmit.current) return;
    if (group.questions[0]?.fieldKey !== submittedKey.current) return;
    setStuck(true);
    onStuck?.('We could not save that answer. Try again.');
  }, [group, question, onStuck]);

  // A new field means the previous answer landed; clear the slate.
  useEffect(() => {
    if (question && question.fieldKey !== submittedKey.current) {
      setStuck(false);
      setPicked([]);
      setTyped('');
    }
  }, [question]);

  function answer(): GroupAnswer | null {
    if (!question) return null;
    const text = typed.trim();
    if (picked.length) {
      return question.multi
        ? { fieldKey: question.fieldKey, values: picked }
        : { fieldKey: question.fieldKey, value: picked[0] };
    }
    if (text) return { fieldKey: question.fieldKey, message: text };
    return null;
  }

  function toggle(value: string) {
    if (!question) return;
    if (!question.multi) {
      setPicked([value]);
      return;
    }
    setPicked((current) =>
      current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value],
    );
  }

  const current = answer();
  const canContinue = !busy && !stuck && Boolean(current);

  const settled = Math.max(0, group.totalInGroup - group.questions.length);
  const position = Math.min(group.totalInGroup, settled + 1);

  if (!question) return null;

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
          Question {position} of {group.totalInGroup}
        </span>
      </div>

      <fieldset className="m-0 mt-3 min-w-0 border-0 p-0">
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
              const on = picked.includes(choice.value);
              return (
                <button
                  key={choice.value}
                  type="button"
                  disabled={busy}
                  aria-pressed={on}
                  onClick={() => toggle(choice.value)}
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
          value={typed}
          type={question.kind === 'date' ? 'date' : 'text'}
          onChange={(e) => setTyped(e.target.value)}
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

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[12px] text-[var(--text-tertiary)]">
          {current
            ? 'Tap Continue to save it.'
            : 'Answer this one to carry on.'}
        </span>
        <button
          type="button"
          disabled={!canContinue}
          onClick={() => {
            if (!current) return;
            submittedKey.current = question.fieldKey;
            groupAtSubmit.current = group;
            void onSubmit([current]);
          }}
          className="rounded-lg px-4 py-2 text-[13px] font-medium text-white disabled:opacity-50"
          style={{ background: 'var(--red)' }}
        >
          Continue
        </button>
      </div>
    </section>
  );
}
