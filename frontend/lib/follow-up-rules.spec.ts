import { describe, expect, it } from 'vitest';
import type { FollowUp } from './motivations-api';
import { hasOutstandingQuestions, openQuestions } from './follow-up-rules';

// ────────────────────────────────────────────────────────────────────
// AN UNANSWERED QUESTION BLOCKS THE DOCUMENT.
//
// The gate moves the application to NEEDS_MORE_INFO and answering is what
// moves it back. A member who cannot see these is not missing a feature —
// they are stuck, with no visible reason and no way out.
// ────────────────────────────────────────────────────────────────────

let n = 0;
const ask = (fieldKey: string | null, content = 'q'): FollowUp => ({
  id: `a${n++}`,
  role: 'assistant',
  content,
  fieldKey,
  fieldLabel: fieldKey,
  createdAt: new Date(2026, 0, n).toISOString(),
});
const reply = (fieldKey: string | null, content = 'a'): FollowUp => ({
  id: `u${n++}`,
  role: 'user',
  content,
  fieldKey,
  fieldLabel: fieldKey,
  createdAt: new Date(2026, 0, n).toISOString(),
});

describe('what is still outstanding', () => {
  it('an unanswered question is open', () => {
    expect(openQuestions([ask('daily_movements')]).map((q) => q.fieldKey)).toEqual([
      'daily_movements',
    ]);
  });

  it('an answered one is not', () => {
    expect(openQuestions([ask('daily_movements'), reply('daily_movements')])).toEqual([]);
  });

  it('answers one field without closing another', () => {
    const out = openQuestions([
      ask('daily_movements'),
      ask('threat_circumstances'),
      reply('daily_movements'),
    ]);
    expect(out.map((q) => q.fieldKey)).toEqual(['threat_circumstances']);
  });

  it('reports nothing for a thread that never started', () => {
    expect(openQuestions([])).toEqual([]);
    expect(hasOutstandingQuestions([])).toBe(false);
  });
});

describe('⚠️ answered means answered AFTER it was asked', () => {
  it('an earlier reply does not close a later question about the same field', () => {
    // The gate can ask about one field twice — a second draft can still find
    // `daily_movements` thin after one reply. Matching on fieldKey alone
    // would swallow the second ask and leave the member on NEEDS_MORE_INFO
    // with nothing on screen to do about it.
    const out = openQuestions([
      ask('daily_movements', 'first ask'),
      reply('daily_movements'),
      ask('daily_movements', 'asked again'),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].content).toBe('asked again');
  });

  it('and closes it once they answer the second time', () => {
    const out = openQuestions([
      ask('daily_movements'),
      reply('daily_movements'),
      ask('daily_movements'),
      reply('daily_movements'),
    ]);
    expect(out).toEqual([]);
  });
});

describe('⚠️ plain conversation is never outstanding', () => {
  it('ignores an assistant message with no field to fill', () => {
    // The answer to a follow-up is merged into answersEncrypted under its
    // fieldKey. A message with no fieldKey has nowhere for a reply to land,
    // so treating it as outstanding would block the document on a question
    // that cannot be answered.
    expect(openQuestions([ask(null, 'just saying hello')])).toEqual([]);
    expect(hasOutstandingQuestions([ask(null)])).toBe(false);
  });

  it('still counts a real question beside it', () => {
    const out = openQuestions([ask(null, 'chat'), ask('intended_quarry')]);
    expect(out.map((q) => q.fieldKey)).toEqual(['intended_quarry']);
  });
});
