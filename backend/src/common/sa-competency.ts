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
// it is relied on again. Three were live in production:
//
//   • A MUZZLE LOADER COMPETENCY LAPSES TEN YEARS FROM ISSUE, not five —
//     s10(3), added by s9(c) of Act 28 of 2006. v2 omitted the number and this
//     file invented five. Verified against the Gazette text of the amending
//     Act and against a consolidation to 31 January 2015: "lapses after ten
//     years from its date of issue".
//   • THE s27 LICENCE TABLE HERE WAS THE PRE-2011 ONE, and named a section
//     16(2) that does not exist. See LICENCE_YEARS below.
//   • sectionAllows PUT A SEMI-AUTOMATIC SHOTGUN UNDER s13 AND REFUSED A
//     PISTOL UNDER s15 — two errors of law pointing opposite ways, both
//     reaching applicants. See the note on that function.
//
// ⚠️ A COMPETENCY CERTIFICATE HAS NO EXPIRY DATE ON IT. This is the single
// most important rule here and the easiest to get wrong, because every other
// document the Centre reads HAS one printed.
//
// ⚠️ AND IT WAS BRIEFLY UNSAID, ON A CORRECTION THAT WAS ITSELF WRONG. v3
// called v2's version overstated, reasoning that SAPS 271 §F.1.6 and §F.1.7 ask
// the applicant for the competency's date of issue AND its expiry date, so the
// field must exist somewhere. v4 examined three genuine SAPS 524 certificates
// from 2022, 2024 and 2025 and found NO EXPIRY FIELD — not blank, absent from
// the form. §5.2 reverses the correction: v2 was right.
//
// The inference failed in a way worth remembering: SAPS's licence application
// form asks for a date SAPS's own certificate does not print. That is not
// evidence of a hidden field, it is one more instance of SAPS forms
// disagreeing with each other — the same pattern as the SAPS 271 still
// printing a business-licence period table repealed in 2011.
//
// §4.8.7, on what a platform should extract: "Expiry date — does not exist. Do
// not model it as nullable — model it as absent." Pre-2011 card-format
// certificates are the one open question: they fell under the repealed flat
// five-year regime and are reported to carry a printed expiry, though no
// specimen was examined. Any such legacy date is advisory only, because
// s10(2) decoupled validity from the certificate on 10 January 2011.
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
 * ⚠️ ENDORSED PER FIREARM TYPE, AND A PERSON MAY HOLD ANY COMBINATION
 * (§2.2), which is why this is always a SET. Two endorsements on one card are
 * independent — including their expiry dates, which are computed separately
 * per category (§5.3).
 *
 * ⚠️ FIVE, NOT SEVEN. This union used to split handgun into self-loading and
 * non-self-loading, and shotgun the same way. §2.2 and §12 #3 remove both:
 * there is NO separate unit standard for a self-loading handgun or a
 * self-loading shotgun. 119649 covers handguns whole, 119652 covers shotguns
 * whole, and the only action split with training behind it is rifle/carbine
 * — 119651 manual against 119650 self-loading.
 *
 * ⚠️ AND THE SPLIT WAS COSTING REAL CERTIFICATES. The parser refuses to
 * guess an action, so where the split existed a card had to state one. The
 * operator's own SAPS 524 reads, in full, "COMPETENCY TO POSSESS A FIREARM /
 * HANDGUN" — no action, because there is none to state — and parsed to
 * nothing at all. Their rifle card reads "MANUALLY OPERATED RIFLE" and their
 * third reads "S/L-RIFLE/CARB/PIST CAL CARB/SHOTGUN". Two of the three were
 * unreadable to us.
 *
 * Where a card DOES print `S/L HG` or `M/O SG`, §2.2 says treat it as
 * data-capture convention: it maps onto the one handgun or shotgun
 * endorsement rather than selecting between two.
 */
export type Endorsement =
  | 'handgun'
  | 'rifle-mo'
  | 'rifle-sl'
  | 'shotgun'
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
  /**
   * What the member picks and what gets STORED in their answers.
   *
   * ⚠️ CHANGING ONE IS A DATA MIGRATION, not a rename — see
   * normaliseCompetencyForAnswer.
   */
  label: string;
  /**
   * What the Document Centre SHOWS. Chrome, never stored.
   *
   * Operator, 2026-08-25: "check the firearm codes the competency is for and
   * list it as 'Competency - Semi-auto Rifle' if the code was S/L Rifle".
   * Kept separate from `label` precisely so the shown wording can change
   * without touching a single saved answer.
   */
  display: string;
  category: CompetencyCategory;
  /**
   * Self-loading, where the endorsement itself settles it.
   *
   * ⚠️ NULL FOR HANDGUN, SHOTGUN AND MUZZLE LOADER, and that is the whole
   * point of the v3 collapse: those endorsements do not record an action
   * because no separate unit standard distinguishes one. Section eligibility
   * still turns on the action — s13, s14, s15 and s16 each draw the line
   * differently — so it must be carried alongside, from what the applicant
   * says the firearm is. Reading it off the endorsement is how sectionAllows
   * came to refuse a lawful semi-automatic pistol under s15.
   */
  selfLoading: boolean | null;
  /**
   * The SAQA unit standard behind it (§3).
   *
   * ⚠️ QUALITY-ASSURED BY THE PFTC, NOT SASSETA. §3.2 and §12 #13: the QCTO
   * delegated firearm-training quality assurance to the PFTC in 2013, and
   * SASSETA is contesting it in litigation that is still unresolved. Train at
   * a PFTC-accredited provider.
   */
  unitStandard?: string;
}

/**
 * The five endorsements of §2.2, in the reference's own order.
 *
 * ⚠️ THREE UNIT STANDARDS HERE WERE WRONG, and §12 #3 calls it "the worst
 * error in the document". v2 mapped 119650 to a manually operated shotgun,
 * 119652 to a self-loading rifle, and 123515 to a self-loading shotgun. All
 * three were wrong, and 123515 is not a shotgun standard at all — it is
 * handgun FOR BUSINESS PURPOSES. Verified against the SAQA register.
 */
export const ENDORSEMENTS: readonly EndorsementSpec[] = [
  {
    value: 'handgun',
    label: 'Handgun',
    display: 'Competency - Handgun',
    category: 'handgun',
    selfLoading: null,
    unitStandard: '119649',
  },
  {
    value: 'rifle-mo',
    label: 'Rifle or carbine - manually operated',
    display: 'Competency - Manual Rifle',
    category: 'rifle-carbine',
    selfLoading: false,
    unitStandard: '119651',
  },
  {
    value: 'rifle-sl',
    // ⚠️ "Semi-automatic (self-loading)" IS HOUSE WORDING, not a third
    // vocabulary. It is exactly the firearm_action choice in the motivation
    // registry, phrased that way because the operator could not find the
    // option when it read only "Self-loading". The Act's own word is
    // self-loading and stays in the generated prose and on the SAPS 271.
    label: 'Rifle or carbine - semi-automatic (self-loading)',
    display: 'Competency - Semi-auto Rifle',
    category: 'rifle-carbine',
    selfLoading: true,
    unitStandard: '119650',
  },
  {
    value: 'shotgun',
    label: 'Shotgun',
    display: 'Competency - Shotgun',
    category: 'shotgun',
    selfLoading: null,
    unitStandard: '119652',
  },
  {
    value: 'muzzle-loader',
    // Unchanged from v2 on purpose: the one stored answer that needs no remap.
    label: 'Muzzle loading firearm',
    display: 'Competency - Muzzle Loader',
    category: 'muzzle-loader',
    selfLoading: null,
    unitStandard: '243200',
  },
];

/**
 * v2 wording, and every other spelling seen on a card, onto current labels.
 *
 * ⚠️ WITHOUT THIS THE SAFETY CHECK TURNS ITSELF OFF, SILENTLY. A stored
 * answer is a comma-joined list of LABELS inside an encrypted blob. Four of
 * the seven v2 labels no longer exist, and the eligibility check resolves each
 * part with endorsementFromLabel, drops what it cannot resolve, and then only
 * fires "your competency does not cover this firearm" if anything survived. An
 * all-stale answer therefore reads as "we have not seen the certificate yet"
 * rather than as an error, with no log line and nothing on screen.
 *
 * Collapsing revolver and pistol onto one handgun endorsement is not
 * reversible, which is why this is a read-side map and not a rewrite of the
 * stored blob.
 */
const LEGACY_LABELS: Record<string, Endorsement> = {
  'handgun \u2014 non-self-loading (revolver)': 'handgun',
  'handgun \u2014 self-loading (pistol)': 'handgun',
  'handgun - non-self-loading (revolver)': 'handgun',
  'handgun - self-loading (pistol)': 'handgun',
  'shotgun \u2014 manually operated (pump / break / bolt)': 'shotgun',
  'shotgun \u2014 self-loading': 'shotgun',
  'shotgun - manually operated (pump / break / bolt)': 'shotgun',
  'shotgun - self-loading': 'shotgun',
  'rifle or carbine \u2014 manually operated (bolt / lever / pump / single shot)':
    'rifle-mo',
  'rifle or carbine - manually operated (bolt / lever / pump / single shot)':
    'rifle-mo',
  'rifle or carbine \u2014 self-loading (includes pistol calibre carbine)':
    'rifle-sl',
  'rifle or carbine - self-loading (includes pistol calibre carbine)':
    'rifle-sl',
};

const BY_VALUE = new Map(ENDORSEMENTS.map((e) => [e.value, e]));

export function endorsementSpec(v: string): EndorsementSpec | undefined {
  return BY_VALUE.get(v as Endorsement);
}

/** The labels, in order, for a picker. */
export const ENDORSEMENT_LABELS: readonly string[] = ENDORSEMENTS.map(
  (e) => e.label,
);

/** Label back to value, so a stored label still resolves — v2 wording too. */
export function endorsementFromLabel(label: string): Endorsement | undefined {
  const t = (label ?? '').trim().toLowerCase();
  const current = ENDORSEMENTS.find((e) => e.label.toLowerCase() === t)?.value;
  return current ?? LEGACY_LABELS[t];
}

/** What the Document Centre shows for one endorsement. */
export function endorsementDisplay(value: string): string | undefined {
  return endorsementSpec(value)?.display;
}

/**
 * Bring a stored `competency_for` answer up to current wording.
 *
 * ⚠️ APPLIED AT THE ANSWERS BOUNDARY, not inside endorsementFromLabel. Four
 * separate paths read this value and only one of them goes through that
 * function: the eligibility check resolves labels, the wizard ticks
 * checkboxes by exact string match against the served choices, the generator
 * puts the raw string into its prompt, and the field validator BINS THE WHOLE
 * KEY if any comma part is not a current choice. Normalising in one place
 * downstream would fix the first and leave the other three showing, printing
 * or discarding v2 wording.
 *
 * Returns the same comma-joined shape it was given, in registry order and
 * de-duplicated — two v2 handgun endorsements collapse to one.
 */
export function normaliseCompetencyForAnswer(raw: string): string {
  const parts = (raw ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return '';
  const values = new Set<Endorsement>();
  const unknown: string[] = [];
  for (const p of parts) {
    const v = endorsementFromLabel(p);
    if (v) values.add(v);
    // ⚠️ KEPT, NOT DROPPED. Something we cannot read is the member's answer
    // and may be wording we have not seen; discarding it here would delete an
    // answer they gave. The field validator downstream decides its fate.
    else unknown.push(p);
  }
  return [
    ...ENDORSEMENTS.filter((e) => values.has(e.value)).map((e) => e.label),
    ...unknown,
  ].join(', ');
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
 * where one action prefix DISTRIBUTES across every type after it.
 *
 * ⚠️ THAT STRING IS COPIED OFF A REAL CERTIFICATE, not from the reference. A
 * conformance review flagged the trailing "/SHOTGUN" as invented, because
 * §4.7's printed example stops at PIST CAL CARB. The operator's own SAPS 524,
 * issued 2025-06-06, carries the shotgun tail. Do not "correct" it back.
 *
 * It now yields self-loading rifle/carbine plus SHOTGUN — not "self-loading
 * shotgun", which §2.2 says is not a thing. Whether the S/L prefix was ever
 * meant to reach the shotgun at the end of that string is unknowable from the
 * text, and under the five-endorsement model it no longer matters.
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
      // ⚠️ AN ACTION IS ONLY NEEDED FOR A RIFLE OR CARBINE, and narrowing
      // this is what made the operator's own certificates readable. It used to
      // refuse every category without a stated action, because handgun and
      // shotgun were each split in two and picking between them on the word
      // "HANDGUN" alone would have been a guess. §2.2 removes both splits, so
      // for those three categories there is nothing left to guess AT — and a
      // SAPS 524 reading exactly "COMPETENCY TO POSSESS A FIREARM / HANDGUN"
      // is complete and unambiguous. It parsed to nothing.
      //
      // Rifle keeps the refusal, and must: 119651 and 119650 are different
      // unit standards, and s13, s15 and s16 each treat a semi-automatic rifle
      // differently. Guessing there would tell somebody they hold self-loading
      // competency on the strength of the word "RIFLE".
      if (category === 'rifle-carbine') {
        if (selfLoading === null) continue;
        const hit = ENDORSEMENTS.find(
          (e) => e.category === category && e.selfLoading === selfLoading,
        );
        if (hit) found.add(hit.value);
        continue;
      }
      const hit = ENDORSEMENTS.find((e) => e.category === category);
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
 * this case.
 *
 * ⚠️ AND §5.3.1 EXPLAINS WHERE THE NUMBER CAME FROM, WHICH IS WORTH KNOWING
 * BEFORE ANYONE DEFENDS IT AS LAW. Five years is not a fallback somebody
 * designed. It is the REPEALED s10(2), which read "A competency certificate
 * lapses after five years from its date of issue" until 10 January 2011. The
 * amendment removed it and put nothing in its place for the no-licence case,
 * so what survives is the memory of the old rule, applied out of habit where
 * the new rule has nothing to bite on. It is the number SAPS is most likely to
 * reach for, which is exactly why it is a sound operating assumption and a
 * hopeless legal citation. Member-facing wording must not cite s10(2) as its authority; an
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
 * Whether a firearm of this shape can be licensed under this section.
 *
 * ⚠️ THIS FUNCTION SHIPPED TWO ERRORS OF LAW, AND THEY POINTED IN OPPOSITE
 * DIRECTIONS. Both reached applicants through motivation-eligibility, and both
 * came from v2 of the reference, whose changelog (§12 #1) says of the first
 * that it "could cause real harm".
 *
 *   • IT SAID A SEMI-AUTOMATIC SHOTGUN COULD GO UNDER s13, and called it "the
 *     exception in the self-loading group". s13(1)(a), read in the Act itself:
 *     "any shotgun which is **not fully or semi-automatic**". A semi-automatic
 *     shotgun is expressly a RESTRICTED firearm under s14(1)(a). Telling
 *     somebody to lodge it under s13 sends them to a refusal at best.
 *   • IT REFUSED EVERY SELF-LOADING FIREARM UNDER s15, including a pistol.
 *     s15(1): "(a) handgun which is not fully automatic; (b) rifle or shotgun
 *     which is not fully or semi-automatic". Semi-automatic is excluded for
 *     RIFLES AND SHOTGUNS ONLY. A semi-automatic pistol under s15 is ordinary
 *     and lawful, and we were blocking it.
 *
 * ⚠️ IT ALSO LET A MUZZLE LOADER THROUGH EVERYWHERE BUT s13, by falling out
 * of the bottom. s3(2): a muzzle loader needs no licence at all, only the
 * competency. Every section refuses one.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT REFUSE. Under s14, s16 and s16A this only
 * screens out the muzzle loader, and that is a decision rather than an
 * omission. s14(1)(b) admits any firearm the Minister declares restricted, so
 * nothing can be ruled out categorically. s16(1)(b) reads "rifle or shotgun
 * which is not fully automatic" while s16(1)(c) separately admits a
 * semi-automatic shotgun "manufactured to fire no more than five shots in
 * succession without having to be reloaded" — the two overlap, and we do not
 * hold a magazine capacity to tell them apart. Guessing would refuse lawful
 * applications, which is the failure this rewrite exists to stop.
 *
 * ⚠️ AND THE FIVE-SHOT LIMIT IS STILL LAW, however much has been written
 * saying it is gone. The long title of Act 28 of 2006 promises "to delete the
 * restriction on magazine capacity of a semi-automatic shotgun for use by a
 * dedicated hunter or sports person", and its section 11 does exactly that
 * — but section 11 appears in NEITHER commencement proclamation and has never
 * come into force (§0.5). Roughly two thirds of that Amendment Act never did.
 * Anyone reasoning from its long title, or from an article written off it,
 * will conclude s16(1)(c) is repealed. It stands.
 *
 * @param selfLoading null where the applicant has not said. Never guessed:
 *   an unstated action is not a reason to block anybody.
 */
export function sectionAllows(
  section: LicenceSection,
  category: CompetencyCategory,
  selfLoading: boolean | null,
): { ok: boolean; why?: string } {
  // s3(2) — no licence exists for one, so no section can take it.
  if (category === 'muzzle-loader') {
    return {
      ok: false,
      why: 'A muzzle loading firearm does not take a licence at all — the competency certificate on its own is what allows you to possess it.',
    };
  }

  if (section === 'S13') {
    if (category === 'rifle-carbine') {
      return {
        ok: false,
        why: 'Section 13 takes a shotgun that is not semi-automatic, or a handgun that is not fully automatic. A rifle or carbine cannot be licensed for self-defence.',
      };
    }
    if (category === 'shotgun' && selfLoading === true) {
      return {
        ok: false,
        why: 'Section 13 takes only a shotgun that is not semi-automatic. A semi-automatic shotgun is a restricted firearm — it goes under section 14, or under section 16 with dedicated status if it fires no more than five shots without reloading.',
      };
    }
    // A handgun is fine here, semi-automatic or not: s13(1)(b) excludes only
    // fully automatic.
    return { ok: true };
  }

  if (section === 'S15' && selfLoading === true && category !== 'handgun') {
    return {
      ok: false,
      why: 'Section 15 takes a rifle or shotgun only where it is not semi-automatic. A semi-automatic rifle needs section 16 with dedicated status, or section 14; a semi-automatic shotgun needs section 14, or section 16 if it fires no more than five shots without reloading.',
    };
  }

  return { ok: true };
}
