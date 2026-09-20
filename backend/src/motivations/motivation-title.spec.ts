import { MotivationLicenceType } from '@prisma/client';
import { motivationTitle } from './motivation-title';

// ────────────────────────────────────────────────────────────────────
// THE NAME ON THE LIST IS THE FIREARM AND THE SECTION.
//
// Operator, 2026-09-20: "Once the firearm that is being applied for is in the
// pack the name of the motivation should change to the Make and calibre of the
// firearm followed by which section it is."
// ────────────────────────────────────────────────────────────────────

const S13 = MotivationLicenceType.S13_SELF_DEFENCE;
const S16 = MotivationLicenceType.S16_DEDICATED_SPORT;

describe('motivationTitle', () => {
  it('names the firearm and the section', () => {
    expect(
      motivationTitle(S13, {
        firearm_make: 'Glock',
        firearm_model: '19',
        firearm_calibre: '9mm',
      }),
    ).toBe('Glock 19 9mm — Section 13');
  });

  it('works without a model, which many applications leave blank', () => {
    expect(
      motivationTitle(S16, { firearm_make: 'CZ', firearm_calibre: '.308' }),
    ).toBe('CZ .308 — Section 16');
  });

  it('falls back to the section label before a firearm is described', () => {
    expect(motivationTitle(S16, {})).toBe(
      'Section 16 — Dedicated sport shooter',
    );
  });

  it('⚠️ LETS THE MEMBER’S OWN NAME WIN', () => {
    expect(
      motivationTitle(
        S13,
        { firearm_make: 'Glock', firearm_model: '19', firearm_calibre: '9mm' },
        'Home defence',
      ),
    ).toBe('Home defence');
  });

  it('ignores a whitespace-only name', () => {
    expect(motivationTitle(S13, { firearm_make: 'Glock' }, '   ')).toBe(
      'Glock — Section 13',
    );
  });
});
