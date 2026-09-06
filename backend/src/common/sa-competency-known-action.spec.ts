import { deriveCertificateExpiry } from './sa-competency';

// ────────────────────────────────────────────────────────────────────
// Operator, 2026-09-07: "the Rifle competency still adapts the semi auto
// rifle latest license expiry date. Also state which license will cause the
// Competency to expire."
//
// The .223's card did not print its action, so it counted for EITHER rifle
// endorsement and, running to 2035, outran three bolt rifles ending 2034. A
// rifle whose action we could read and which matches is the licence the
// certificate relates to; an unknown one only stands in when there is none.
// ────────────────────────────────────────────────────────────────────

const ISSUED = new Date('2020-03-01T00:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('a known rifle action beats an unknown one', () => {
  const vault = [
    { category: 'rifle-carbine' as const, selfLoading: null, expiresOn: d('2035-09-21'), title: 'NORDISKE PRECISION 223 REM' },
    { category: 'rifle-carbine' as const, selfLoading: false, expiresOn: d('2034-10-28'), title: 'MAUSER .30-06 SPRINGFIELD' },
    { category: 'rifle-carbine' as const, selfLoading: false, expiresOn: d('2034-10-28'), title: 'MARLIN .45-70 GOVERNMENT' },
    { category: 'rifle-carbine' as const, selfLoading: false, expiresOn: d('2032-11-28'), title: 'HOWA 6.5MM CREEDMOOR' },
    { category: 'handgun' as const, selfLoading: null, expiresOn: d('2035-08-26'), title: 'CZ 6.35MM BROWNING' },
  ];

  it('the manual-rifle competency follows the known manual rifles, not the .223 of unknown action', () => {
    const out = deriveCertificateExpiry({ endorsements: ['rifle-mo'], issuedOn: ISSUED, licences: vault });
    expect(out.on?.toISOString().slice(0, 10)).toBe('2034-10-28');
    expect(out.why).toMatch(/MAUSER \.30-06 SPRINGFIELD|MARLIN \.45-70 GOVERNMENT/);
    expect(out.why).not.toMatch(/223/);
  });

  it('the semi-automatic competency still has the .223 to follow when no known self-loader is held', () => {
    const out = deriveCertificateExpiry({ endorsements: ['rifle-sl', 'shotgun'], issuedOn: ISSUED, licences: vault });
    expect(out.on?.toISOString().slice(0, 10)).toBe('2035-09-21');
    expect(out.why).toMatch(/NORDISKE PRECISION 223 REM/);
  });

  it('names the licence the competency expires with', () => {
    const out = deriveCertificateExpiry({ endorsements: ['handgun'], issuedOn: ISSUED, licences: vault });
    expect(out.why).toMatch(/^It follows your CZ 6\.35MM BROWNING licence, which runs to 2035-08-26, and expires with it\./);
  });

  it('falls back to the old wording when the vault gave no name', () => {
    const out = deriveCertificateExpiry({
      endorsements: ['handgun'],
      issuedOn: ISSUED,
      licences: [{ category: 'handgun', expiresOn: d('2030-01-01') }],
    });
    expect(out.why).toMatch(/longest-running licence in this category/);
  });
});
