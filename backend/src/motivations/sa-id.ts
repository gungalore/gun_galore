// ────────────────────────────────────────────────────────────────────
// What a South African ID number already tells us.
//
// The SAPS 271 asks for date of birth, age, gender and citizenship in their own
// boxes — and every one of them is carried in the ID number the applicant has
// already given us. Asking again would be redundant AND dangerous: two fields
// on the same form that disagree is exactly the kind of contradiction a DFO
// notices, and the applicant is the one who signs it.
//
// So we derive. YYMMDD SSSS C A Z:
//   1-6   date of birth
//   7-10  gender sequence — 0000-4999 female, 5000-9999 male
//   11    citizenship — 0 SA citizen, 1 permanent resident
//   12    historically a race digit, abolished 1994 — IGNORED, never read
//   13    Luhn check digit
//
// PURE, no Nest, no Prisma. Everything returns null rather than guessing: a
// wrong date of birth on a firearm licence application is worse than an empty
// box the applicant fills in themselves.
// ────────────────────────────────────────────────────────────────────

export interface SaIdFacts {
  dateOfBirth: Date | null;
  /** Age in whole years at `asAt`. */
  age: number | null;
  gender: 'male' | 'female' | null;
  citizenship: 'sa_citizen' | 'permanent_resident' | null;
  /** Luhn check. False means the number is wrong, not merely unusual. */
  valid: boolean;
}

/** Luhn, as used by Home Affairs. */
function luhnOk(id: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = id.length - 1; i >= 0; i--) {
    let n = Number(id[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * Read what the ID carries.
 *
 * `asAt` is injected rather than read from the clock so a document re-rendered
 * months later reproduces the age it was generated with — the same
 * reproducibility rule the PDF renderer follows.
 */
export function readSaId(raw: string, asAt = new Date()): SaIdFacts {
  const empty: SaIdFacts = {
    dateOfBirth: null,
    age: null,
    gender: null,
    citizenship: null,
    valid: false,
  };

  const id = (raw ?? '').replace(/\s/g, '');
  if (!/^\d{13}$/.test(id)) return empty;

  const valid = luhnOk(id);

  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));

  // CENTURY. Two digits are ambiguous — "26" is both 1926 and 2026 — and a
  // bare "is it in the future" comparison gets the boundary wrong: at the turn
  // of a year it would read a 100-year-old as a newborn.
  //
  // So both candidates are tested and the one that yields a PLAUSIBLE ADULT is
  // chosen. That is domain knowledge, not a trick: this module exists to fill a
  // firearm licence application, and nobody under 16 is completing one. Where
  // both candidates are plausible the earlier century wins, because a living
  // 100-year-old is likelier than an infant applicant. Where neither is, we
  // return nothing rather than pick.
  const buildDate = (year: number): Date | null => {
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
    const d = new Date(Date.UTC(year, mm - 1, dd));
    // Reject a rolled-over date — 31 February would silently become 3 March.
    return d.getUTCFullYear() === year &&
      d.getUTCMonth() === mm - 1 &&
      d.getUTCDate() === dd
      ? d
      : null;
  };

  const ageAt = (d: Date): number => {
    let a = asAt.getUTCFullYear() - d.getUTCFullYear();
    const before =
      asAt.getUTCMonth() < d.getUTCMonth() ||
      (asAt.getUTCMonth() === d.getUTCMonth() &&
        asAt.getUTCDate() < d.getUTCDate());
    return before ? a - 1 : a;
  };

  const plausible = (d: Date | null): boolean => {
    if (!d) return false;
    const a = ageAt(d);
    return a >= 16 && a <= 120;
  };

  const candidates = [buildDate(1900 + yy), buildDate(2000 + yy)];
  const dateOfBirth =
    candidates.find(plausible) ?? null;

  const age = dateOfBirth ? ageAt(dateOfBirth) : null;

  const seq = Number(id.slice(6, 10));
  const gender: SaIdFacts['gender'] = seq < 5000 ? 'female' : 'male';

  const c = id[10];
  const citizenship: SaIdFacts['citizenship'] =
    c === '0' ? 'sa_citizen' : c === '1' ? 'permanent_resident' : null;

  return { dateOfBirth, age, gender, citizenship, valid };
}

/**
 * Split a full name into surname and initials for the SAPS 271, which wants
 * them in separate boxes.
 *
 * Deliberately simple, and deliberately treats the LAST word as the surname.
 * That is right for most South African names and wrong for some — compound
 * surnames like "Van der Merwe", "Du Plessis" or "Ndlovu Mthembu". So it
 * handles the common Afrikaans particles explicitly and, where it is unsure,
 * the applicant confirms in the wizard. A misspelt surname on a licence
 * application is not a small error.
 */
const SURNAME_PARTICLES = [
  'van',
  'van der',
  'van den',
  'van de',
  'du',
  'de',
  'de la',
  'le',
  'jansen van',
  'janse van',
  'ter',
  'te',
];

export function splitName(fullName: string): {
  firstNames: string;
  surname: string;
  initials: string;
} {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstNames: '', surname: '', initials: '' };
  if (parts.length === 1) {
    return {
      firstNames: '',
      surname: parts[0],
      initials: '',
    };
  }

  // Walk back looking for a particle that starts a compound surname.
  let surnameStart = parts.length - 1;
  for (let i = parts.length - 2; i >= 1; i--) {
    const candidate = parts
      .slice(i, parts.length - 1)
      .join(' ')
      .toLowerCase();
    if (SURNAME_PARTICLES.includes(candidate)) {
      surnameStart = i;
      break;
    }
  }

  const firstNameParts = parts.slice(0, surnameStart);
  return {
    firstNames: firstNameParts.join(' '),
    surname: parts.slice(surnameStart).join(' '),
    initials: firstNameParts.map((p) => p[0].toUpperCase()).join(''),
  };
}
