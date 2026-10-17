import { MotivationLicenceType } from '@prisma/client';
import { classifyCalibre } from './motivation-overlap';

// ────────────────────────────────────────────────────────────────────
// WHICH WAY A SECTION 15 OR 16 MOTIVATION IS ARGUED, DECIDED FROM THE PACK.
//
// Operator, 2026-10-17: "we need to look at all the applicants paperwork and
// decide which way we are going to take the motivation. We need to remove all
// the questions that asks the user what are they planning to do with this
// firearm. Everything must be automated."
//
// And, on the choice itself: "first look at what firearms they already own and
// what section the licenses falls in, look for gaps that the current calibre
// fills best in hunting or sport shooting and use it in that. Rmember a person
// may sport shoot or hunt with a firearm regardless of the dedicated status, as
// long as they posses a legal license for that firearm they may use it for any
// lawfull purpose."
//
// ⚠️ SO THE APPLICANT'S OWN TICK IS NOT THE INPUT. The battery, the firearm's
// own class and action, and the licence sections already held are. A handgun
// or a self-loading rifle/shotgun is argued in sport shooting; a manual rifle
// or shotgun can do both, and where the applicant already holds a firearm in
// the same calibre class the new one is argued into the COMPLEMENTARY gap.
//
// ⚠️ "BOTH" IS A REAL ANSWER, NOT A FALLBACK. A bolt-action rifle licensed
// under section 15 or 16 may lawfully be used for hunting and for sport
// shooting, and the applicant should not have to declare one and lose the
// other. The exhibits and the writer are given both pools.
//
// ⚠️ PURE. No Prisma, no model call. Every caller — the plan, the writer's
// candidate uses, the exhibits, the research brief — resolves the same answer
// from the same answers blob, so a document cannot argue one purpose while its
// pictures show another.
// ────────────────────────────────────────────────────────────────────

export type SportingPurpose = 'hunting' | 'sport' | 'both';

/** The three classes of firearm an exhibit/route decision turns on. */
export type PurposeWeaponClass = 'handgun' | 'rifle' | 'shotgun';

/**
 * The applied-for firearm's class, from its own answers.
 *
 * ⚠️ THE TYPE BOX LEADS AND THE CALIBRE ONLY BREAKS A TIE — the same rule the
 * exhibit picker has always used.
 */
export function weaponClass(
  a: Record<string, string>,
): PurposeWeaponClass | null {
  const type = (a.firearm_type ?? '').toLowerCase();
  if (/shotgun/.test(type)) return 'shotgun';
  if (/handgun|pistol|revolver/.test(type)) return 'handgun';
  if (/rifle|carbine/.test(type)) return 'rifle';

  const blob = `${a.firearm_type ?? ''} ${a.firearm_action ?? ''} ${
    a.firearm_calibre ?? ''
  }`.toLowerCase();
  if (/shotgun|\bgauge\b|\b\d{1,2}\s?ga\b/.test(blob)) return 'shotgun';
  if (
    /handgun|pistol|revolver|9\s?mm|9x19|parabellum|\.22\s?lr|\.380|\.40\s?sw|\.45\s?acp/.test(
      blob,
    )
  ) {
    return 'handgun';
  }
  if (
    /rifle|carbine|creedmoor|springfield|\b6\.5\b|\.22\s?250|\.223|\.243|\.270|\.308|\.30-?06|\.300|\.338/.test(
      blob,
    )
  ) {
    return 'rifle';
  }
  return null;
}

interface HeldRow {
  type: string;
  calibre: string;
  section: string;
  role: 'hunting' | 'sport' | null;
}

const OWNED_ROWS = 14;

const HUNTING_WORDS =
  /\b(hunt|hunting|quarry|game|bushveld|plains|springbok|impala|kudu|gemsbok|wildebeest|hartebeest|eland|buffalo|jackal|warthog|wingshoot|bird|waterfowl|francolin|guineafowl|cull)\b/i;
const SPORT_WORDS =
  /\b(sport|shooting|competition|compete|match|matches|target|range|club|division|disciplinary|ipsc|idpa|practical|benchrest|f-class|prs|veldskiet|clay|trap|skeet|postal|score)\b/i;

function roleOf(text: string): 'hunting' | 'sport' | null {
  const hunt = HUNTING_WORDS.test(text);
  const sport = SPORT_WORDS.test(text);
  if (hunt && !sport) return 'hunting';
  if (sport && !hunt) return 'sport';
  return null;
}

/** The section a held row records, as "13" / "14" / "15" / "16" / "". */
function sectionOf(raw: string): string {
  const m = /^section_(\d{1,2})$/.exec((raw ?? '').trim());
  return m ? m[1] : '';
}

/**
 * The firearms the applicant already holds, as far as the answers blob knows.
 *
 * ⚠️ THE PROFILE AND THE VAULT MIRROR THESE INTO THE ANSWERS before the sheet
 * or the generator reads them, so this does not have to open either.
 */
function heldRows(a: Record<string, string>): HeldRow[] {
  const out: HeldRow[] = [];
  for (let n = 1; n <= OWNED_ROWS; n++) {
    const p = `existing_firearm_${n}_`;
    const val = (col: string) => (a[`${p}${col}`] ?? '').trim();
    const any = [
      'make',
      'model',
      'serial',
      'barrel_serial',
      'frame_serial',
      'calibre',
      'type',
      'use',
      'primary_use',
      'section_held',
      'licence_no',
      'expiry',
    ].some((col) => val(col) !== '');
    if (!any) continue;
    out.push({
      type: val('type'),
      calibre: val('calibre'),
      section: sectionOf(val('section_held')),
      role: roleOf(`${val('use')} ${val('primary_use')}`.replace(/_/g, ' ')),
    });
  }
  return out;
}

/**
 * Is the held row the same class of firearm as the one applied for?
 *
 * ⚠️ CALIBRE CLASS FIRST, EXACT THROUGH THE CURATED TABLE. A .308 and a
 * .30-06 are the same class of job even though they are different rounds. Where
 * the table does not know either round, the firearm TYPE is the next honest
 * test; where neither is known, the row is not treated as the same class.
 */
function sameClass(row: HeldRow, a: Record<string, string>): boolean {
  const mine = classifyCalibre(a.firearm_calibre ?? '');
  const theirs = classifyCalibre(row.calibre);
  if (mine && theirs) return mine === theirs;
  const myType = weaponClass(a);
  const theirType = /shotgun|gauge/i.test(row.type)
    ? 'shotgun'
    : /handgun|pistol|revolver/i.test(row.type)
      ? 'handgun'
      : /rifle|carbine/i.test(row.type)
        ? 'rifle'
        : null;
  return !!myType && myType === theirType;
}

/**
 * Which way this application is argued.
 *
 * ⚠️ IT NEVER THROWS AND NEVER RETURNS NULL. The applicant is always doing
 * something lawful with the firearm; where we cannot narrow it, both pools are
 * the honest answer.
 */
export function resolveSportingPurpose(
  a: Record<string, string>,
): SportingPurpose {
  const cls = weaponClass(a);
  const semi = /semi|self-?load/i.test(a.firearm_action ?? '');

  // A handgun, or a self-loading rifle/shotgun, is overwhelmingly a sport
  // firearm in South Africa. A hunting endorsement can still be argued from
  // the writer's facts, but it does not get to convert the whole document.
  if (cls === 'handgun') return 'sport';
  if (semi) return 'sport';

  // Dangerous-game chamberings are hunting, not sport, whatever the action.
  // ⚠️ THE CURATED TABLE IS NOT EVERY BIG-BORE. A .375 H&H wildcat or an
  // Afrikaans spelling the table does not carry is still a dangerous-game
  // round, and the exhibits must not put a kudu on a buffalo rifle's page.
  if (
    classifyCalibre(a.firearm_calibre ?? '') === 'dangerous_game' ||
    /\b(?:375|376|378|404|416|458|470|500|505|577|600)\b|9[.,]3\s?x\s?62/i.test(
      a.firearm_calibre ?? '',
    )
  ) {
    return 'hunting';
  }

  const held = heldRows(a).filter(
    (r) => r.section !== '13' && r.section !== '14',
  );
  const same = held.filter((r) => sameClass(r, a));
  if (!same.length) return 'both';

  const roles = new Set(same.map((r) => r.role).filter(Boolean));
  if (roles.has('hunting') && !roles.has('sport')) return 'sport';
  if (roles.has('sport') && !roles.has('hunting')) return 'hunting';
  return 'both';
}

/**
 * Which purpose heading a section 15/16 document leads with.
 *
 * ⚠️ HUNTING LEADS A TIE, per the guide book: the document may argue both where
 * the firearm genuinely does both, but it leads with the quarry.
 */
export function s15Purpose(
  answers: Record<string, string>,
): 'hunting' | 'sport' {
  return resolveSportingPurpose(answers) === 'sport' ? 'sport' : 'hunting';
}

/** True for the two licence types whose purpose is resolved from the pack. */
export function isSportingLicence(t: MotivationLicenceType): boolean {
  return (
    t === MotivationLicenceType.S15_OCCASIONAL_HUNTER ||
    t === MotivationLicenceType.S16_DEDICATED_HUNTER ||
    t === MotivationLicenceType.S16_DEDICATED_SPORT
  );
}
