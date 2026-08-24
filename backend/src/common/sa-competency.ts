// ────────────────────────────────────────────────────────────────────
// SOUTH AFRICAN FIREARM COMPETENCY — THE RULES, IN ONE PLACE.
//
// Both Centres depend on this: the Document Centre files and dates competency
// certificates, and the Motivation Centre reads them and argues from them.
// Operator, 2026-08-24, supplying the reference these rules come from: "use it
// to recognize which competency the user scanned and when the competency will
// expire."
//
// Source: SA Firearm Competency Reference (operator-supplied, 2026-08-24),
// citing FCA 60 of 2000 ss 9, 10, 10A as amended by Act 28 of 2006 (commenced
// 10 January 2011), and the Firearms Control Regulations 2004. Section numbers
// in these comments (§n) are that reference's.
//
// ⚠️ A COMPETENCY CERTIFICATE HAS NO EXPIRY DATE ON IT. This is the single
// most important rule here and the easiest to get wrong, because every other
// document we read HAS one printed. §5.2: the card carries an issue date and
// the endorsed firearm types, nothing more. §8: "Never parse an expiry date
// off a competency certificate. There isn't one." §9: any guidance saying
// "check the expiry on your card" is wrong.
//
// The expiry is DERIVED, per firearm type, as the latest expiry among the
// licences held in that type — see deriveExpiry. It MOVES: it rolls forward
// every time a licence in that category is granted or renewed (§5.3), so it is
// a CACHED DERIVATION and never a stored fact (§8).
//
// ⚠️ THE CFR IS AUTHORITATIVE OVER ANYTHING COMPUTED HERE (§9). All of this is
// decision support for an applicant, not a compliance determination.
// ────────────────────────────────────────────────────────────────────

/**
 * What a competency is endorsed FOR.
 *
 * ⚠️ ENDORSED PER FIREARM TYPE, AND A PERSON MAY HOLD ANY COMBINATION (§2.1),
 * which is why this is always a SET. A handgun endorsement and a self-loading
 * rifle endorsement on one card are independent — including their expiry
 * dates, which are computed separately (§5.2).
 */
export type Endorsement =
  | 'handgun-nsl'
  | 'handgun-sl'
  | 'shotgun-mo'
  | 'shotgun-sl'
  | 'rifle-mo'
  | 'rifle-sl'
  | 'muzzle-loader';

/** The category an endorsement belongs to, which is the unit expiry works in. */
export type CompetencyCategory =
  | 'handgun'
  | 'rifle-carbine'
  | 'shotgun'
  | 'muzzle-loader';

/**
 * ⚠️ NO LABEL MAY CONTAIN A COMMA. `competency_for` is a `multi` field, and a
 * multi answer is STORED COMMA-JOINED — sanitiseAnswers splits on the comma to
 * validate each part. A label carrying its own comma therefore cannot survive
 * a round trip: it splits into fragments, none of which is an offered choice,
 * and the whole answer is refused. The first draft of these labels read
 * "(bolt, lever, pump, single shot)" and did exactly that. Slashes instead.
 * motivation-fields.spec.ts guards every multi field against this.
 */
export interface EndorsementSpec {
  /** Stored value. APPEND-ONLY — these end up in saved answers. */
  value: Endorsement;
  label: string;
  category: CompetencyCategory;
  /** Self-loading (semi-automatic)? Drives the §7.1 section restrictions. */
  selfLoading: boolean;
  /** The SASSETA unit standard behind it (§3). */
  unitStandard?: string;
}

/** The seven endorsements of §2.1, in the reference's own order. */
export const ENDORSEMENTS: readonly EndorsementSpec[] = [
  {
    value: 'handgun-nsl',
    label: 'Handgun — non-self-loading (revolver)',
    category: 'handgun',
    selfLoading: false,
    unitStandard: '119649',
  },
  {
    value: 'handgun-sl',
    label: 'Handgun — self-loading (pistol)',
    category: 'handgun',
    selfLoading: true,
    unitStandard: '119649',
  },
  {
    value: 'shotgun-mo',
    label: 'Shotgun — manually operated (pump / break / bolt)',
    category: 'shotgun',
    selfLoading: false,
    unitStandard: '119650',
  },
  {
    value: 'shotgun-sl',
    label: 'Shotgun — self-loading',
    category: 'shotgun',
    selfLoading: true,
    unitStandard: '123515',
  },
  {
    value: 'rifle-mo',
    label: 'Rifle or carbine — manually operated (bolt / lever / pump / single shot)',
    category: 'rifle-carbine',
    selfLoading: false,
    unitStandard: '119651',
  },
  {
    value: 'rifle-sl',
    label: 'Rifle or carbine — self-loading (includes pistol calibre carbine)',
    category: 'rifle-carbine',
    selfLoading: true,
    unitStandard: '119652',
  },
  {
    value: 'muzzle-loader',
    label: 'Muzzle loading firearm',
    category: 'muzzle-loader',
    selfLoading: false,
  },
];

const BY_VALUE = new Map(ENDORSEMENTS.map((e) => [e.value, e]));

export function endorsementSpec(v: string): EndorsementSpec | undefined {
  return BY_VALUE.get(v as Endorsement);
}

/** The labels, in order, for a picker. */
export const ENDORSEMENT_LABELS: readonly string[] = ENDORSEMENTS.map(
  (e) => e.label,
);

/** Label back to value, so a stored label still resolves. */
export function endorsementFromLabel(label: string): Endorsement | undefined {
  const t = (label ?? '').trim().toLowerCase();
  return ENDORSEMENTS.find((e) => e.label.toLowerCase() === t)?.value;
}

// ── reading what SAPS actually printed ──────────────────────────────
//
// ⚠️ SAPS DATA CAPTURERS ARE INCONSISTENT AND THE REFERENCE SAYS SO (§4.7,
// "Caution"): the same endorsement is written out in full on one certificate
// and abbreviated on another, and typos occur. So this reads generously — but
// it NEVER guesses between two endorsements that differ in what they permit.
// An unreadable block yields nothing and the applicant ticks the boxes, which
// is what they would have done anyway.

/** Action-type abbreviations (§4.1). Longest first — N/S/L contains S/L. */
const ACTION_TOKENS: { re: RegExp; selfLoading: boolean }[] = [
  { re: /\bN\s*\/?\s*S\s*\/?\s*L\b/i, selfLoading: false },
  { re: /\bNON[\s-]?SELF[\s-]?LOADING\b/i, selfLoading: false },
  { re: /\bM\s*\/\s*O\b/i, selfLoading: false },
  { re: /\bMANUALLY[\s-]?OPERATED\b/i, selfLoading: false },
  { re: /\bS\s*\/\s*L\b/i, selfLoading: true },
  { re: /\bSELF[\s-]?LOADING\b/i, selfLoading: true },
  { re: /\bSEMI[\s-]?AUTO(MATIC)?\b/i, selfLoading: true },
];

/**
 * Firearm-type abbreviations (§4.2).
 *
 * ⚠️ PIST CAL CARB IS A RIFLE/CARBINE, NOT A HANDGUN — §4.7 spells it out
 * because it is commonly misread. A 9mm AR-pattern carbine fires a handgun
 * cartridge but is classified by barrel and overall length, not calibre.
 * Filing it under handgun competency would tell somebody they are covered for
 * a firearm they are not. Tested first, so the word "PISTOL" inside it cannot
 * be claimed by the handgun pattern.
 */
const TYPE_TOKENS: { re: RegExp; category: CompetencyCategory }[] = [
  {
    re: /\bPIST(OL)?\.?\s*CAL(IBRE)?\.?\s*CARB(INE)?\b/i,
    category: 'rifle-carbine',
  },
  { re: /\bMUZZLE[\s-]?LOAD(ER|ING)?\b|\bM\s*\/\s*L\b/i, category: 'muzzle-loader' },
  { re: /\bRIFLE\b|\bCARB(INE)?\b/i, category: 'rifle-carbine' },
  { re: /\bSHOTGUN\b|\bSG\b/i, category: 'shotgun' },
  { re: /\bHAND\s*GUN\b|\bHG\b|\bPISTOL\b|\bREVOLVER\b/i, category: 'handgun' },
];

/**
 * Read the endorsements off a competency certificate's own wording.
 *
 * Handles the compound form of §4.7 — S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN —
 * where one action prefix DISTRIBUTES across every type after it. That example
 * must yield self-loading rifle/carbine plus self-loading shotgun, and it is
 * the reference's worked example for exactly that reason.
 *
 * Returns [] when it cannot tell. Never a guess.
 */
export function parseEndorsements(raw: string): Endorsement[] {
  const text = (raw ?? '').trim();
  if (!text) return [];
  const found = new Set<Endorsement>();

  // ⚠️ A COMMA DOES NOT ALWAYS SEPARATE TWO ENDORSEMENTS. §2.1's own table
  // writes each one as "Handgun, self-loading" — type first, action after the
  // comma — so splitting on commas unconditionally severs the action from the
  // type it qualifies, and both halves then refuse to guess. That failure is
  // silent: a certificate transcribed exactly as SAPS words it would read as
  // no endorsements at all.
  //
  // So: when every action token in the string AGREES, there is only one action
  // in play and it governs every type mentioned, commas or not. Only a string
  // carrying BOTH a self-loading and a non-self-loading token is genuinely two
  // independent clauses, and only that case is split.
  const actions = ACTION_TOKENS.filter((a) => a.re.test(text)).map(
    (a) => a.selfLoading,
  );
  const oneAction = actions.length > 0 && actions.every((a) => a === actions[0]);
  const clauses = oneAction ? [text] : text.split(/[,;]|\band\b/i);

  for (const clause of clauses) {
    if (!clause.trim()) continue;

    let selfLoading: boolean | null = null;
    for (const a of ACTION_TOKENS) {
      if (a.re.test(clause)) {
        selfLoading = a.selfLoading;
        break;
      }
    }

    const categories = new Set<CompetencyCategory>();
    for (const t of TYPE_TOKENS) {
      if (t.re.test(clause)) categories.add(t.category);
    }
    if (!categories.size) continue;

    for (const category of categories) {
      if (category === 'muzzle-loader') {
        found.add('muzzle-loader');
        continue;
      }
      // ⚠️ NO ACTION STATED MEANS WE DO NOT KNOW WHICH OF THE TWO IT IS, and
      // the two differ in what may be licensed under which section (§7.1).
      // Guessing would tell somebody they hold self-loading rifle competency
      // on the strength of the word "RIFLE" alone.
      if (selfLoading === null) continue;
      const hit = ENDORSEMENTS.find(
        (e) => e.category === category && e.selfLoading === selfLoading,
      );
      if (hit) found.add(hit.value);
    }
  }

  // Registry order, not discovery order, so the same card always reads the same.
  return ENDORSEMENTS.filter((e) => found.has(e.value)).map((e) => e.value);
}

// ── the derived expiry ──────────────────────────────────────────────

/** Licence sections that can feed a competency's validity (§5.4). */
export type LicenceSection = 'S13' | 'S14' | 'S15' | 'S16' | 'S16(2)';

/** Statutory validity per section, in years (§5.4). */
export const LICENCE_YEARS: Record<LicenceSection, number> = {
  S13: 5,
  S14: 2,
  S15: 10,
  S16: 10,
  'S16(2)': 10,
};

/**
 * The fallback when no licence has ever been issued in a category (§5.2).
 *
 * ⚠️ A FALLBACK, NOT THE RULE. Treating it as the rule is exactly the error
 * §9 calls out — providers telling owners "some are five years and some are
 * ten, check yours", as though the period were fixed at issue. It is not; it
 * moves with the linked licences.
 */
export const FALLBACK_YEARS = 5;

export interface LinkedLicence {
  section: LicenceSection;
  /** The category this licence's firearm falls in. */
  category: CompetencyCategory;
  expiresOn: Date | null;
}

export interface DerivedExpiry {
  /** Null when we genuinely cannot say. */
  on: Date | null;
  basis: 'licence' | 'fallback' | 'unknown';
  /** One sentence for a member. Always safe to show. */
  why: string;
}

function plusYears(d: Date, years: number): Date {
  const out = new Date(d.getTime());
  out.setUTCFullYear(out.getUTCFullYear() + years);
  return out;
}

/**
 * When a competency endorsement expires (§5.2, §5.3):
 *
 *   expiry(category) = MAX(expiry of every current licence in that category)
 *
 * falling back to issue + five years when the category holds no licence.
 *
 * ⚠️ THE RESULT IS A CACHED DERIVATION, NOT A FACT (§8) — recompute it
 * whenever a licence in the category is added, renewed or lapses. That is why
 * this takes the licences as an argument instead of reading them once.
 */
export function deriveExpiry(args: {
  category: CompetencyCategory;
  issuedOn: Date | null;
  licences: readonly LinkedLicence[];
}): DerivedExpiry {
  // Muzzle loaders are the standalone case (§5.5): no licence exists to
  // inherit from, so the certificate runs its own cycle.
  if (args.category === 'muzzle-loader') {
    if (!args.issuedOn) {
      return { on: null, basis: 'unknown', why: 'We do not have the issue date.' };
    }
    return {
      on: plusYears(args.issuedOn, FALLBACK_YEARS),
      basis: 'fallback',
      why: 'A muzzle loader needs no licence, so this competency runs on its own five-year cycle.',
    };
  }

  const inCategory = args.licences.filter(
    (l) => l.category === args.category && l.expiresOn,
  );
  if (inCategory.length) {
    const latest = inCategory.reduce((a, b) =>
      (a.expiresOn as Date) >= (b.expiresOn as Date) ? a : b,
    );
    const on = latest.expiresOn as Date;
    return {
      on,
      basis: 'licence',
      why:
        'It follows your longest-running licence in this category, which runs to ' +
        on.toISOString().slice(0, 10) +
        '. Renewing or adding a licence here pushes this out with it.',
    };
  }

  if (!args.issuedOn) {
    return { on: null, basis: 'unknown', why: 'We do not have the issue date.' };
  }
  return {
    on: plusYears(args.issuedOn, FALLBACK_YEARS),
    basis: 'fallback',
    why: 'No licence is held in this category yet, so it runs five years from issue and then lapses.',
  };
}

// ── what a section will actually allow ──────────────────────────────

/**
 * Whether a firearm of this endorsement can be licensed under this section.
 *
 * From §7.1, worth encoding because getting it wrong wastes an application:
 * S13 takes a handgun or a shotgun only; S15 excludes self-loading firearms;
 * a self-loading rifle or carbine must therefore go under S16 with dedicated
 * status. The self-loading SHOTGUN is the exception in the self-loading group
 * — it may be licensed under S13.
 */
export function sectionAllows(
  section: LicenceSection,
  endorsement: Endorsement,
): { ok: boolean; why?: string } {
  const spec = endorsementSpec(endorsement);
  if (!spec) return { ok: true };

  if (section === 'S13') {
    if (spec.category === 'rifle-carbine') {
      return {
        ok: false,
        why: 'Section 13 is for a handgun or a shotgun. A rifle or carbine cannot be licensed for self-defence.',
      };
    }
    if (spec.category === 'muzzle-loader') {
      return { ok: false, why: 'A muzzle loader does not need a licence.' };
    }
    return { ok: true };
  }

  if (section === 'S15' && spec.selfLoading) {
    return {
      ok: false,
      why: 'Section 15 excludes self-loading firearms. A self-loading firearm needs section 16 dedicated status.',
    };
  }

  return { ok: true };
}
