import { parseCard, type Word } from './licence-card-ocr.service';

// ────────────────────────────────────────────────────────────────────
// THE TWO-COLUMN PARSE.
//
// The card puts two label/value pairs on one physical line:
//
//     Serial Number  ZA2226548        Type   S/L: RIFLE CAL - RIFLE/CARBINE
//     Make           NORDISKE PREC.   Model  NONE
//
// Read as a stream of text, "Make" happily swallows "Model NONE" and the value
// of Type lands on Serial Number. These fixtures reproduce the geometry of the
// operator's own five cards so the column logic is pinned — the same five that
// motivation-consent-statement.spec.ts asserts the OUTPUT of.
//
// ⚠️ WHAT IS BEING PROTECTED IS A SIGNED STATEMENT. A parse that pairs the
// wrong serial with the wrong component does not look broken; it looks like a
// filled-in form, and it goes to a DFO under somebody's signature.
// ────────────────────────────────────────────────────────────────────

/** Lay words out on a grid: each row is a band, each cell starts at a column. */
function layout(rows: [number, string][][]): Word[] {
  const words: Word[] = [];
  rows.forEach((row, r) => {
    const yMid = 100 + r * 40;
    for (const [col, text] of row) {
      let x = col;
      for (const t of text.split(' ')) {
        words.push({ text: t, x0: x, x1: x + t.length * 10, yMid, height: 20 });
        x += t.length * 10 + 8;
      }
    }
  });
  return words;
}

describe('a label claims only the words to its right', () => {
  it('NORDISKE: keeps the two columns apart on a shared line', () => {
    const f = parseCard(
      layout([
        [
          [0, 'Serial Number'],
          [200, 'ZA2226548'],
          [500, 'Type'],
          [600, 'S/L: RIFLE CAL - RIFLE/CARBINE'],
        ],
        [
          [0, 'Make'],
          [200, 'NORDISKE PRECISION'],
          [500, 'Model'],
          [600, 'NONE'],
        ],
        [
          [0, 'Calibre'],
          [200, '.223 REM'],
        ],
      ]),
    );
    // The failure this guards: Make = "NORDISKE PRECISION Model NONE".
    expect(f.make).toBe('NORDISKE PRECISION');
    expect(f.model).toBe('NONE');
    expect(f.serial).toBe('ZA2226548');
    expect(f.type).toBe('S/L: RIFLE CAL - RIFLE/CARBINE');
    expect(f.calibre).toBe('.223 REM');
  });

  it('NORDISKE: barrel and receiver serials stay one digit apart', () => {
    const f = parseCard(
      layout([
        [
          [0, 'Barrel Serial No'],
          [250, 'ZA2226548'],
          [600, 'Make'],
          [700, 'NORDISKE PRECISION'],
        ],
        [
          [0, 'Receiver Serial No'],
          [250, 'ZA22265488'],
          [600, 'Make'],
          [700, 'NORDISKE PRECISION'],
        ],
        [
          [0, 'Frame Serial No'],
          [250, 'NONE'],
          [600, 'Make'],
          [700, 'NONE'],
        ],
      ]),
    );
    expect(f.barrelSerial).toBe('ZA2226548');
    expect(f.receiverSerial).toBe('ZA22265488');
    expect(f.barrelSerial).not.toBe(f.receiverSerial);
    expect(f.frameSerial).toBe('NONE');
  });

  it('MARLIN: barrel reads NONE while the receiver carries the number', () => {
    // The card that breaks any "the serial is the barrel row" shortcut.
    const f = parseCard(
      layout([
        [
          [0, 'Barrel Serial No'],
          [250, 'NONE'],
        ],
        [
          [0, 'Receiver Serial No'],
          [250, 'MR90189D'],
        ],
        [
          [0, 'Frame Serial No'],
          [250, 'NONE'],
        ],
      ]),
    );
    expect(f.barrelSerial).toBe('NONE');
    expect(f.receiverSerial).toBe('MR90189D');
    expect(f.frameSerial).toBe('NONE');
  });

  it('HOWA: three identical serials all parse, none collapse', () => {
    const f = parseCard(
      layout([
        [
          [0, 'Barrel Serial No'],
          [250, 'B477423'],
        ],
        [
          [0, 'Receiver Serial No'],
          [250, 'B477423'],
        ],
        [
          [0, 'Frame Serial No'],
          [250, 'B477423'],
        ],
      ]),
    );
    expect(f.barrelSerial).toBe('B477423');
    expect(f.receiverSerial).toBe('B477423');
    expect(f.frameSerial).toBe('B477423');
  });

  it('CZ: "Serial Number" is not stolen by "Barrel Serial No"', () => {
    // Longest-label-first ordering is what stops the prefix match.
    const f = parseCard(
      layout([
        [
          [0, 'Serial Number'],
          [200, '81815'],
          [500, 'Type'],
          [600, 'HANDGUN'],
        ],
        [
          [0, 'Barrel Serial No'],
          [250, '81815'],
        ],
      ]),
    );
    expect(f.serial).toBe('81815');
    expect(f.barrelSerial).toBe('81815');
    expect(f.type).toBe('HANDGUN');
  });

  it('reads the section off its own unlabelled line', () => {
    expect(parseCard(layout([[[0, 'SECTION 16']]])).section).toBe('SECTION 16');
    expect(parseCard(layout([[[0, 'SECTION 15']]])).section).toBe('SECTION 15');
  });
});

describe('what it refuses to invent', () => {
  it('⚠️ LEAVES A FIELD UNDEFINED RATHER THAN CALLING IT NONE', () => {
    // The whole safety property. A label with nothing legible after it is a
    // field we FAILED TO READ; "NONE" is a fact the card asserts. Writing the
    // second when we mean the first puts a false statement on a signed
    // consent, and the seller loses the chance to correct it because the form
    // looks filled in.
    const f = parseCard(
      layout([
        [
          [0, 'Make'],
          [200, 'MAUSER'],
        ],
        [[0, 'Calibre']], // label present, value unreadable
      ]),
    );
    expect(f.make).toBe('MAUSER');
    expect(f.calibre).toBeUndefined();
    expect(Object.values(f)).not.toContain('');
  });

  it('returns nothing at all from a page with no labels on it', () => {
    expect(parseCard(layout([[[0, 'some unrelated photograph']]]))).toEqual({});
  });

  it('keeps the FIRST reading when a label appears twice', () => {
    // Both sides of a card can carry "Make". Later blurred repeats must not
    // overwrite a clean first read.
    const f = parseCard(
      layout([
        [
          [0, 'Make'],
          [200, 'MAUSER'],
        ],
        [
          [0, 'Make'],
          [200, 'MAUSEB'],
        ],
      ]),
    );
    expect(f.make).toBe('MAUSER');
  });
});
