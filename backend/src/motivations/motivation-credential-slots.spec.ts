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

  it('⚠️ USES THE WORDING THE MEMBER’S OWN VAULT ROWS CARRY', () => {
    // `label` for a bolt-action rifle is "Rifle or carbine - manually
    // operated"; derivedCredentialTitle names their document "Competency -
    // Manual Rifle". Two vocabularies for one class means the pill calls it
    // one thing while the list beside it calls it another, and ranking the
    // matching certificate to the top of that list matches nothing.
    expect(credentialSlots(input({ needed: 'rifle-mo' })).neededLabel).toBe(
      'Manual Rifle',
    );
    expect(credentialSlots(input({ needed: 'rifle-sl' })).neededLabel).toBe(
      'Semi-auto Rifle',
    );
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

// ────────────────────────────────────────────────────────────────────
// WHY THE SLOT IS EMPTY.
//
// Operator, 2026-09-08, having worked it out from his own Document Centre:
// "i see there is two handgun competencies popping up in the list, could that
// be the reason it doesnt pull in and the proficiency also dont follow?"
//
// He was right. The autolink refuses to choose between two certificates that
// both cover the firearm — the wrong one in front of a DFO is the failure that
// makes automation untrustworthy — and it says so in a `skipped` list that
// nothing renders. He should not have had to guess.
// ────────────────────────────────────────────────────────────────────
describe('the note on an empty slot', () => {
  it('⚠️ SAYS WE COULD NOT CHOOSE, WHEN THAT IS WHY', () => {
    const r = credentialSlots(
      input({ inCentre: { COMPETENCY_CERTIFICATE: 2, PROFICIENCY_CERTIFICATE: 0 } }),
    );
    expect(r.competency.note).toContain('2 saved');
    expect(r.competency.note).toContain('could not tell which one');
  });

  it('⚠️ SAYS NOTHING WITH ONE IN THE CENTRE — that is a different fault', () => {
    // One document and an empty slot means something ELSE went wrong, and this
    // sentence would be a confident wrong answer.
    const r = credentialSlots(
      input({ inCentre: { COMPETENCY_CERTIFICATE: 1, PROFICIENCY_CERTIFICATE: 0 } }),
    );
    expect(r.competency.note).toBeUndefined();
  });

  it('says nothing when the Centre is empty, which explains itself', () => {
    expect(credentialSlots(input()).competency.note).toBeUndefined();
  });

  it('⚠️ AND NOTHING ONCE THE DOCUMENT IS IN THE PACK', () => {
    const r = credentialSlots(
      input({
        attached: [page('COMPETENCY_CERTIFICATE')],
        inCentre: { COMPETENCY_CERTIFICATE: 4, PROFICIENCY_CERTIFICATE: 0 },
      }),
    );
    expect(r.competency.note).toBeUndefined();
  });
});
