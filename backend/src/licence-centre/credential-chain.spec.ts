// backend/src/licence-centre/credential-chain.spec.ts
//
// THE WHOLE CHAIN, ON REAL DOCUMENTS: a scan becomes a filed credential,
// a filed licence gives a competency its expiry date, and both land on a
// motivation in the fields the form actually prints.
//
// Every link here is already covered by its own tests. None of them catches
// the chain coming apart, because each link keeps working when the next one
// stops receiving what it expects — and the whole thing fails SILENTLY:
//
//   · a licence whose type does not resolve is EXCLUDED from the derivation
//     (null is excluded, never defaulted — deliberately, so an unidentifiable
//     firearm cannot push a competency's expiry out)
//   · a competency with no qualifying licence falls to the five-year
//     assumption, which mayArmDerivedExpiry refuses to arm
//   · so the certificate ends up with no date, nothing errors, and nobody is
//     reminded before it lapses
//
// That is not hypothetical. It is what these fixtures did until the firearm
// type pattern was fixed: three of the seven licences are handguns, printed
// as a bare "HANDGUN" line, and the pattern required a character before the
// keyword — so all three read as untyped and the handgun competency lost its
// date. Seven licences on screen, everything green, no date on the
// certificate.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { toMotivationAnswers } from '../common/document-fields';
import {
  categoryFromText,
  deriveCertificateExpiry,
  parseEndorsements,
  type LinkedLicence,
} from '../common/sa-competency';
import { extractDocument } from './textract-document-extract';

const DIR = join(__dirname, '__fixtures__', 'textract');
const fx = (doc: string) =>
  JSON.parse(readFileSync(join(DIR, `${doc}.json`), 'utf8'));

const LICENCE_FIELDS = [
  'licence_number',
  'holder_name',
  'firearm_type',
  'make',
  'calibre',
  'frame_serial',
  'barrel_serial',
  'section',
];
const COMPETENCY_FIELDS = [
  'competency_number',
  'holder_name',
  'covers',
  'competency_issued',
];

const LICENCES = ['doc03', 'doc04', 'doc05', 'doc06', 'doc07', 'doc08', 'doc09'];

const readLicence = (doc: string) =>
  extractDocument(fx(doc), 'FIREARM_LICENCE' as never, LICENCE_FIELDS);
const readCompetency = (doc: string) =>
  extractDocument(fx(doc), 'COMPETENCY_CERTIFICATE' as never, COMPETENCY_FIELDS);

/** The member's real licences, as the derivation would see them. */
const linked = (): LinkedLicence[] =>
  LICENCES.map(readLicence)
    .map((r) => ({
      category: categoryFromText(r.reading.details.firearm_type ?? ''),
      expiresOn: r.reading.expiresOn ? new Date(r.reading.expiresOn) : null,
    }))
    .filter((l): l is LinkedLicence => !!l.category && !!l.expiresOn);

describe('every licence resolves to a category', () => {
  it.each(LICENCES)('%s', (doc) => {
    const type = readLicence(doc).reading.details.firearm_type ?? '';
    expect(type).not.toBe('');
    expect(categoryFromText(type)).not.toBeNull();
  });

  // 🚨 THE REGRESSION. A handgun licence prints the type as a bare line
  // reading exactly "HANDGUN", with nothing before it.
  it('reads a bare HANDGUN line, with no leading word', () => {
    for (const doc of ['doc04', 'doc07', 'doc09']) {
      expect(readLicence(doc).reading.details.firearm_type).toBe('HANDGUN');
      expect(categoryFromText('HANDGUN')).toBe('handgun');
    }
  });

  it('all seven are usable by the derivation', () => {
    expect(linked()).toHaveLength(7);
  });
});

describe('a competency takes its expiry from the licences it covers', () => {
  const ISSUED = new Date('2016-02-08');

  it.each([
    ['doc12', ['handgun']],
    ['doc13', ['rifle-mo']],
    ['doc15', ['rifle-sl', 'shotgun']],
  ])('%s endorses %s and dates off a licence', (doc, expected) => {
    const covers = readCompetency(doc as string).reading.details.covers ?? '';
    expect(parseEndorsements(covers)).toEqual(expected);

    const out = deriveCertificateExpiry({
      endorsements: parseEndorsements(covers),
      issuedOn: ISSUED,
      licences: linked(),
    });
    // 'licence' means a real licence backed it. 'fallback' is the five-year
    // assumption, which is never armed — a certificate reaching that state
    // silently ends up with no date at all.
    expect(out.basis).toBe('licence');
    expect(out.on).not.toBeNull();
  });

  // The two vocabularies are deliberately different — a competency splits
  // self-loading from manually-operated, a licence does not — and they have
  // to meet somewhere. This is that somewhere.
  it('matches rifle-mo and rifle-sl endorsements to rifle-carbine licences', () => {
    for (const e of ['rifle-mo', 'rifle-sl'] as const) {
      const out = deriveCertificateExpiry({
        endorsements: [e],
        issuedOn: ISSUED,
        licences: linked().filter((l) => l.category === 'rifle-carbine'),
      });
      expect(out.basis).toBe('licence');
    }
  });
});

describe('what reaches the motivation', () => {
  it('fills the owned-firearm rows the form prints', () => {
    const a = toMotivationAnswers(
      'FIREARM_LICENCE',
      readLicence('doc04').reading.details,
      2,
    );
    expect(a).toMatchObject({
      existing_firearm_2_type: 'HANDGUN',
      existing_firearm_2_make: 'GLOCK',
    });
  });

  it('numbers each licence into its own row', () => {
    // ⚠️ WITHOUT THE ROW NUMBER EVERY LICENCE OVERWRITES THE FIRST. Seven
    // firearms would print as one.
    const keys = LICENCES.flatMap((doc, i) =>
      Object.keys(
        toMotivationAnswers('FIREARM_LICENCE', readLicence(doc).reading.details, i + 1),
      ),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('carries the endorsement across as competency_for', () => {
    // The vault calls it `covers`, the form calls it `competency_for`. The
    // alias table is the only thing joining them.
    const a = toMotivationAnswers(
      'COMPETENCY_CERTIFICATE',
      readCompetency('doc15').reading.details,
    );
    expect(a.competency_for).toBe('S/L-RIFLE/CA RB/PIST CAL CARB/SHOTGUN');
  });

  // Reference §4.8.2: line 1 of that block is always "COMPETENCY TO POSSESS A
  // FIREARM" — identical on every certificate. It is printed on the form, so
  // leaving it in puts eleven words of boilerplate where an assessor is
  // looking for the endorsement.
  it('does not print the boilerplate line onto the form', () => {
    for (const doc of ['doc12', 'doc13', 'doc15']) {
      expect(readCompetency(doc).reading.details.covers).not.toMatch(
        /COMPETENCY TO POSSESS/i,
      );
    }
  });
});
