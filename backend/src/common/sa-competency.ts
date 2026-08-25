// ────────────────────────────────────────────────────────────────────
// SOUTH AFRICAN FIREARM COMPETENCY — THE RULES, IN ONE PLACE.
//
// Both Centres depend on this: the Document Centre files and dates competency
// certificates, and the Motivation Centre reads them and argues from them.
// Operator, 2026-08-24, supplying the reference these rules come from: "use it
// to recognize which competency the user scanned and when the competency will
// expire."
//
// Source: SA Firearm Competency Reference **v3.0**, verified 25 August 2026,
// committed beside this file as sa-competency-reference.md. Section numbers in
// these comments (§n) are that document's. Operator, 2026-08-25: "it overwrites
// any other rules there are inside here. It is the source of truth."
//
// ⚠️ THIS FILE WAS FIRST WRITTEN FROM v2, AND v3 CORRECTS v2 ON MATTERS OF
// LAW. Its own changelog (§12) lists fifteen errors, several of which were
// transcribed straight into this file and shipped. Anything here that reads
// like settled fact should be checked against the committed reference before
// it is relied on again. The two that were live in production:
//
//   • A MUZZLE LOADER COMPETENCY LAPSES TEN YEARS FROM ISSUE, not five —
//     s10(3), added by s9(c) of Act 28 of 2006. v2 omitted the number and this
//     file invented five. Verified against the Gazette text of the amending
//     Act and against a consolidation to 31 January 2015: "lapses after ten
//     years from its date of issue".
//   • THE s27 LICENCE TABLE HERE WAS THE PRE-2011 ONE, and named a section
//     16(2) that does not exist. See LICENCE_YEARS below.
//
// ⚠️ AND v2's HEADLINE CLAIM — "a competency certificate has no expiry date on
// it, never parse one" — IS WITHDRAWN. §5.2: SAPS's own SAPS 271 form, section
// F.1.6 and F.1.7, requires the applicant to enter the competency's date of
// issue AND its expiry date, and certificates issued before 10 January 2011
// carry a printed five-year expiry on their face. What is true is narrower and
// still matters: a printed date is ADVISORY INPUT, never the answer, because
// s10(2) decoupled validity from the certificate. A printed date and the CFR
// position can and do disagree.
//
// The expiry is DERIVED, per firearm category, as the latest expiry among the
// licences held in that category — see deriveExpiry. It MOVES: it rolls forward
// every time a licence in that category is granted or renewed (§5.3), so it is
// a CACHED DERIVATION and never a stored fact (§8).
//
// ⚠️ THE DERIVED MODEL IS CONFIRMED BY THE OPERATOR'S OWN DFO, and that
// matters because the document could not confirm it. §5.3 and §9.1 mark the
// max-licence-expiry rule [UNVERIFIED as to primary source]: SAPS applies it
// and the industry teaches it, but the National Commissioner's Directive of
// 3 February 2016 cited for it could not be retrieved, and no judgment or
// published CFR circular states it. Operator, 2026-08-25: "i confirmed with
// the DFO. The competency that is related to a firearm category expires when
// the last firearm license expires. And in the same breath it renews with the
// latest firearm license obtained." That is a DFO's statement, not a published
// rule — but it is better evidence than the document had, and it is the basis
// on which this runs.
//
// ⚠️ THE CFR IS AUTHORITATIVE OVER ANYTHING COMPUTED HERE (§9.11). All of this
// is decision support for an applicant, not a compliance determination.
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
 * Self-loading or not, read off any SAPS wording that states it.
 *
 * ⚠️ NULL MEANS "THE TEXT DOES NOT SAY", AND THAT IS A REAL ANSWER. A licence
 * card's type row reads "S/L: RIFLE CAL - RIFLE/CARBINE" or "MANUALLY OPERATED
 * RIFLE" — the first states the action, the second states only that it is not
 * self-loading. Neither says bolt, lever, pump or break. A caller filling a
 * finer field than this can express must fill it ONLY on true, and leave the
 * applicant to choose otherwise.
 */
export function selfLoadingFromText(raw: string): boolean | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  for (const a of ACTION_TOKENS) {
    if (a.re.test(text)) return a.selfLoading;
  }
  return null;
}

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

/**
 * Licence sections that can feed a competency's validity (§5.4).
 *
 * ⚠️ THERE IS NO SECTION 16(2) LICENCE, and this union used to name one.
 * s16(2) is the sworn-statement requirement inside the dedicated-status
 * section, not a licence type. Private collection is s17. v3 §1 and §12 #11.
 *
 * ⚠️ AND s16A AND s19 WERE MISSING. s16A (professional hunting) has been in
 * force since 1 March 2012; s19 is public collection. A professional hunter's
 * licences could not be typed at all, so they would have dropped out of the
 * derivation entirely and the holder would have been told a ten-year
 * competency had lapsed.
 */
export type LicenceSection =
  | 'S13'
  | 'S14'
  | 'S15'
  | 'S16'
  | 'S16A'
  | 'S17'
  | 'S18'
  | 'S19'
  | 'S20_HUNTING_OR_GAME_RANCHER'
  | 'S20_OTHER';

/**
 * Statutory validity per section, in years — the section 27 Table as
 * substituted by s18 of Act 28 of 2006, in force 10 January 2011 (§5.4).
 *
 * ⚠️ THIS TABLE WAS THE PRE-2011 ONE. It is worth understanding why, because
 * the same trap is still sitting there: **the SAPS 271 form in circulation
 * still prints the old table** — its section D.3 lists business in hunting as
 * five years and game rancher as two — and its header omits s16A altogether.
 * Where the form and the Act disagree, the Act governs. Expect DFO friction.
 */
export const LICENCE_YEARS: Record<LicenceSection, number> = {
  S13: 5,
  S14: 2,
  S15: 10,
  S16: 10,
  S16A: 10,
  S17: 10,
  S18: 10,
  S19: 10,
  // Business purposes splits in two, and this is the half v2 had at two years.
  S20_HUNTING_OR_GAME_RANCHER: 10,
  S20_OTHER: 5,
};

/**
 * Where no licence is linked in the category, the competency runs five years
 * from its issue date.
 *
 * ⚠️ THE DOCUMENT WOULD NOT LET US SAY THIS; THE OPERATOR'S DFO DID. §5.3.1
 * withdraws v2's flat assertion of it — "No official source supports this...
 * s10(2) is circular where no licence exists" — and instructs: "Treat the
 * 5-year figure as a planning assumption, not a rule. Never present it to a
 * user as the legal position."
 *
 * Operator, 2026-08-25, after checking: "the competency expires within 5 years
 * if no license is linked to it." That is the rule this product runs on, and
 * it is recorded here as a DFO-confirmed operating rule rather than as
 * statute, because it is not statute — s10(2) supplies no period at all in
 * this case. Member-facing wording must not cite s10(2) as its authority; an
 * earlier version of the Document Centre did exactly that, in the one case
 * where s10(2) is silent.
 *
 * ⚠️ IT IS ALSO THE ONLY DATE HERE WE INVENT. Everywhere else the derivation
 * copies an expiry off a licence the member already holds and can read for
 * themselves. This one has no such check.
 */
export const FALLBACK_YEARS = 5;

/**
 * A muzzle loading firearm needs no licence at all (s3(2)), so there is
 * nothing to inherit from and the Act gives this competency its own lifespan.
 *
 * ⚠️ TEN YEARS, AND THIS FILE SAID FIVE. Section 10(3), added by s9(c) of
 * Act 28 of 2006: "A competency certificate relating to a muzzle loading
 * firearm lapses after ten years from its date of issue, unless the competency
 * certificate is terminated or renewed." v2 omitted the number — §5.5 of v3
 * calls it "the single most concrete validity number in the whole Act" — and
 * five was invented to fill the gap. Verified in the Gazette text of the
 * amending Act and in a consolidation to 31 January 2015.
 *
 * Getting this wrong is not symmetrical: a muzzle loader has no licence layer
 * beneath it, so a competency we wrongly call lapsed makes lawful possession
 * look unlawful, and one we wrongly call live hides a real lapse under which
 * possession IS unlawful.
 */
export const MUZZLE_LOADER_YEARS = 10;

export interface LinkedLicence {
  section: LicenceSection;
  /** The category this licence's firearm falls in. */
  category: CompetencyCategory;
  expiresOn: Date | null;
}

export interface DerivedExpiry {
  /** Null when we genuinely cannot say. */
  on: Date | null;
  /**
   * Where the date came from, which decides how firmly it may be stated.
   *
   * 'licence'  — copied off a licence the member holds. A fact they can check.
   * 'statute'  — a period the Act fixes (muzzle loaders, s10(3)).
   * 'fallback' — the five-year no-licence rule. Confirmed with the operator's
   *              DFO, but supplied by no statute. The only date we invent.
   * 'unknown'  — we cannot say. Never dress this up as a date.
   */
  basis: 'licence' | 'statute' | 'fallback' | 'unknown';
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
      on: plusYears(args.issuedOn, MUZZLE_LOADER_YEARS),
      basis: 'statute',
      why: 'A muzzle loader needs no licence, so this competency runs on its own ten-year cycle from the date it was issued (section 10(3) of the Firearms Control Act). Renew it at least 90 days before that date.',
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
    // ⚠️ NO STATUTE IS CITED HERE, DELIBERATELY. s10(2) supplies no period
    // where there is no licence to inherit from; quoting it would be citing a
    // provision for the one thing it does not say. See FALLBACK_YEARS.
    why: 'You have no licence on file in this category, so there is nothing for this competency to follow. It runs five years from the date it was issued and then lapses. Licence a firearm in this category and it will follow that licence instead.',
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
