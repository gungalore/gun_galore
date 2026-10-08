'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SavedAnswer, ServedQuestion } from '../../lib/valuation-api';

/**
 * One question per screen, with a "Question n of m" counter and progress bar.
 * Tickboxes for multi, single-choice rows otherwise, an Other box, and a Not
 * sure row that lowers confidence instead of blocking. Answers are saved as
 * the member goes.
 */
export function QuestionWizard({
  questions,
  onComplete,
}: {
  questions: ServedQuestion[];
  onComplete: (answers: SavedAnswer[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, SavedAnswer>>(() => {
    const initial: Record<string, SavedAnswer> = {};
    for (const q of questions) {
      initial[q.id] = {
        questionId: q.id,
        selected: [],
        custom: q.default ?? null,
        unsure: false,
      };
    }
    return initial;
  });
  const [other, setOther] = useState(questions[0]?.default ?? '');

  // Show a pre-filled answer (e.g. the make/model we already know) when moving
  // between questions, so the member confirms rather than re-typing.
  useEffect(() => {
    setOther(answers[questions[index]?.id]?.custom ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const question = questions[index];
  const current = answers[question?.id];
  const total = questions.length;
  const progress = useMemo(() => ((index + 1) / total) * 100, [index, total]);

  function update(next: Partial<SavedAnswer>) {
    setAnswers((prev) => ({
      ...prev,
      [question.id]: { ...prev[question.id], ...next, unsure: false },
    }));
  }

  function toggleOption(option: string) {
    if (question.type === 'multi') {
      const selected = current.selected.includes(option)
        ? current.selected.filter((o) => o !== option)
        : [...current.selected, option];
      update({ selected });
    } else {
      update({ selected: [option] });
    }
  }

  function next() {
    const withOther = other.trim()
      ? { ...current, custom: other.trim(), unsure: false }
      : current;
    setAnswers((prev) => ({ ...prev, [question.id]: withOther }));
    setOther('');
    if (index + 1 >= total) {
      onComplete(Object.values({ ...answers, [question.id]: withOther }));
    } else {
      setIndex(index + 1);
    }
  }

  if (!question) return null;

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-5">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>
            Question {index + 1} of {total}
          </p>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-inset)' }}>
          <div
            className="h-full rounded-full"
            style={{ width: `${progress}%`, background: 'var(--red)', transition: 'width 0.3s' }}
          />
        </div>
      </div>

      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
        {question.text}
      </h2>
      {question.hint && (
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {question.hint}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {question.options.map((option) => {
          const checked = current.selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => toggleOption(option)}
              className="text-left rounded-[8px] px-3 py-2.5 text-sm flex items-center gap-3"
              style={{
                background: checked ? 'rgba(227,6,19,0.06)' : 'var(--bg-inset)',
                border: `0.5px solid ${checked ? 'var(--red)' : 'var(--border)'}`,
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: question.type === 'multi' ? 3 : '50%',
                  border: `1.5px solid ${checked ? 'var(--red)' : 'var(--border)'}`,
                  background: checked ? 'var(--red)' : 'transparent',
                  flexShrink: 0,
                }}
              />
              {option}
            </button>
          );
        })}

        <div className="flex items-center gap-2 mt-1">
          <input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="Other (type your own)"
            className="flex-1 rounded-[8px] px-3 py-2 text-sm"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => {
            setAnswers((prev) => ({
              ...prev,
              [question.id]: { questionId: question.id, selected: [], custom: null, unsure: true },
            }));
            setOther('');
            if (index + 1 >= total) onComplete(Object.values({ ...answers, [question.id]: { questionId: question.id, selected: [], custom: null, unsure: true } }));
            else setIndex(index + 1);
          }}
          className="text-left text-sm px-3 py-2 rounded-[8px]"
          style={{ background: 'transparent', border: '0.5px dashed var(--border)', color: 'var(--text-tertiary)', cursor: 'pointer' }}
        >
          Not sure
        </button>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex(Math.max(0, index - 1))}
          disabled={index === 0}
          className="text-sm px-4 py-2 rounded-[8px]"
          style={{
            background: 'transparent',
            border: '0.5px solid var(--border)',
            color: index === 0 ? 'var(--text-tertiary)' : 'var(--text-primary)',
            cursor: index === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={next}
          className="text-sm font-semibold px-5 py-2 rounded-[8px]"
          style={{ background: 'var(--red)', color: '#fff', border: 'none', cursor: 'pointer' }}
        >
          {index + 1 >= total ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  );
}
