import { MotivationExtractService } from './motivation-extract.service';

// ────────────────────────────────────────────────────────────────────
// "WHAT YOUR COMPETENCY COVERS" NEVER FILLED ITSELF IN, AND THIS IS WHY.
//
// Operator, item 4 of twelve, 2026-08-24: "we should read the competency
// certificate and add it automatically."
//
// The reading always worked. The result was binned one line before it was
// used: competency_for is a `multi` field, so its value is comma-joined, and
// the guard tested the WHOLE string against the single offered choices —
//
//     if (field.choices && !field.choices.includes(value)) continue;
//
// — a bare `continue` with no log, no note and no counter. "Handgun, Rifle"
// failed. "HANDGUN" failed on case. Anything a real certificate prints failed
// on vocabulary. Every path led to the same silent drop, which is why it
// looked like the extraction simply did not run.
//
// These tests drive the parse step directly, because that is where the bug
// was — no Anthropic call, no fixture image.
// ────────────────────────────────────────────────────────────────────

type Parse = (
  text: string,
  asked: { key: string; label: string; kind?: string; choices?: readonly string[] }[],
  kind: string,
) => { key: string; value: string }[];

const svc = new MotivationExtractService();
// The parse step is private by design; reaching it keeps the test honest about
// WHERE the defect was rather than mocking the model around it.
const parse = (svc as unknown as { parse: Parse }).parse.bind(svc);

const COMPETENCY_FOR = {
  key: 'competency_for',
  label: 'What your competency covers',
  kind: 'multi',
  choices: [
    'Handgun — non-self-loading (revolver)',
    'Handgun — self-loading (pistol)',
    'Shotgun — manually operated (pump / break / bolt)',
    'Shotgun — self-loading',
    'Rifle or carbine — manually operated (bolt / lever / pump / single shot)',
    'Rifle or carbine — self-loading (includes pistol calibre carbine)',
    'Muzzle loading firearm',
  ],
};

const model = (value: string) =>
  JSON.stringify({ fields: [{ key: 'competency_for', value, confidence: 'high' }] });

describe('competency_for now survives the read', () => {
  it('⚠️ reads the compound endorsement a real certificate prints', () => {
    // Verbatim transcription is what the system prompt DEMANDS ("you are a
    // transcriber, not an interpreter"), and it is exactly what the old guard
    // threw away.
    const out = parse(
      model('S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN'),
      [COMPETENCY_FOR],
      'COMPETENCY_CERTIFICATE',
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toContain('Shotgun — self-loading');
    expect(out[0].value).toContain('Rifle or carbine — self-loading');
  });

  it('reads the written-out form SAPS uses on other certificates', () => {
    const out = parse(
      model('Handgun, self-loading'),
      [COMPETENCY_FOR],
      'COMPETENCY_CERTIFICATE',
    );
    expect(out[0].value).toBe('Handgun — self-loading (pistol)');
  });

  it('⚠️ keeps SEVERAL endorsements, which is the case that failed hardest', () => {
    const out = parse(
      model('N/S/L HG, M/O RIFLE/CARB'),
      [COMPETENCY_FOR],
      'COMPETENCY_CERTIFICATE',
    );
    const parts = out[0].value.split(', ');
    expect(parts).toHaveLength(2);
    expect(out[0].value).toContain('Handgun — non-self-loading');
    expect(out[0].value).toContain('Rifle or carbine — manually operated');
  });

  it('⚠️ files a pistol calibre carbine as a rifle, never a handgun', () => {
    const out = parse(
      model('S/L PIST CAL CARB'),
      [COMPETENCY_FOR],
      'COMPETENCY_CERTIFICATE',
    );
    expect(out[0].value).toContain('Rifle or carbine');
    expect(out[0].value).not.toContain('Handgun');
  });

  it('proposes nothing rather than a guess when the action is not stated', () => {
    // "RIFLE" alone does not say self-loading or manually operated, and the
    // two differ in what may be licensed under which section.
    const out = parse(model('RIFLE'), [COMPETENCY_FOR], 'COMPETENCY_CERTIFICATE');
    expect(out).toEqual([]);
  });
});

describe('the multi guard that dropped everything', () => {
  const MULTI = {
    key: 'discipline',
    label: 'Discipline',
    kind: 'multi',
    choices: ['Alpha', 'Beta'],
  };

  it('⚠️ accepts a comma-joined multi value — the exact shape that was binned', () => {
    const out = parse(
      JSON.stringify({ fields: [{ key: 'discipline', value: 'Alpha, Beta', confidence: 'high' }] }),
      [MULTI],
      'ASSOCIATION_CARD',
    );
    expect(out[0].value).toBe('Alpha, Beta');
  });

  it('canonicalises casing so the save path accepts it', () => {
    // sanitiseAnswers matches exactly; "alpha" would be REFUSED on save even
    // after surviving extraction.
    const out = parse(
      JSON.stringify({ fields: [{ key: 'discipline', value: 'alpha', confidence: 'high' }] }),
      [MULTI],
      'ASSOCIATION_CARD',
    );
    expect(out[0].value).toBe('Alpha');
  });

  it('still refuses a value that is not on the list at all', () => {
    const out = parse(
      JSON.stringify({ fields: [{ key: 'discipline', value: 'Gamma', confidence: 'high' }] }),
      [MULTI],
      'ASSOCIATION_CARD',
    );
    expect(out).toEqual([]);
  });

  it('refuses a multi value where only SOME parts are real', () => {
    const out = parse(
      JSON.stringify({ fields: [{ key: 'discipline', value: 'Alpha, Gamma', confidence: 'high' }] }),
      [MULTI],
      'ASSOCIATION_CARD',
    );
    expect(out).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────
// THE EXTRACTION MUST NOT DEPEND ON VISION BEING REACHABLE.
//
// The Vision key is IP-restricted to the live box, so off it there is no OCR
// text at all — which is the state every developer machine and CI run is in.
// The service is constructed WITHOUT a Vision dependency here, exactly as it
// would degrade in production if the key were revoked.
// ────────────────────────────────────────────────────────────────────
describe('reading a document with no OCR text available', () => {
  it('still parses everything it did before', () => {
    const bare = new MotivationExtractService();
    const parseBare = (bare as unknown as { parse: Parse }).parse.bind(bare);
    const out = parseBare(
      model('S/L-RIFLE/CARB/SHOTGUN'),
      [COMPETENCY_FOR],
      'COMPETENCY_CERTIFICATE',
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toContain('self-loading');
  });
});
