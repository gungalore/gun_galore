import { credentialSlots, type CredentialSlotsInput } from './motivation-credential-slots';

// ────────────────────────────────────────────────────────────────────
// THE PAIR RULE, WHICH THE OPERATOR HAS NOW ASKED FOR THREE TIMES.
//
// "The correct proficiencies needs to be added as well from the license centre
// or scanned or uploaded"; "it should also scan to see which fire arm is added
// to add the correct competency and proficiency"; "the proficiency needs to be
// added with the competency from the same catogory. One can't be without the
// other."
//
// The first two were answered server-side, in motivation-autolink's
// enforcePair — a rule with no surface, which is why it was asked for again.
// What is asserted here is the SENTENCE a member reads, because that is the
// half that was missing.
// ────────────────────────────────────────────────────────────────────

const input = (over: Partial<CredentialSlotsInput> = {}): CredentialSlotsInput => ({
  needed: 'handgun',
  attached: [],
  inCentre: { COMPETENCY_CERTIFICATE: 0, PROFICIENCY_CERTIFICATE: 0 },
  knowledge: { state: 'CONFIRMED', alert: null },
  ...over,
});

const page = (
  kind: string,
  over: Partial<{ letter: string | null; origin: 'vault' | 'member'; unread: boolean }> = {},
) => ({ kind, letter: 'C', origin: 'vault' as const, unread: false, ...over });

describe('the class it names', () => {
  it('says which class the application needs', () => {
    expect(credentialSlots(input()).neededLabel).toBe('Handgun');
  });

  it('⚠️ SAYS NOTHING WHEN THE FIREARM HAS NOT BEEN DESCRIBED', () => {
    // requiredEndorsement returns null for a combination gun and for a form
    // nobody has filled in yet. Naming a class we have not established would
    // send somebody for the wrong certificate.
    expect(credentialSlots(input({ needed: null })).neededLabel).toBeNull();
  });
});

describe('the pair note', () => {
  it('⚠️ ASKS FOR THE STATEMENT WHEN ONLY THE CERTIFICATE IS HERE', () => {
    const r = credentialSlots(
      input({ attached: [page('COMPETENCY_CERTIFICATE')] }),
    );
    expect(r.pairNote).toContain('statement of results');
    expect(r.pairNote).toContain('handgun');
  });

  it('⚠️ AND SAYS A STATEMENT ALONE IS NOT A COMPETENCY', () => {
    const r = credentialSlots(
      input({ attached: [page('PROFICIENCY_CERTIFICATE')] }),
    );
    expect(r.pairNote).toContain('not a competency');
  });

  it('says nothing when both are here', () => {
    const r = credentialSlots(
      input({
        attached: [
          page('COMPETENCY_CERTIFICATE'),
          page('PROFICIENCY_CERTIFICATE', { letter: 'D' }),
        ],
      }),
    );
    expect(r.pairNote).toBeNull();
  });

  it('⚠️ AND SAYS NOTHING WHEN NEITHER IS — that is an empty section, not a pair problem', () => {
    // Both slots already say they are empty. A third sentence repeating it is
    // the page arguing with itself, which is what the Competency blurb was
    // rewritten to stop.
    expect(credentialSlots(input()).pairNote).toBeNull();
  });

  it('drops the class from the sentence when we cannot name one', () => {
    const r = credentialSlots(
      input({ needed: null, attached: [page('COMPETENCY_CERTIFICATE')] }),
    );
    expect(r.pairNote).toContain('Your competency is here');
  });
});

describe('the slots', () => {
  it('takes only its own kind, and keeps the annexure letter and the origin', () => {
    const r = credentialSlots(
      input({
        attached: [
          page('COMPETENCY_CERTIFICATE', { letter: 'C', origin: 'vault' }),
          page('IDENTITY_DOCUMENT', { letter: 'A' }),
          page('PROFICIENCY_CERTIFICATE', { letter: 'D', origin: 'member', unread: true }),
        ],
      }),
    );
    expect(r.competency.held).toEqual([
      { letter: 'C', origin: 'vault', unread: false },
    ]);
    expect(r.proficiency.held).toEqual([
      { letter: 'D', origin: 'member', unread: true },
    ]);
  });

  it('⚠️ NEVER REPORTS A NEGATIVE COUNT', () => {
    // The count comes from a query that knows nothing about this application,
    // and subtracting what is attached is done by the caller. A member who
    // attached their only certificate must read "nothing else saved".
    const r = credentialSlots(
      input({ inCentre: { COMPETENCY_CERTIFICATE: -1, PROFICIENCY_CERTIFICATE: 2 } }),
    );
    expect(r.competency.inCentre).toBe(0);
    expect(r.proficiency.inCentre).toBe(2);
  });

  it('names the statement of results as the proficiency, not as a certificate', () => {
    // A member looking for "proficiency" must find the word. The training
    // provider prints "statement of results"; SAPS says proficiency.
    const r = credentialSlots(input());
    expect(r.proficiency.label.toLowerCase()).toContain('proficiency');
    expect(r.proficiency.label.toLowerCase()).toContain('statement of results');
  });
});

describe('unit standard 117705', () => {
  it('passes the state through untouched', () => {
    const r = credentialSlots(
      input({ knowledge: { state: 'MISSING', alert: 'We cannot see 117705.' } }),
    );
    expect(r.knowledge).toEqual({ state: 'MISSING', alert: 'We cannot see 117705.' });
  });
});
