import { MotivationLicenceType } from '@prisma/client';
// ────────────────────────────────────────────────────────────────────
// "YOU ALREADY HAVE ONE OF THOSE."
//
// Operator, 2026-08-18, and this is the real meaning of keeping a member's
// earlier motivations:
//
//   "If I was approved for a .308, that is a medium game calibre. And I buy a
//    .270, which is also a medium game calibre, the CFR might pick up on that —
//    especially if you are an occasional hunter/sport shooter — and might
//    decline. You need to give a valid reason why you would need them both."
//
// So continuity is not about reusing prose. It is about knowing what the
// applicant already holds and MEETING THE OBJECTION BEFORE IT IS RAISED. A
// section 15 applicant must show the firearm suits a purpose they genuinely
// pursue; a second rifle covering ground the first already covers reads as
// wanting rather than needing, and that is a refusal.
//
// The failure this prevents is silent. Nobody writes "you already own a .308"
// on a refusal — the application simply comes back, and the applicant never
// learns that the two calibres were the problem.
//
// ── HOW IT DECIDES, AND WHAT IT REFUSES TO DECIDE ──────────────────
//
// A CURATED TABLE, matched EXACTLY. No fuzzy matching, no substring guessing,
// no nearest-neighbour. This codebase has been bitten here before: the
// cartridge-spec work needed a 43-agent audit that caught twelve DANGEROUS
// fuzzy mismatches, fixed only by an explicit overrides map. A calibre that is
// not in this table returns null and the applicant is ASKED — never assumed.
//
// Being wrong in either direction costs something real:
//   • a missed overlap  → the objection goes unanswered and the application is
//                         refused for a reason nobody explains
//   • a false overlap   → we demand a justification for two firearms that do
//                         genuinely different jobs, and make the document argue
//                         against a problem it does not have
//
// So the table is deliberately conservative and deliberately short. It covers
// what South Africans actually license. Everything else is a question.
//
// ⚠️ THIS IS NOT BALLISTIC ADVICE and it is not a legal test. It is a prompt to
// the applicant to explain themselves, and a note to the writer to address it.
// Nothing here decides whether an application is any good.
//
// ── AND THE CARTRIDGE IS NOT ALWAYS WHAT DUPLICATES ────────────────
//
// Everything above asks a QUARRY question, and that question is quarry-shaped
// because it came from a hunter. There is a second overlap it cannot see — see
// classifyFirearmType below, and typeTestFor for which licence type turns on
// which. The two run together; neither replaces the other.
//
// PURE — no Nest, no Prisma, no clock.
// ────────────────────────────────────────────────────────────────────

/**
 * What a firearm is FOR, coarsely.
 *
 * Coarse on purpose. The question is not whether two cartridges are ballistic
 * twins, it is whether a reviewer glancing at a licence list would say "you
 * already have something that does this".
 */
export type QuarryClass =
  | 'rimfire'
  | 'varmint'
  | 'medium_game'
  | 'large_game'
  | 'dangerous_game'
  | 'handgun'
  | 'shotgun';

export const QUARRY_LABELS: Record<QuarryClass, string> = {
  rimfire: 'rimfire / small game',
  varmint: 'varmint and small plains game',
  medium_game: 'medium plains game',
  large_game: 'large plains game',
  dangerous_game: 'dangerous game',
  handgun: 'handgun',
  shotgun: 'shotgun',
};

/**
 * The curated table: every cartridge with EVERY SPELLING we accept for it.
 *
 * Spelled out rather than derived. An earlier version of this file tried to be
 * clever — expanding "win" to "winchester", stripping noise words with regexes
 * — and it was wrong in both directions at once: it missed ".308win" written
 * without a space, and one of its patterns matched very nearly anything.
 * Listing the aliases is longer and duller and it cannot do that.
 *
 * Names are compared after collapsing to lowercase alphanumerics, so ".308 Win",
 * "308 Win." and ".308WIN" all reach the same entry. That folds ONE cartridge's
 * spellings together; it never brings two cartridges together, because the
 * result must still hit an entry a human put here.
 *
 * A bare number is accepted only where it is unambiguous in South African use:
 * "308" is a .308 Winchester, but "300" is deliberately absent because it could
 * be a Win Mag, a WSM, a PRC or a Blackout — and those are not the same
 * argument.
 */
const CARTRIDGES: { quarry: QuarryClass; names: string[] }[] = [
  // -- rimfire --
  { quarry: 'rimfire', names: ['.22 LR', '22lr', '.22 Long Rifle', '22 rimfire'] },
  { quarry: 'rimfire', names: ['.22 WMR', '22wmr', '.22 Magnum', '.22 Mag'] },
  { quarry: 'rimfire', names: ['.17 HMR', '17hmr'] },
  { quarry: 'rimfire', names: ['.22 Short'] },

  // -- varmint / small plains game --
  { quarry: 'varmint', names: ['.22 Hornet'] },
  { quarry: 'varmint', names: ['.204 Ruger', '204'] },
  { quarry: 'varmint', names: ['.222 Remington', '.222 Rem', '222'] },
  { quarry: 'varmint', names: ['.223 Remington', '.223 Rem', '223'] },
  { quarry: 'varmint', names: ['5.56 NATO', '5.56x45', '5.56'] },
  { quarry: 'varmint', names: ['.22-250 Remington', '.22-250 Rem', '22-250'] },
  { quarry: 'varmint', names: ['.220 Swift'] },
  { quarry: 'varmint', names: ['.243 Winchester', '.243 Win', '243'] },
  { quarry: 'varmint', names: ['6mm Remington', '6mm Rem'] },

  // -- medium plains game: the crowded class, and the one in the example --
  { quarry: 'medium_game', names: ['.25-06 Remington', '.25-06 Rem', '25-06'] },
  { quarry: 'medium_game', names: ['.257 Roberts'] },
  { quarry: 'medium_game', names: ['6.5 Creedmoor', '6.5creedmoor'] },
  { quarry: 'medium_game', names: ['6.5x55', '6.5x55 Swedish', '6.5 Swede'] },
  { quarry: 'medium_game', names: ['6.5 PRC'] },
  { quarry: 'medium_game', names: ['.260 Remington', '.260 Rem', '260'] },
  { quarry: 'medium_game', names: ['.270 Winchester', '.270 Win', '270'] },
  { quarry: 'medium_game', names: ['.270 WSM'] },
  { quarry: 'medium_game', names: ['7x57', '7x57 Mauser', '7mm Mauser'] },
  { quarry: 'medium_game', names: ['7x64', '7x64 Brenneke'] },
  { quarry: 'medium_game', names: ['7mm-08 Remington', '7mm-08 Rem', '7mm-08'] },
  { quarry: 'medium_game', names: ['.280 Remington', '.280 Rem', '280'] },
  {
    quarry: 'medium_game',
    names: ['7mm Remington Magnum', '7mm Rem Mag', '7mm Rem Magnum'],
  },
  { quarry: 'medium_game', names: ['.308 Winchester', '.308 Win', '308'] },
  {
    quarry: 'medium_game',
    names: ['.30-06 Springfield', '.30-06 Sprg', '.30-06', '3006'],
  },
  { quarry: 'medium_game', names: ['.303 British', '303'] },
  { quarry: 'medium_game', names: ['.30-30 Winchester', '.30-30 Win', '30-30'] },
  { quarry: 'medium_game', names: ['8x57', '8x57 JS', '8mm Mauser'] },

  // -- large plains game --
  {
    quarry: 'large_game',
    names: ['.300 Winchester Magnum', '.300 Win Mag', '300 win mag'],
  },
  { quarry: 'large_game', names: ['.300 WSM'] },
  { quarry: 'large_game', names: ['.300 PRC'] },
  { quarry: 'large_game', names: ['9.3x62', '93x62'] },
  { quarry: 'large_game', names: ['9.3x64'] },
  { quarry: 'large_game', names: ['.338 Winchester Magnum', '.338 Win Mag'] },
  { quarry: 'large_game', names: ['.35 Whelen'] },
  { quarry: 'large_game', names: ['.375 H&H', '.375 H&H Magnum', '375hh'] },
  { quarry: 'large_game', names: ['.375 Ruger'] },

  // -- dangerous game --
  { quarry: 'dangerous_game', names: ['.404 Jeffery'] },
  { quarry: 'dangerous_game', names: ['.416 Rigby'] },
  { quarry: 'dangerous_game', names: ['.416 Remington Magnum', '.416 Rem Mag'] },
  { quarry: 'dangerous_game', names: ['.458 Winchester Magnum', '.458 Win Mag'] },
  { quarry: 'dangerous_game', names: ['.458 Lott'] },
  { quarry: 'dangerous_game', names: ['.470 Nitro Express', '470ne'] },
  { quarry: 'dangerous_game', names: ['.500 Nitro Express', '500ne'] },

  // -- handgun --
  { quarry: 'handgun', names: ['9mm', '9mm Parabellum', '9mm Luger', '9x19'] },
  { quarry: 'handgun', names: ['.38 Special', '38 spl'] },
  { quarry: 'handgun', names: ['.357 Magnum', '.357 Mag', '357'] },
  { quarry: 'handgun', names: ['.40 S&W', '40sw'] },
  { quarry: 'handgun', names: ['10mm Auto', '10mm'] },
  { quarry: 'handgun', names: ['.45 ACP', '45acp'] },
  { quarry: 'handgun', names: ['.44 Magnum', '.44 Mag'] },
  { quarry: 'handgun', names: ['.454 Casull'] },

  // -- shotgun --
  { quarry: 'shotgun', names: ['12 gauge', '12ga', '12 bore'] },
  { quarry: 'shotgun', names: ['16 gauge', '16ga'] },
  { quarry: 'shotgun', names: ['20 gauge', '20ga'] },
  { quarry: 'shotgun', names: ['28 gauge', '28ga'] },
  { quarry: 'shotgun', names: ['.410', '410 bore'] },
];

/** Collapse a written calibre to lowercase alphanumerics, and nothing more. */
function collapse(raw: string): string {
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const CALIBRE_CLASS: Map<string, QuarryClass> = (() => {
  const m = new Map<string, QuarryClass>();
  for (const c of CARTRIDGES) {
    for (const n of c.names) {
      const key = collapse(n);
      // A spelling listed under two cartridges is a bug in the table above, not
      // something to resolve at runtime by quietly picking one of them.
      const existing = m.get(key);
      if (existing && existing !== c.quarry) {
        throw new Error(
          `motivation-overlap: "${n}" is listed under both ${existing} and ${c.quarry}`,
        );
      }
      m.set(key, c.quarry);
    }
  }
  return m;
})();

/**
 * What class a calibre falls in, or NULL when we do not know.
 *
 * Null is a real and frequent answer, and the caller must treat it as "ask the
 * applicant", never as "no overlap". Wildcats, obsolete European cartridges and
 * anything typed with a spelling we have not seen all land here.
 */
export function classifyCalibre(calibre: string): QuarryClass | null {
  const key = collapse(calibre);
  if (!key) return null;
  return CALIBRE_CLASS.get(key) ?? null;
}

// ────────────────────────────────────────────────────────────────────
// THE OTHER OVERLAP: TWO HANDGUNS ARE TWO HANDGUNS.
//
// "Does your .308 already cover this game?" is the right question for a
// hunter. It is the wrong question for a dedicated sport shooter and it is
// nearly meaningless for a section 13 applicant. What a reviewer sees
// duplicated there is the FIREARM, not the cartridge — a second handgun is a
// second handgun whatever it chambers, and the answer that satisfies the
// objection is a different division, a different course of fire, a different
// role.
//
// Seen live on MO000017. The applicant held a Glock in 9mm Parabellum and
// applied for a 6.35mm Browning pistol under section 16 (dedicated sport).
// Different calibres, so the calibre test found nothing, so no comparison
// section went into the plan — and the quality gate then marked the document
// down for the missing comparison. It was worse than a class mismatch:
// 6.35mm Browning is not in the table above at all, so the check returned
// `unknown` and fell out before it compared anything.
//
// ⚠️ SO THE TYPE TEST RUNS EVEN WHEN THE CARTRIDGE IS UNREADABLE. An unknown
// calibre must never switch the whole module off.
// ────────────────────────────────────────────────────────────────────

/**
 * The four types the SAPS 271 offers, as `firearm_type` and
 * `existing_firearm_N_type` store them.
 */
export type FirearmType = 'rifle' | 'shotgun' | 'handgun' | 'combination';

export const FIREARM_TYPE_LABELS: Record<FirearmType, string> = {
  rifle: 'rifle',
  shotgun: 'shotgun',
  handgun: 'handgun',
  combination: 'combination firearm',
};

/**
 * What type a firearm is, or NULL when we do not know.
 *
 * Exact, like the cartridge table and for the same reason. Both fields are
 * `kind: 'choice'` over the 271's own four and the document extractor discards
 * anything that is not one of them verbatim, so the only variation that can
 * reach here is case and stray whitespace. "Pistol" and "Revolver" are
 * deliberately NOT accepted: neither can come out of the registry, and
 * teaching this function to guess is how the twelve dangerous cartridge
 * mismatches happened.
 *
 * ⚠️ 'combination' matches only itself. A combination gun carries a rifled and
 * a smooth barrel, and whether that duplicates a rifle is an argument, not a
 * lookup.
 */
export function classifyFirearmType(
  raw: string | null | undefined,
): FirearmType | null {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'rifle':
      return 'rifle';
    case 'shotgun':
      return 'shotgun';
    case 'handgun':
      return 'handgun';
    case 'combination':
      return 'combination';
    default:
      return null;
  }
}

/**
 * How much weight the type test carries, per licence type.
 *
 * 'leads'     — the type IS the duplication a reviewer sees, and the document
 *               must answer it whether or not the calibres differ.
 * 'secondary' — the quarry question comes first, but a second firearm of the
 *               same type is still worth a sentence. We do NOT suppress it:
 *               the applicant who owns three rifles and applies for a fourth
 *               is asked about it, and answering briefly costs nothing.
 * 'off'       — see the renewal warning below.
 *
 * ⚠️ S24 IS OFF, AND IT IS OFF FOR A REASON THAT LOOKS LIKE A BUG UNTIL YOU
 * READ IT. A renewal applicant genuinely holds the firearm being renewed, and
 * on a renewal it is by definition the same type as itself. Nothing is being
 * acquired, so "you already hold a handgun" carries no information about the
 * decision in front of the Registrar — it is a restatement of the application.
 * Left on, it produces a comparison section arguing why a firearm does not
 * duplicate ITSELF, over the applicant's signature. The calibre test survives
 * a renewal (renewing a .270 while holding a .308 is a real question), but only
 * after the renewed firearm has been positively identified and set aside —
 * which is overlapFromAnswers' job, not this one's.
 */
function typeTestFor(
  licenceType: MotivationLicenceType | undefined,
): 'leads' | 'secondary' | 'off' {
  switch (licenceType) {
    case MotivationLicenceType.S13_SELF_DEFENCE:
    case MotivationLicenceType.S16_DEDICATED_SPORT:
      return 'leads';
    case MotivationLicenceType.S24_RENEWAL:
      return 'off';
    default:
      return 'secondary';
  }
}

/** A firearm the applicant already holds a licence for. */
export interface HeldFirearm {
  /** As the applicant wrote it. */
  calibre: string;
  /**
   * `existing_firearm_N_type`, as stored. Optional: callers that predate the
   * type test pass none, and a row may carry a type with no calibre.
   */
  type?: string;
  /** For the message — "your .308 Tikka". Optional. */
  describedAs?: string;
}

export type OverlapVerdict =
  | {
      kind: 'overlap';
      /**
       * The shared calibre class, or NULL when the match is by firearm type
       * alone — two handguns in cartridges the table does not carry still
       * overlap.
       */
      quarry: QuarryClass | null;
      /** Held firearms in that calibre class. Empty on a type-only match. */
      withCalibres: string[];
      /** The type applied for, when held firearms share it. Else null. */
      firearmType: FirearmType | null;
      /** Held firearms of that same type. Empty when nothing matched by type. */
      withTypes: string[];
    }
  | { kind: 'clear' }
  | { kind: 'unknown'; unrecognised: string[] };

export interface OverlapCheck {
  verdict: OverlapVerdict;
  /** True when the document MUST address this. Drives a required field. */
  needsJustification: boolean;
  /** Shown to the applicant. Plain, specific, never alarming. */
  prompt: string | null;
  /**
   * Handed to the writer as an instruction, not as prose to copy. Null when
   * there is nothing to address — we never invent a difficulty to argue with.
   */
  writerNote: string | null;
}

export interface OverlapOptions {
  /**
   * Section 16. A dedicated hunter or sport shooter can hold several similar
   * firearms for reasons the Act recognises — different disciplines, different
   * classes, a backup for a match — so the same overlap is a much softer
   * question for them than for an occasional hunter, who has to show this
   * particular firearm suits a purpose they actually pursue.
   */
  dedicatedStatus?: boolean;
  /**
   * `firearm_type` for the firearm applied for. Without it there is no type
   * test — we compare what we were given, and nothing else.
   */
  appliedForType?: string;
  /**
   * Which overlap this licence type actually turns on; see typeTestFor.
   * Absent means the calibre leads and a type match is reported behind it.
   *
   * ⚠️ ON S24 THE CALLER MUST ALREADY HAVE REMOVED THE FIREARM BEING RENEWED
   * from `held`. Nothing in this function can tell a renewal's own firearm
   * apart from a second one; overlapFromAnswers does that with the serials and
   * the licence number, which live in the answers.
   */
  licenceType?: MotivationLicenceType;
}

/**
 * What we say to the APPLICANT about an overlap. An offer, never a demand.
 *
 * They are paying us to make this argument; telling them to go and make it
 * instead is the thing the operator objected to. So we say we have seen it,
 * that the document will meet it, and that a reason of their own would be used
 * first if they happen to have one.
 *
 * ⚠️ APPENDED ONCE by the caller, not built into each paragraph — when both
 * the calibre and the type test fire, the applicant used to be told twice in
 * consecutive sentences that a reviewer would see both firearms.
 */
const OFFER_TAIL = [
  'A reviewer will see both on your licence record, so your motivation deals with it head-on — we write',
  'that argument for you from the rest of your application. If there is a particular reason of your own —',
  'what this one does that the other cannot — add it below and we will lead with it.',
].join(' ');

/**
 * THE STANDING DIRECTION ON EVERY OVERLAP NOTE — write the distinction, do not
 * wait to be handed it.
 *
 * ⚠️ THIS USED TO SAY THE OPPOSITE. Every note ended "using only the reason
 * the applicant gave — do not invent a distinction", so where the applicant
 * gave nothing the writer had nothing, and the pipeline went and asked them for
 * it. That question is what the operator objected to on 2026-08-22: "It is the
 * job of the AI to do research as to why the applicant would need this firearm
 * and justify it for them according to the type of application, other weapons
 * owned that is similar, the shooting discipline the weapons are good for, the
 * experience of the applicant and all of those kind of factors."
 *
 * The old wording confused two things rule 8 of the writer's prompt already
 * keeps apart. WHAT THE APPLICANT HOLDS is a verifiable fact and must be
 * supplied. WHAT DISTINGUISHES TWO FIREARMS — division, course of fire, quarry,
 * terrain, range, the role each one plays — is rationale built out of facts
 * already in the pack, and rationale is the writer's craft in every
 * professionally written motivation.
 *
 * So the ban that remains is the one that always mattered: no NEW FACT may be
 * asserted to make the argument work. A firearm the applicant does not own, a
 * discipline they did not name, a hunt they did not describe are still
 * inventions, and rule 9's warning about comparative framing still binds.
 */
const ARGUE_IT = [
  'The distinction between two firearms is RATIONALE, not a fact about the applicant, so it is yours to',
  'build — from the licence type applied for, the purpose stated, the disciplines or quarry named, the',
  'ranges, ground and conditions described, the experience and record supplied, and what each firearm is',
  'chambered for and therefore suited to. Reason it out and state it plainly.',
  'Where the applicant gave a reason of their own, LEAD WITH IT and build around it — their reason is',
  'better evidence than any inference of yours. Where they gave none, argue it anyway: never write that no',
  'reason was given, and never leave the objection standing.',
  '⚠️ WHAT YOU MAY NOT DO IS ASSERT A NEW FACT to make the argument work — a firearm they do not own, a',
  'discipline they did not name, an event that did not happen. Argue from what is in the pack, and never',
  'suggest the overlap does not matter.',
].join(' ');

/** How the applicant would recognise a held firearm in a sentence. */
function describeHeld(h: HeldFirearm): string {
  return h.describedAs?.trim() || h.calibre?.trim() || (h.type ?? '').trim();
}

/**
 * Does the firearm being applied for cover ground the applicant already covers?
 *
 * Two tests, both run, neither replacing the other: the CALIBRE CLASS (does
 * your .308 already cover this game) and the FIREARM TYPE (two handguns are two
 * handguns). Which one leads the note is the licence type's business — see
 * typeTestFor.
 */
export function checkOverlap(
  appliedForCalibre: string,
  held: HeldFirearm[],
  opts: OverlapOptions = {},
): OverlapCheck {
  const mine = classifyCalibre(appliedForCalibre);
  const typeTest = typeTestFor(opts.licenceType);
  const myType =
    typeTest === 'off' ? null : classifyFirearmType(opts.appliedForType);

  // ⚠️ THE TYPE TEST RUNS FIRST, AND ON PURPOSE. It used to be that an
  // unreadable applied-for calibre returned early and nothing else was
  // compared — which is precisely how MO000017, a 6.35mm Browning the table
  // does not carry, got no comparison section against a 9mm already held.
  const typeMatches: string[] = [];
  if (myType) {
    for (const h of held) {
      if (classifyFirearmType(h.type) !== myType) continue;
      const named = describeHeld(h);
      if (named) typeMatches.push(named);
    }
  }

  const calibreMatches: string[] = [];
  const unrecognised: string[] = [];
  if (mine) {
    for (const h of held) {
      const c = classifyCalibre(h.calibre);
      if (!c) {
        if (h.calibre?.trim()) unrecognised.push(h.calibre.trim());
        continue;
      }
      if (c === mine) calibreMatches.push(describeHeld(h));
    }
  }

  if (calibreMatches.length === 0 && typeMatches.length === 0) {
    // We do not know what is being applied for. Ask; never assume it is clear.
    if (!mine) {
      return {
        verdict: {
          kind: 'unknown',
          unrecognised: [(appliedForCalibre ?? '').trim()].filter(Boolean),
        },
        needsJustification: false,
        prompt: null,
        writerNote: null,
      };
    }
    // An unreadable existing calibre is NOT a clean bill of health. Say so,
    // because "clear" here would let a real overlap through unnoticed.
    if (unrecognised.length) {
      return {
        verdict: { kind: 'unknown', unrecognised },
        needsJustification: false,
        prompt:
          `We could not place ${unrecognised.join(', ')} against the firearm you are applying for. ` +
          'If any of them is used for the same kind of hunting or shooting, say so in your answers — ' +
          'it is much better to explain it than to leave the Registrar to notice it.',
        writerNote: null,
      };
    }
    return {
      verdict: { kind: 'clear' },
      needsJustification: false,
      prompt: null,
      writerNote: null,
    };
  }

  // ⚠️ WHICH PARAGRAPH GOES FIRST DECIDES WHICH QUESTION GETS ASKED AT ALL.
  //
  // A firearm caught by both tests is ONE firearm, and naming it twice reads as
  // two separate accusations about the same rifle — so the second paragraph
  // only covers what the first did not name. That means the leading test must
  // run first, or the question the licence type actually turns on is the one
  // that gets deduped away. A section 13 applicant holding a 9mm and applying
  // for a .38 Special is the case: both are "handgun" to the calibre table, so
  // calibre-first swallowed the role question entirely.
  const leadsWithType = typeTest === 'leads' && typeMatches.length > 0;
  const calibreNamed = leadsWithType
    ? calibreMatches.filter((c) => !typeMatches.includes(c))
    : calibreMatches;
  const typeNamed = leadsWithType
    ? typeMatches
    : typeMatches.filter((t) => !calibreMatches.includes(t));

  const prompts: string[] = [];
  const notes: string[] = [];

  const calibreParagraph = () => {
    const label = QUARRY_LABELS[mine as QuarryClass];
    const list = calibreNamed.join(', ');
    prompts.push(
      `You already hold ${list}, which covers ${label} — the same ground as the firearm you are applying for.`,
    );
    // "also" only when a paragraph already stands above it.
    const opener = notes.length
      ? 'The applicant ALSO already holds'
      : 'The applicant already holds';
    notes.push(
      `${opener} ${list}, in the same class (${label}) as the firearm applied for. ` +
        'Address this DIRECTLY and early, and MAKE THE ARGUMENT YOURSELF. ' +
        ARGUE_IT +
        // A renewal is not an acquisition, so the dedicated-status framing does
        // not fit it: the Registrar is deciding whether the applicant may keep
        // a firearm, not whether they may add one.
        (opts.licenceType === MotivationLicenceType.S24_RENEWAL
          ? ' This is a renewal, so nothing further is being acquired — the question is why the applicant continues to need this firearm alongside the other, not why an additional one is justified.'
          : opts.dedicatedStatus
            ? ' The applicant holds dedicated status, so a genuine second firearm for a different discipline or a match backup is ordinary; still state the reason.'
            : ' The applicant does NOT hold dedicated status, so this needs a concrete, practical reason grounded in the hunting or shooting they actually do.'),
    );
  };

  const typeParagraph = () => {
    const typeLabel = FIREARM_TYPE_LABELS[myType as FirearmType];
    const list = typeNamed.join(', ');
    prompts.push(
      `You already hold ${list}, which is the same type of firearm you are applying for.`,
    );
    // "also" only when a paragraph already stands above it.
    const opener = notes.length
      ? 'The applicant ALSO already holds'
      : 'The applicant already holds';
    notes.push(
      typeTest === 'leads'
        ? `${opener} ${list} — the same TYPE of firearm (${typeLabel}) as the one applied for. ` +
            `On this licence type that is the duplication a reviewer sees, not the cartridge: two ${typeLabel}s are two ${typeLabel}s whatever they chamber. ` +
            'Answer why this firearm does not duplicate the ROLE of the one already held — ' +
            (opts.licenceType === MotivationLicenceType.S13_SELF_DEFENCE
              ? 'where and how each one is kept or carried, and what this one does that the other cannot'
              : 'a different division, a different course of fire, a different role') +
            '. ' +
            ARGUE_IT
        : // NOT "in a different calibre class". It may be, or the cartridge may
          // simply be one the table does not carry, and the writer must not be
          // handed a distinction we cannot stand behind.
          `${opener} ${list} — the same type of firearm (${typeLabel}) as the one applied for, which the cartridge comparison did not catch. ` +
            `A second ${typeLabel} is still a question worth answering, so say what this one is for that the other is not. ` +
            'Where the quarry genuinely differs, the quarry difference IS the answer and a sentence or two will do. ' +
            ARGUE_IT,
    );
  };

  if (leadsWithType) {
    typeParagraph();
    if (calibreNamed.length) calibreParagraph();
  } else {
    if (calibreNamed.length) calibreParagraph();
    if (typeNamed.length && myType) typeParagraph();
  }

  return {
    verdict: {
      kind: 'overlap',
      quarry: calibreMatches.length ? (mine as QuarryClass) : null,
      withCalibres: calibreMatches,
      firearmType: typeMatches.length ? myType : null,
      withTypes: typeMatches,
    },
    needsJustification: true,
    prompt: `${prompts.join(' ')} ${OFFER_TAIL}`,
    writerNote: notes.join(' '),
  };
}

// ────────────────────────────────────────────────────────────────────
// READING THE CHECK OUT OF THE APPLICANT'S OWN ANSWERS.
//
// checkOverlap takes a calibre, a type and a list of held firearms; the wizard
// stores them as registry fields. This is the one place that translation
// happens, so the service, the interview and the prompt all ask the same
// question of the same data — and so it can be tested without a database
// anywhere near it.
//
// ⚠️ DEDICATED STATUS IS DERIVED FROM THE LICENCE TYPE, not from a claim in an
// answer. A section 16 application IS the dedicated path; anything else is not,
// whatever an applicant may have typed elsewhere.
//
// ⚠️ THE RENEWAL'S OWN FIREARM IS TAKEN OUT HERE, before either test sees it.
// See indexOfRenewedFirearm — it needs the serials and the licence number, and
// those live in the answers rather than in a HeldFirearm.
// ────────────────────────────────────────────────────────────────────

/** How many existing-firearm rows the registry carries. */
const OWNED_ROWS = 6;

/**
 * One `existing_firearm_N_*` row, with the identifiers the renewal check needs
 * alongside the two fields the overlap tests compare.
 */
interface OwnedRow {
  held: HeldFirearm;
  make: string;
  licenceNo: string;
  barrelSerial: string;
  frameSerial: string;
}

function ownedRows(answers: Record<string, string>): OwnedRow[] {
  const rows: OwnedRow[] = [];
  for (let n = 1; n <= OWNED_ROWS; n++) {
    const at = (suffix: string) =>
      (answers[`existing_firearm_${n}_${suffix}`] ?? '').trim();
    const calibre = at('calibre');
    const type = at('type');
    // ⚠️ A ROW WITH A TYPE AND NO CALIBRE IS STILL A FIREARM. This skipped on a
    // missing calibre, which was harmless while the cartridge was the only test
    // and silently fatal the moment the type test arrived — a licence upload
    // that yields "Handgun" and no readable calibre is ordinary.
    if (!calibre && !type) continue;
    const make = at('make');
    // "your .308 Tikka" is answerable; "a medium game rifle" is not. With no
    // calibre there is nothing to name it by, so it gets an article rather than
    // being read out as "you already hold rifle".
    const named = [calibre, make, type.toLowerCase()].filter(Boolean).join(' ');
    rows.push({
      held: { calibre, type, describedAs: calibre ? named : `a ${named}` },
      make,
      licenceNo: at('licence_no'),
      barrelSerial: at('barrel_serial'),
      frameSerial: at('frame_serial'),
    });
  }
  return rows;
}

/**
 * Which owned row IS the firearm being renewed, or -1.
 *
 * ⚠️ THE ROW IS USUALLY THERE, AND IT IS NOT AN APPLICANT'S MISTAKE. The
 * section is headed "Firearms you already own" and a renewal applicant does
 * already own it; worse, `existing_firearm_N_*` is docSourced from
 * CURRENT_LICENCE, and on a renewal the current licence IS the licence being
 * renewed — so the extractor fills the row in for them. Left alone, the check
 * matches the firearm against itself and the document argues why a firearm does
 * not duplicate itself, over the applicant's signature.
 *
 * Three tests, strongest first, and only ONE row is ever removed: an applicant
 * renewing one of two identical Glocks should lose the renewed one and still be
 * asked about its twin.
 */
function indexOfRenewedFirearm(
  answers: Record<string, string>,
  rows: OwnedRow[],
): number {
  const licence = collapse(answers.existing_licence_number ?? '');
  if (licence) {
    const i = rows.findIndex((r) => collapse(r.licenceNo) === licence);
    if (i >= 0) return i;
  }

  const serial = collapse(answers.firearm_serial ?? '');
  if (serial) {
    const i = rows.findIndex(
      (r) =>
        collapse(r.barrelSerial) === serial || collapse(r.frameSerial) === serial,
    );
    if (i >= 0) return i;
  }

  // Last resort: the same type, the same calibre AS WRITTEN and the same make.
  // Compared as identity, never as class — ".270 and .308 are both medium game"
  // is the question, not the answer to it.
  const type = classifyFirearmType(answers.firearm_type);
  const calibre = collapse(answers.firearm_calibre ?? '');
  const make = collapse(answers.firearm_make ?? '');
  if (type && calibre && make) {
    return rows.findIndex(
      (r) =>
        classifyFirearmType(r.held.type) === type &&
        collapse(r.held.calibre) === calibre &&
        collapse(r.make) === make,
    );
  }

  return -1;
}

export function overlapFromAnswers(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
): OverlapCheck {
  const rows = ownedRows(answers);

  if (licenceType === MotivationLicenceType.S24_RENEWAL && rows.length) {
    const self = indexOfRenewedFirearm(answers, rows);
    if (self < 0) {
      // WE COULD NOT TELL, SO WE SAY NOTHING. Without a licence number, a
      // serial or a make to pin it on, a handgun sitting next to a handgun
      // renewal is far more likely to BE the renewal than to be a second one.
      //
      // The two costs are not symmetrical, and this file already weighs them:
      // a missed overlap loses a section the gate may ask for, a false one puts
      // a paragraph into a SAPS submission arguing against a problem the
      // applicant does not have. On a renewal nothing is being acquired, so the
      // missed section is the cheaper mistake.
      //
      // ⚠️ 'clear' HERE MEANS "nothing this document must argue against" — it
      // is not a finding that the holding was examined and came back clean.
      return {
        verdict: { kind: 'clear' },
        needsJustification: false,
        prompt: null,
        writerNote: null,
      };
    }
    rows.splice(self, 1);
  }

  const dedicatedStatus =
    licenceType === MotivationLicenceType.S16_DEDICATED_HUNTER ||
    licenceType === MotivationLicenceType.S16_DEDICATED_SPORT;

  return checkOverlap(
    (answers.firearm_calibre ?? '').trim(),
    rows.map((r) => r.held),
    {
      dedicatedStatus,
      appliedForType: answers.firearm_type,
      licenceType,
    },
  );
}
