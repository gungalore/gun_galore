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

/** A firearm the applicant already holds a licence for. */
export interface HeldFirearm {
  /** As the applicant wrote it. */
  calibre: string;
  /** For the message — "your .308 Tikka". Optional. */
  describedAs?: string;
}

export type OverlapVerdict =
  | { kind: 'overlap'; quarry: QuarryClass; withCalibres: string[] }
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

/**
 * Does the firearm being applied for cover ground the applicant already covers?
 *
 * `licenceType` matters: a dedicated hunter or sport shooter can hold several
 * similar rifles for reasons the Act recognises — different disciplines,
 * different classes, a backup for a match — so the same overlap is a much
 * softer question for them than for an occasional hunter, who has to show this
 * particular firearm suits a purpose they actually pursue.
 */
export function checkOverlap(
  appliedForCalibre: string,
  held: HeldFirearm[],
  opts: { dedicatedStatus: boolean } = { dedicatedStatus: false },
): OverlapCheck {
  const mine = classifyCalibre(appliedForCalibre);

  // We do not know what is being applied for. Ask; never assume it is clear.
  if (!mine) {
    return {
      verdict: { kind: 'unknown', unrecognised: [appliedForCalibre].filter(Boolean) },
      needsJustification: false,
      prompt: null,
      writerNote: null,
    };
  }

  const matches: string[] = [];
  const unrecognised: string[] = [];
  for (const h of held) {
    const c = classifyCalibre(h.calibre);
    if (!c) {
      if (h.calibre?.trim()) unrecognised.push(h.calibre.trim());
      continue;
    }
    if (c === mine) matches.push(h.describedAs?.trim() || h.calibre.trim());
  }

  if (matches.length === 0) {
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

  const label = QUARRY_LABELS[mine];
  const list = matches.join(', ');

  return {
    verdict: { kind: 'overlap', quarry: mine, withCalibres: matches },
    needsJustification: true,
    prompt:
      `You already hold ${list}, which covers ${label} — the same ground as the firearm you are applying for. ` +
      'A reviewer will see both on your licence record, so the application should say plainly why you need both ' +
      'rather than leave it to be asked. What does this one do that the other cannot?',
    writerNote:
      `The applicant already holds ${list}, in the same class (${label}) as the firearm applied for. ` +
      'Address this DIRECTLY and early, using only the reason the applicant gave — do not invent a distinction. ' +
      'If the reason given is thin, say what it is plainly rather than dressing it up.' +
      (opts.dedicatedStatus
        ? ' The applicant holds dedicated status, so a genuine second firearm for a different discipline or a match backup is ordinary; still state the reason.'
        : ' The applicant does NOT hold dedicated status, so this needs a concrete, practical reason grounded in the hunting or shooting they actually do.'),
  };
}
