import { displayCalibre } from './saps-vocabulary';

// ────────────────────────────────────────────────────────────────────
// HOW A CALIBRE IS PRINTED.
//
// "9MM PAR ( 9X19MM )" appeared three times in MO000071, verbatim — which is
// how the string sits on the operator's licence card. A card is a source, not
// a house style.
// ────────────────────────────────────────────────────────────────────
describe('displayCalibre', () => {
  it('tidies the string the card actually prints', () => {
    expect(displayCalibre('9MM PAR ( 9X19MM )')).toBe('9mm Parabellum (9x19mm)');
  });

  it('expands the abbreviations a card uses', () => {
    expect(displayCalibre('.308 WIN')).toBe('.308 Winchester');
    expect(displayCalibre('.45-70 GOVT')).toBe('.45-70 Government');
    expect(displayCalibre('.300 Win Mag')).toBe('.300 Winchester Magnum');
  });

  it('⚠️ LEAVES A STRING A PERSON ALREADY WROTE ALONE', () => {
    // Title-casing everything turns "6.5mm Creedmoor" into "6.5Mm Creedmoor".
    // Only an ALL-CAPITALS string is being shouted by a card reader rather
    // than written by anybody.
    expect(displayCalibre('6.5mm Creedmoor')).toBe('6.5mm Creedmoor');
    expect(displayCalibre('.38 Special')).toBe('.38 Special');
  });

  it('⚠️ NEVER RESOLVES AN AMBIGUOUS NAME — that is findCartridge’s job', () => {
    // "9 mm" touches Luger, Makarov and Browning court. A printer quietly
    // deciding which would put a cartridge nobody chose into a signed document.
    expect(displayCalibre('9 MM')).toBe('9 mm');
    expect(displayCalibre('9mm')).toBe('9mm');
  });

  it('gives back a calibre it does not recognise, tidied', () => {
    expect(displayCalibre('  12 GAUGE ')).toBe('12 Gauge');
    expect(displayCalibre('')).toBe('');
    expect(displayCalibre(undefined)).toBe('');
    expect(displayCalibre(null)).toBe('');
  });
});
