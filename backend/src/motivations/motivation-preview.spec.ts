import { MotivationLicenceType } from '@prisma/client';
import { buildPreview, cardSentences, previewFor } from './motivation-preview';
import { S13_REASONS } from './motivation-cards';

// ────────────────────────────────────────────────────────────────────
// "WHAT YOUR MOTIVATION WILL SAY" — the live preview.
//
// Two properties carry the whole feature and both are here: it is
// DETERMINISTIC (the same answers always produce the same text, so the
// document does not appear to rewrite itself while somebody reads it), and it
// only ever REPEATS WHAT IT WAS GIVEN (it never infers, never fills a gap and
// never softens an absence).
// ────────────────────────────────────────────────────────────────────

const S13 = MotivationLicenceType.S13_SELF_DEFENCE;
const SPORT = MotivationLicenceType.S16_DEDICATED_SPORT;

const FILLED: Record<string, string> = {
  full_name: 'Johan Pretorius',
  id_number: '8905125800087',
  residential_address: '36 Kerkstraat, Polokwane',
  occupation: 'Site foreman',
  firearm_type: 'Handgun',
  firearm_make: 'CZ',
  firearm_model: 'Shadow 2',
  firearm_calibre: '9mm Parabellum',
};

describe('determinism', () => {
  it('produces identical output for identical answers', () => {
    // ⚠️ THE REASON THERE IS NO MODEL CALL. The drawer refetches this on every
    // saved answer; prose that changed each time would teach the member their
    // document is being invented around them.
    expect(buildPreview(S13, FILLED)).toEqual(buildPreview(S13, FILLED));
  });

  it('keeps every section even when it has nothing to say', () => {
    // The drawer doubles as a map of what the document will contain. Dropping
    // empties would make headings appear as somebody answered, which reads as
    // the document growing rather than filling in.
    const empty = buildPreview(S13, {});
    const full = buildPreview(S13, FILLED);
    expect(empty.map((s) => s.id)).toEqual(full.map((s) => s.id));
    expect(empty.length).toBeGreaterThan(5);
  });

  it('gives every section a placeholder, so nothing renders blank', () => {
    for (const type of Object.values(MotivationLicenceType)) {
      for (const s of buildPreview(type, {})) {
        expect(s.placeholder.trim().length).toBeGreaterThan(10);
        expect(s.heading.trim()).not.toBe('');
      }
    }
  });
});

describe('it repeats what it was given, and nothing else', () => {
  it('says nothing at all for an empty application', () => {
    const { empty } = previewFor(S13, {});
    expect(empty).toBe(true);
  });

  it('opens with the particulars once they exist', () => {
    const intro = buildPreview(S13, FILLED).find((s) => s.id === 'introduction')!;
    expect(intro.paragraphs.join(' ')).toContain('Johan Pretorius');
    expect(intro.paragraphs.join(' ')).toContain('8905125800087');
    expect(intro.paragraphs.join(' ')).toContain('CZ Shadow 2');
  });

  it('never invents a name for somebody who has not given one', () => {
    const intro = buildPreview(S13, { firearm_make: 'CZ' }).find(
      (s) => s.id === 'introduction',
    )!;
    expect(intro.paragraphs.join(' ')).not.toMatch(/\bI am\b/);
  });

  it('withholds a clean record, and shows a disclosure', () => {
    // ⚠️ THE SAME RULE AS NEVER_PROMPTED, VISIBLE ON SCREEN. Six "No" answers
    // are not an argument; printing them would be the padding ABSOLUTE RULE 7
    // forbids. A disclosure is the opposite — the one thing the document must
    // meet head-on.
    const clean = buildPreview(S13, {
      ...FILLED,
      history_conviction: 'No',
      history_pending_case: 'No',
    }).find((s) => s.id === 'compliance_history')!;
    expect(clean.paragraphs).toEqual([]);

    const disclosed = buildPreview(S13, {
      ...FILLED,
      history_conviction: 'Yes',
      history_conviction_detail: 'Reckless driving, Polokwane, 2014, fined.',
    }).find((s) => s.id === 'compliance_history')!;
    expect(disclosed.paragraphs.join(' ')).toContain('Reckless driving');
  });
});

describe('a tapped card becomes a sentence', () => {
  it('shows the card verbatim, and marks it as coming from a card', () => {
    // ⚠️ THE FEEDBACK LOOP THE WHOLE PREVIEW EXISTS FOR. The member taps a
    // tile and sees that exact sentence land in the document, highlighted.
    const sentence = S13_REASONS.find((c) => c.key === 'night_travel')!.sentence;
    const section = buildPreview(S13, {
      ...FILLED,
      s13_reasons: 'night_travel',
    }).find((s) => s.id === 'the_threat')!;

    expect(section.paragraphs).toContain(sentence);
    expect(section.fromCards).toContain(sentence);
  });

  it('shows nothing for a card that was not tapped', () => {
    const sentence = S13_REASONS.find((c) => c.key === 'rented')!.sentence;
    const section = buildPreview(S13, {
      ...FILLED,
      s13_reasons: 'night_travel',
    }).find((s) => s.id === 'the_threat')!;
    expect(section.paragraphs).not.toContain(sentence);
  });

  it('skips a stored key the card set no longer offers', () => {
    // ⚠️ NEVER PRINT A RAW SLUG. A retired option must show one fewer
    // sentence — which is honest — rather than leaking `precinct_crime` into
    // a document as if it were prose.
    const out = cardSentences({ s13_reasons: 'night_travel, retired_key' }, 's13_reasons');
    expect(out).toHaveLength(1);
    expect(out.join(' ')).not.toContain('retired_key');
  });
});

describe('the premises paragraph', () => {
  it('is written from the taps, not from the free-text box', () => {
    // The whole reason the section exists: every approved motivation carries a
    // security paragraph, and the registry could not write one before.
    const section = buildPreview(S13, {
      ...FILLED,
      premises_enclosure: 'Walled',
      armed_response: 'Yes',
      burglar_bars: 'Yes',
      safe_present: 'Yes',
      safe_type: 'Handgun safe',
      safe_mounted: 'Yes',
      safe_mounted_to: 'Both',
    }).find((s) => s.id === 'storage_safety')!;

    const text = section.paragraphs.join(' ');
    expect(text).toContain('walled');
    expect(text).toContain('armed response');
    expect(text).toContain('burglar bars');
    // 'Both' is two boxes on the form and reads as both here too.
    expect(text).toContain('wall and the floor');
  });
});

describe('the sport path', () => {
  it('writes the sport cards for a dedicated sports shooter', () => {
    const section = buildPreview(SPORT, {
      ...FILLED,
      sport_reasons: 'own_equipment',
      sport_formats: 'club',
    }).find((s) => s.id === 'the_discipline' || s.id === 'the_quarry')!;
    expect(section.fromCards.length).toBeGreaterThan(1);
  });
});
