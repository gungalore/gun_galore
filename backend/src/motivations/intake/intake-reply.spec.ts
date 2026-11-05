import {
  correctionFor,
  isCorrectableField,
  parseIntakeReply,
} from './intake-reply';

// ────────────────────────────────────────────────────────────────────
// MO000063 FAILED THREE TIMES BECAUSE NOBODY CORRECTED THE SPELLING.
//
// The applicant typed `mosberg` and `12 gayge`. The writer wrote "Mossberg"
// and "12 Gauge" — correctly — and both validators refused the corrected text
// because they compared against the raw strings. Correction used to happen in
// the agent turn, which became opt-in for latency.
// ────────────────────────────────────────────────────────────────────
describe('parseIntakeReply', () => {
  it('reads the corrected answer out of a one-shot reply', () => {
    const parsed = parseIntakeReply(
      JSON.stringify({
        acknowledgement: 'Noted.',
        question: 'Which model is your Mossberg?',
        correctedAnswer: 'Mossberg',
      }),
    );
    expect(parsed?.question).toBe('Which model is your Mossberg?');
    expect(parsed?.correctedAnswer).toBe('Mossberg');
  });

  it('tolerates prose around the object', () => {
    const parsed = parseIntakeReply(
      'Here you go:\n{"question":"What model?","correctedAnswer":"12 Gauge"}\nThanks.',
    );
    expect(parsed?.correctedAnswer).toBe('12 Gauge');
  });

  it('is null when there is no question', () => {
    expect(parseIntakeReply('{"correctedAnswer":"Mossberg"}')).toBeNull();
    expect(parseIntakeReply('')).toBeNull();
    expect(parseIntakeReply('not json')).toBeNull();
  });
});

describe('correctionFor', () => {
  const reply = { correctedAnswer: 'Mossberg' };

  it('returns the correction for a correctable field', () => {
    expect(correctionFor('firearm_make', reply)).toBe('Mossberg');
    expect(correctionFor('firearm_calibre', reply)).toBe('Mossberg');
  });

  // ⚠️ A MODEL SUGGESTION MUST NEVER REWRITE AN ID NUMBER, AN ADDRESS OR A
  // DECLARATION ANSWER. This is the gate that keeps it away from them.
  it('ignores a correction for a field it may not touch', () => {
    expect(correctionFor('id_number', reply)).toBeUndefined();
    expect(correctionFor('residential_address', reply)).toBeUndefined();
    expect(correctionFor(null, reply)).toBeUndefined();
  });

  it('is undefined when the reply carries no correction', () => {
    expect(correctionFor('firearm_make', {})).toBeUndefined();
    expect(correctionFor('firearm_make', null)).toBeUndefined();
  });
});

describe('isCorrectableField', () => {
  it('covers the four firearm identity fields and nothing else', () => {
    for (const key of [
      'firearm_type',
      'firearm_action',
      'firearm_make',
      'firearm_model',
      'firearm_calibre',
    ]) {
      expect(isCorrectableField(key)).toBe(true);
    }
    for (const key of ['id_number', 'full_name', 'history_conviction']) {
      expect(isCorrectableField(key)).toBe(false);
    }
  });
});
