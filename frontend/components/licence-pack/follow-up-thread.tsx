'use client';

// ────────────────────────────────────────────────────────────────────
// "A FEW THINGS BOET WANTS TO ASK."
//
// ⚠️ THIS IS THE ONE MISSING PIECE THAT LEAVES A MEMBER STUCK RATHER THAN
// INCONVENIENCED. Every other gap in the rebuilt wizard cost somebody effort;
// this one costs them the document. When the quality gate finds an answer too
// thin to argue from it writes a question, moves the application to
// NEEDS_MORE_INFO, and answering is what moves it back. The questions existed
// in the database and nothing in the new tree rendered them — so the pack
// simply refused to finish, with no reason on screen and nothing to do.
//
// Not a chat. The reply is merged into the answers under the question's own
// fieldKey — the schema's words are "a form-filler rather than a transcript" —
// which is why each question stands alone with its own box rather than a
// single conversation input.
//
// ⚠️ AND ANSWERING ONE IS PERMANENT IN A WAY WORTH KNOWING. The server marks
// that field's provenance MEMBER: "a field somebody has written into in their
// own words is not one we may quietly refill later." So a follow-up answer
// locks the field against document and vault prefill from then on. That is
// correct, and it is why the box is theirs to fill rather than something we
// pre-populate with a suggestion.
// ────────────────────────────────────────────────────────────────────

import { useState } from 'react';
import type { FollowUp } from '@/lib/motivations-api';
import { openQuestions } from '@/lib/follow-up-rules';

function Answer({
  question,
  onSubmit,
}: {
  /** What the box is for, so it has a name a screen reader can say. */
  question: string;
  onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-2">
      {/* ⚠️ A NAME, NOT A PLACEHOLDER, AND NOT NOTHING. The box had neither, so
          a screen reader announced "edit text, blank" — on the one control
          standing between the member and their pack. aria-label rather than a
          visible one: the question is already printed directly above it, and a
          second copy on screen would be noise for everybody who can see it. */}
      <textarea
        aria-label={`Your answer to: ${question}`}
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        className="w-full rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-[13.5px]"
      />
      <button
        type="button"
        // ⚠️ WHITESPACE IS NOT AN ANSWER. Submitting one would mark the field
        // MEMBER — locking it against every prefill source — in exchange for
        // nothing.
        disabled={busy || !text.trim()}
        onClick={async () => {
          setBusy(true);
          try {
            await onSubmit(text.trim());
            setText('');
          } finally {
            setBusy(false);
          }
        }}
        className="mt-1.5 min-h-[44px] rounded-[var(--r-sm)] border-0 bg-[var(--red)] px-4 py-[8px] text-[13px] font-medium text-white disabled:opacity-45"
      >
        {busy ? 'Saving…' : 'Answer'}
      </button>
    </div>
  );
}

export default function FollowUpThread({
  messages,
  onAnswer,
}: {
  messages: FollowUp[];
  onAnswer: (messageId: string, text: string) => Promise<void>;
}) {
  const open = openQuestions(messages);
  if (!open.length) return null;

  return (
    <div
      className="gg-tile rounded-[8px] border px-4 py-3.5"
      style={{
        borderColor: 'var(--gold-line)',
        background: 'var(--gold-wash)',
      }}
    >
      <p className="text-[13.5px] font-medium">
        {open.length === 1
          ? 'One thing Boet wants to ask'
          : `${open.length} things Boet wants to ask`}
      </p>
      {/* ⚠️ SAY WHY, AND SAY IT WITHOUT BLAME. These are answers that were too
          thin to build from — not wrong answers, and not a rejection. A
          member who reads this as criticism stops writing. */}
      <p className="mt-0.5 text-[12.5px] leading-[1.5] text-[var(--text-secondary)]">
        These are the answers that were too short for us to build a strong
        document from. Your pack cannot be written until they are answered.
      </p>

      <ul className="mt-3 space-y-4">
        {open.map((q) => (
          <li key={q.id}>
            {q.fieldLabel && (
              <p className="text-[11px] font-medium uppercase tracking-[.09em] text-[var(--text-tertiary)]">
                {q.fieldLabel}
              </p>
            )}
            <p className="mt-0.5 text-[13.5px] font-medium">{q.content}</p>
            <Answer
              question={q.fieldLabel ?? q.content}
              onSubmit={(text) => onAnswer(q.id, text)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
