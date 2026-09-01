import { readMarkers } from './document-markers';
import { parseUnitStandards } from './sa-competency';

// ────────────────────────────────────────────────────────────────────
// HOW MUCH OCR DAMAGE THE CLASSIFIER SURVIVES.
//
// ⚠️ THIS EXISTS BECAUSE THE ANSWER WAS "ALMOST NONE" AND NOBODY KNEW.
// Measured against the real document texts, corrupting them with the
// confusions a real engine makes, the classifier needed 99.5% character
// accuracy to be right 95% of the time:
//
//     character accuracy   classified correctly (before)
//         99.5%                   95%
//         99%                     90%
//         98%                     80%
//         95%                     52%
//
// Tesseract benchmarks around 92% on English print. No independent English
// figure exists for PP-OCRv4 at all. Google Vision only clears that bar
// because it does undocumented deskew and denoise work server-side — which is
// to say, the requirement quietly ruled out every local engine, and replacing
// Vision would have regressed extraction SILENTLY, because ocr() fails soft
// and a member simply sees fewer fields filled in.
//
// ⚠️ AND THE REQUIREMENT WAS OURS, NOT OCR'S. The documents that degraded
// fastest were the ones anchored on ONE long exact phrase — the old plastic
// competency card on 38 characters, the licence card on 26 — while SAPS 524
// and the PFTC statements held up because they carry several independent
// short markers. So the fix was redundancy in the anchors, not a better
// engine. See ocr-tolerant.ts.
//
// This spec is the guard on that. It is deliberately a MEASUREMENT with a
// floor rather than an exact assertion: the corruption is random, so the
// number moves a little between seeds, and pinning it exactly would make it
// flaky. What must not move is the floor.
// ────────────────────────────────────────────────────────────────────

/** The plastic competency card: worst performer before the change. */
const COMPETENCY_CARD = `COMPETENCY CERTIFICATE
Section 10 of the Firearms Control Act, 60 of 2000
COMPETENCY TO POSSESS A FIREARM
HANDGUN
VUURWAPENLISENSIEFIREARMLICENCE
Completed the relevent tests as prescribed by the Firearms Control Act, 2000.`;

/** The licence card: second worst, and its only anchor is one phrase. */
const LICENCE_CARD = `Licence To Possess a Firearm
Firearms Control Act, 60 of 2000
SECTION 16
Serial Number   Make   Calibre
Type  HANDGUN   Model NONE
Barrel Serial No   Receiver Serial No   Frame Serial No
VUURWAPENLISENSIEFIREARMLICENCE`;

/** SAPS 271 — the APPLICATION. Must never read back as the licence. */
const APPLICATION = `SOUTH AFRICAN POLICE SERVICE
SAPS 271
APPLICATION FOR A LICENCE TO POSSESS A FIREARM
Serial Number   Make   Calibre
Section 16 of the Firearms Control Act, 2000`;

/** Deterministic, so a failure is reproducible rather than a mood. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// The substitutions an engine actually makes, in the direction it makes them.
const SWAP: Record<string, string> = {
  O: '0',
  o: '0',
  '0': 'O',
  l: '1',
  I: '1',
  '1': 'l',
  i: 'l',
  S: '5',
  s: '5',
  '5': 'S',
  B: '8',
  '8': 'B',
  Z: '2',
  '2': 'Z',
  G: '6',
  '6': 'G',
  g: '9',
  '9': 'g',
  C: '(',
  c: 'e',
  u: 'v',
  v: 'u',
};

/** Damage `text` at roughly `rate` of its characters, the way an OCR would. */
function corrupt(text: string, rate: number, rnd: () => number): string {
  let out = '';
  for (const ch of text) {
    if (rnd() >= rate) {
      out += ch;
      continue;
    }
    const roll = rnd();
    if (roll < 0.55 && SWAP[ch]) out += SWAP[ch];
    else if (roll < 0.7)
      continue; // dropped character
    else if (roll < 0.8)
      out += ch + ch; // doubled
    else if (roll < 0.9 && ch === ' ')
      continue; // lost space
    else if (ch === '\n')
      out += ' '; // joined lines
    else out += ch;
  }
  return out;
}

const RATES = [0.005, 0.01, 0.02, 0.03, 0.05];
const TRIALS = 200;

function survival(
  text: string,
  expected: string | null,
  rate: number,
  seed: number,
): number {
  const rnd = rng(seed);
  let ok = 0;
  for (let i = 0; i < TRIALS; i++) {
    const verdict = readMarkers(corrupt(text, rate, rnd));
    const kind = verdict?.kind ?? null;
    if (kind === expected) ok++;
  }
  return ok / TRIALS;
}

describe('the classifier survives realistic OCR damage', () => {
  // ⚠️ FLOORS, NOT EXACT VALUES. The corruption is random; pinning the number
  // makes the test flaky and teaches the next person to re-baseline it rather
  // than investigate. These sit under what the change measured and far above
  // what the strict anchors managed.
  //
  //                 competency card        licence card
  //   error    before -> after        before -> after
  //   0.5%      78%  ->  95%           89%  ->  97%
  //   1%        55%  ->  88%           80%  ->  93%
  //   2%        32%  ->  76%           56%  ->  93%
  //   3%        22%  ->  66%           44%  ->  90%
  //   5%         2%  ->  43%           23%  ->  79%
  const FLOOR: Record<string, number> = {
    '0.005': 0.9,
    '0.01': 0.82,
    '0.02': 0.7,
    '0.03': 0.6,
    '0.05': 0.35,
  };

  it.each(RATES)('keeps the competency card at %s character error', (rate) => {
    const got = survival(
      COMPETENCY_CARD,
      'COMPETENCY_CERTIFICATE',
      rate,
      20260901,
    );
    expect({ rate, ok: got >= FLOOR[String(rate)] }).toEqual({
      rate,
      ok: true,
    });
  });

  it.each(RATES)('keeps the licence card at %s character error', (rate) => {
    const got = survival(LICENCE_CARD, 'CURRENT_LICENCE', rate, 20260902);
    expect({ rate, ok: got >= FLOOR[String(rate)] }).toEqual({
      rate,
      ok: true,
    });
  });

  it('⚠️ RARELY READS AN APPLICATION BACK AS THE GRANTED LICENCE', () => {
    // ⚠️ AND "RARELY" IS AN HONEST WORD HERE, NOT A SOFTENED ONE. With strict
    // anchors this never happened at any error rate. With tolerant ones it
    // happens, and the reason is not fixable by tuning: a SAPS 271 is TITLED
    // "Application for a licence to possess a firearm", so it contains the
    // licence heading as a substring and the licence anchor matches it
    // EXACTLY. The only thing separating the two documents is the word
    // "application" and the form number — and once OCR deletes both, the two
    // are genuinely indistinguishable by text.
    //
    // Measured misfiles per 400 corrupted applications:
    //     0.5% error -> 1      1% -> 0      2% -> 3      3% -> 5      5% -> 18
    //
    // At the accuracy a real engine delivers on a clean scan (0.5-1%) that is
    // 0-0.25%. The bound below is deliberately tight at the low rates, where
    // the system actually operates, and loose at 5%, where the OCR is failing
    // badly enough that everything else is unreliable too.
    //
    // Filing an application as the granted document shows a statutory
    // requirement satisfied while the thing SAPS asks for is missing, so if
    // this ever needs raising, that is a decision to take deliberately and not
    // a number to re-baseline.
    const CEILING: Record<string, number> = {
      '0.005': 4,
      '0.01': 4,
      '0.02': 8,
      '0.03': 12,
      '0.05': 30,
    };
    for (const rate of RATES) {
      const rnd = rng(20260903);
      let misfiled = 0;
      for (let i = 0; i < TRIALS; i++) {
        const kind = readMarkers(corrupt(APPLICATION, rate, rnd))?.kind ?? null;
        if (kind === 'CURRENT_LICENCE') misfiled++;
      }
      expect({
        rate,
        ok: misfiled <= CEILING[String(rate)],
        misfiled,
      }).toEqual({ rate, ok: true, misfiled });
    }
  });

  it('a clean document is still classified definitively', () => {
    // The tolerance must cost nothing on an undamaged read: an exact match is
    // still exact, and motivation-extract.service.ts still skips the model.
    expect(readMarkers(COMPETENCY_CARD)?.strength).toBe('definitive');
    expect(readMarkers(LICENCE_CARD)?.strength).toBe('definitive');
    expect(readMarkers(APPLICATION)?.kind ?? null).toBeNull();
  });
});

describe('⚠️ REAL OCR OUTPUT, NOT SIMULATED DAMAGE', () => {
  // Everything above corrupts clean text on purpose. This is the other half:
  // what PP-OCRv4 actually produced from the operator's own scans, run over 37
  // documents on 2026-09-01. Simulated damage is a model of OCR; this is OCR.
  //
  // It found something the simulation never would have. The corruption model
  // drops a space occasionally, at the same rate as any other character. A
  // real engine reading a tight line of print loses nearly ALL of them at
  // once, while every letter stays perfectly legible — which is a completely
  // different shape of damage, and it broke the one document out of 37 that
  // failed to classify.

  /** Verbatim PP-OCRv4 output from a One Shot proficiency certificate. */
  const ONE_SHOT_AS_READ = `ONE SHOT FIREARM TRAINING
CERTIFICATE
Has completed the followingproficiency firearm training
119650-Handleand Usea Self-loadingrifleorcarbine
S/C/V Numbers:50BSR-A3597
PFTCAccreditation Number:T1802001
SAPS Accreditation Number:4001069`;

  it('reads a certificate whose spaces the OCR ate', () => {
    // "Handleand Usea Self-loadingrifleorcarbine" — every word legible, every
    // space gone. UNIT_TITLE required \s+ between the words, so the title was
    // unrecognisable and the code had nothing beside it to corroborate it.
    expect(readMarkers(ONE_SHOT_AS_READ)?.kind).toBe('PROFICIENCY_CERTIFICATE');
  });

  it('still finds the unit standard behind it', () => {
    expect(parseUnitStandards(ONE_SHOT_AS_READ)).toContain('119650');
  });

  it('⚠️ AND STILL WILL NOT LET A SERIAL NUMBER CLAIM A TITLE', () => {
    // The anchor and separator class that make the title trustworthy are
    // unchanged; only the spaces between the words became optional. This is
    // the case they were added for: an SCV number sitting a couple of lines
    // above the table must not reach down and borrow the title below it.
    const scv = `SCV Number:K/10358-K919835 Authentication Code:P19406733348816
SAQAID Unit Standards Title
119651 Handle and Use a Manually Operated Rifle or Carbine`;
    expect(parseUnitStandards(scv)).toEqual(['119651']);
  });
});
