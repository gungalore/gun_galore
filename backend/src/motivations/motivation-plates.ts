import { MotivationLicenceType } from '@prisma/client';
import { quarriesFor, type QuarrySpecies } from './motivation-quarry';
import { s15Purpose } from './motivation-fields';

// ────────────────────────────────────────────────────────────────────
// THE PURPOSE EXHIBITS — ONE TO TWO PAGES OF PICTURES UNDER HEADING 3.
//
// Operator, 2026-10-14: "i want nano banana 2.1 images generated for all
// sections. 1 to 2 pages per application with descriptions of the pictures.
// For hunting the quarry the rifle can hunt, for self defense scenarios where
// the person might find themselves in. For sport shooting the activities they
// will be attending in competition or recreationally."
//
// ⚠️ THE SCENARIOS ARE CHOSEN HERE, IN CODE, AND NOT ASKED OF A MODEL. A model
// asked "what scenarios apply to this applicant" would invent a threat, and a
// motivation that names a scenario the applicant never described is a false
// statement on a form they sign. The applicant's own answers pick from a fixed
// catalogue; where they said nothing, a neutral default from the same class is
// used. The only model call is the picture itself.
//
// ⚠️ NOTHING HERE IS A CLAIM ABOUT THE APPLICANT. Every caption describes the
// SCENARIO or the SPECIES in the abstract — "an automated gate at dusk is a
// point of confinement", "impala is the staple plains-game quarry at bushveld
// distances" — never "the applicant was hijacked" or "you hunt kudu". The
// document argues need; it does not manufacture facts.
//
// ⚠️ AND THE PROMPTS ARE BUILT TO CLEAR A SAFETY FILTER. A South African
// firearms marketplace generates lawful, regulated content, but an image model
// reads "self-defence scenario" as violence. So the self-defence plates
// picture the PLACE (a gate, a road, a corridor) and never a person, a firearm
// or an act. The sport plates picture the VENUE, not a shooter. See the shared
// NEGATIVES below.
// ────────────────────────────────────────────────────────────────────

/**
 * Bump when any wording below changes.
 *
 * ⚠️ A PLATE IS STORED FOREVER AND KEEPS ITS PROMPT VERSION, so a change to a
 * brief with no version bump leaves every existing plate looking like the old
 * wording with no way to tell which is which — the same trap
 * QUARRY_PROMPT_VERSION and researchAskVersion were written to close.
 */
export const PLATES_PROMPT_VERSION = '2026-10-15c';

/** Which of the three purposes a pack's exhibits serve. */
export type PlatePurpose = 'hunting' | 'self_defence' | 'sport';

/** Two plates to a page. */
export const PLATES_PER_PAGE = 2;

/**
 * The exhibit budget. Sport and self-defence stop at two pages; HUNTING runs to
 * five, because the operator asked for one animal to a picture and up to five
 * animals (2026-10-15: "one animal per picture with up to five animals where
 * applicable"). Five plates is three pages — 2 + 2 + 1 — which is the honest
 * size of a line-up that used to sit squeezed into one composite frame.
 */
export const MAX_PLATES = 4;
export const MAX_HUNTING_PLATES = 5;

export interface PlateSpec {
  /** 1-based page, and 1-based slot within it. */
  pageIndex: number;
  plateIndex: number;
  /** Short headline printed above the description. */
  title: string;
  /** Two to three neutral sentences about the scene. */
  description: string;
  /** What the picture model is asked to draw. */
  prompt: string;
}

export interface PlateContext {
  licenceType: MotivationLicenceType;
  answers: Record<string, string>;
  /** The applied-for firearm's research prose — the firearm and calibre blocks. */
  research?: string;
}

/**
 * Which exhibits a pack carries, from its licence type and the applicant's own
 * answers. Null for a renewal, which has no purpose section at all.
 */
export function purposeFor(
  licenceType: MotivationLicenceType,
  answers: Record<string, string>,
): PlatePurpose | null {
  switch (licenceType) {
    case MotivationLicenceType.S13_SELF_DEFENCE:
    case MotivationLicenceType.S14_RESTRICTED_SELF_DEFENCE:
      return 'self_defence';
    case MotivationLicenceType.S16_DEDICATED_HUNTER:
      return 'hunting';
    case MotivationLicenceType.S16_DEDICATED_SPORT:
      return 'sport';
    case MotivationLicenceType.S15_OCCASIONAL_HUNTER:
      // The section 15 variant is the applicant's own choice — see s15Purpose.
      return s15Purpose(answers) === 'sport' ? 'sport' : 'hunting';
    default:
      return null;
  }
}

/**
 * The shared close of every prompt.
 *
 * ⚠️ A PHOTOGRAPH, AND NOTHING DRAWN ON IT. The same rule the quarry plate
 * learned the hard way (see motivation-quarry.ts): a field-guide illustration
 * with a marked vital zone is an anatomical claim this platform has no
 * business making in a document somebody signs. And "no text, no watermark"
 * keeps a caption or a logo out of a page that prints under our own.
 */
const NEGATIVES = [
  'Photorealistic documentary photograph, natural South African light, sharp',
  'focus on the subject, background gently out of focus.',
  'No people, no firearms, no weapons, no violence, no blood, no injury, no',
  'distress, no text, no lettering, no watermark, no logo, no overlay, no',
  'borders, no captions, no markings of any kind.',
].join(' ');

/**
 * ⚠️ A RANGE RUNS ALONG ONE AXIS, AND THE MODEL KEEPS MIXING ITS ENDS.
 * Operator, 2026-10-15: "some of the images do not make sense, where the
 * targets sit next to the shooting benches." A range is a straight line —
 * firing point (with benches or a firing line) nearest the camera, every
 * target far downrange beyond it — and a picture with steel standing beside
 * the benches reads as a mistake to anyone who shoots. Appended to the range
 * venues only; the quarry, cover and cartridge pictures have no such axis.
 */
const DOWNRANGE =
  'The firing point, benches and firing line are in the foreground; every ' +
  'target is far downrange beyond them, small and distant on the same axis, ' +
  'never beside or behind the firing point.';

// ── hunting ───────────────────────────────────────────────────────────

/** The natural setting each game class is hunted in. */
const HABITAT: Record<string, string> = {
  small: 'a rocky outcrop or a dry riverbed in the South African bushveld',
  plains_light:
    'open grassy plains with scattered thorn trees in the South African bushveld',
  plains_medium:
    'open bushveld and grassy plains in South Africa with a line of trees behind',
  dangerous: 'dense riverine bushveld in South Africa',
  wingshooting: 'a waterhole fringed with reeds in the South African veld',
};

/**
 * The distance band a class is ordinarily taken at.
 *
 * ⚠️ WHEN, NOT A CLAIM. It describes the class of quarry, the way a field guide
 * does — it never says this applicant has made such a shot.
 */
const RANGE: Record<string, string> = {
  small: 'typically taken at close range over open ground',
  plains_light: 'typically taken at bushveld distances of 100 to 200 metres',
  plains_medium: 'typically taken at 150 to 250 metres',
  dangerous: 'taken at close quarters with a heavier calibre',
  wingshooting: 'taken on the wing over decoys or walked-up cover',
};

/** How the caption names the class of animal. */
const CLASS_LABEL: Record<string, string> = {
  small: 'small game and varmint',
  plains_light: 'light plains game',
  plains_medium: 'medium to large plains game',
  dangerous: 'dangerous game',
  wingshooting: 'a bird taken on the wing',
};

/**
 * ⚠️ WHY THIS CARTRIDGE SUITS THIS ANIMAL, AND WHY IT CLAIMS NOTHING IT CANNOT.
 * Operator, 2026-10-15: "give a description of why it is good for that animal."
 * The reason is stated CLASS BY CLASS, not invented per species: what a class of
 * quarry demands of a cartridge is a fact about the class (its size, its range,
 * how it is taken), and the applicant's own cartridge is on the page because the
 * cartridge brief for THIS application named it (see quarriesFor). No figure, no
 * energy, no velocity is asserted — those live in the cartridge research text,
 * and a number recalled here would be an invented fact on a signed document.
 */
const CLASS_RATIONALE: Record<string, string> = {
  small:
    'this class is taken at close range, so what counts is a light, ' +
    'flat-shooting load and a quick, accurate shot',
  plains_light:
    'this class is taken in the open at distance, where a flat trajectory ' +
    'and a fast follow-up shot matter most',
  plains_medium:
    'this class is heavy-bodied and often taken at bushveld distances, so a ' +
    'cartridge matched to it must carry the retained energy to place the shot ' +
    'cleanly and humanely',
  dangerous:
    'this class demands a heavy, controlled cartridge that will stop a ' +
    'determined charge at close quarters',
  wingshooting:
    'this class is taken on the wing at close range, where a fast, spreading ' +
    'shot pattern is what the shot depends on',
};

function speciesPlate(species: QuarrySpecies): Omit<PlateSpec, 'pageIndex' | 'plateIndex'> {
  const habitat = HABITAT[species.klass] ?? HABITAT.plains_medium;
  const range = RANGE[species.klass] ?? RANGE.plains_medium;
  const label = CLASS_LABEL[species.klass] ?? CLASS_LABEL.plains_medium;
  const why = CLASS_RATIONALE[species.klass] ?? CLASS_RATIONALE.plains_medium;
  return {
    title: species.name,
    description:
      `${species.name} is ${label}, ${range}. The cartridge brief for this ` +
      `application names it among the game this firearm is well matched to, ` +
      `and this is why: ${why}. It is pictured in ${habitat}, the setting a ` +
      `licence for this purpose is intended for.`,
    prompt:
      `A photorealistic wildlife photograph of ${species.subject} standing ` +
      `broadside in ${habitat}, soft early-morning light, taken with a long ` +
      `lens. ${NEGATIVES}`,
  };
}

// ── self-defence ──────────────────────────────────────────────────────

interface Scene {
  /** Matched against the applicant's own answers; empty means "the default". */
  when?: (answers: Record<string, string>) => boolean;
  title: string;
  description: string;
  prompt: string;
}

const SELF_DEFENCE_SCENES: readonly Scene[] = [
  {
    when: (a) => /farm|smallholding|plot|rural|plaas/i.test(a.premises_type ?? ''),
    title: 'A rural perimeter',
    description:
      'On a rural property the nearest police station is many minutes away, ' +
      'and a fence line stretches further than a single person can watch. A ' +
      'resident is on their own for the whole of that response time.',
    prompt:
      'A photorealistic photograph of a rural smallholding at dusk in South ' +
      'Africa, a farm gate and a long fence line running into open veld, a ' +
      `distant farmhouse light, a wide empty landscape. ${NEGATIVES}`,
  },
  {
    when: (a) => /apartment|flat|communal|block/i.test(a.premises_type ?? ''),
    title: 'Communal access',
    description:
      'A shared entrance and parking area is a door many people hold a key ' +
      'to, and a dim passage between a vehicle and a front door is where a ' +
      'resident is most exposed.',
    prompt:
      'A photorealistic photograph of the communal entrance and parking area ' +
      'of a low-rise apartment block in South Africa at dusk, an open ' +
      `pedestrian gate and dim passage lighting. ${NEGATIVES}`,
  },
  {
    when: (a) =>
      /commut|dunoon|elsies|taxi|traffic|drive|route|travel|road/i.test(
        `${a.daily_movements ?? ''} ${a.threat_circumstances ?? ''}`,
      ),
    title: 'The daily commute',
    description:
      'A regular route through known high-crime precincts, often at the same ' +
      'hours each day, is a predictable and stationary exposure that no ' +
      'alarm or wall can cover.',
    prompt:
      'A photorealistic photograph of an urban arterial road in South Africa ' +
      'at dusk, stalled traffic lanes seen from a distance, shopfronts and ' +
      `streetlights, long shadows. ${NEGATIVES}`,
  },
  {
    when: (a) => /gate|driveway|house|home|suburb|wall/i.test(a.premises_type ?? ''),
    title: 'The driveway gate',
    description:
      'A vehicle stopped at an automated gate is stationary and boxed in, ' +
      'waiting for a gate to open or close — the moment at home when a ' +
      'resident is least able to move.',
    prompt:
      'A photorealistic photograph of a quiet suburban residential street in ' +
      'South Africa at dusk, looking through a closed automated driveway gate ' +
      'toward a house behind a high wall, warm security lights. ' +
      `${NEGATIVES}`,
  },
];

/**
 * The generic fallbacks, used for any slot the applicant's answers did not
 * fill. Always enough to reach two pages, because a self-defence pack always
 * has a purpose section.
 */
const SELF_DEFENCE_DEFAULTS: readonly Scene[] = [
  {
    title: 'An unlit regional road',
    description:
      'Regional routes between towns run through open veld with no lighting ' +
      'and long gaps between police stations. A breakdown or a forced stop ' +
      'there leaves a motorist entirely without help.',
    prompt:
      'A photorealistic photograph of an isolated regional road at dusk in ' +
      'South Africa, open veld on both sides, distant hills and fading light, ' +
      `an empty road. ${NEGATIVES}`,
  },
  SELF_DEFENCE_SCENES[0],
  SELF_DEFENCE_SCENES[3],
  {
    title: 'A home at night',
    description:
      'A break-in at a home happens at night, when the occupants are asleep ' +
      'and the first alarm is the sound of an intruder already inside. ' +
      'Response times make the first minutes the occupant\u2019s own.',
    prompt:
      'A photorealistic photograph of the front of a suburban South African ' +
      'house at night behind a wall, a security light above the door, a dark ' +
      `quiet street. ${NEGATIVES}`,
  },
];

function pickScenes(
  pool: readonly Scene[],
  defaults: readonly Scene[],
  answers: Record<string, string>,
  limit: number,
): Scene[] {
  const chosen: Scene[] = [];
  const seen = new Set<string>();
  const add = (s: Scene) => {
    if (chosen.length >= limit) return;
    if (seen.has(s.title)) return;
    seen.add(s.title);
    chosen.push(s);
  };
  for (const s of pool) if (s.when?.(answers)) add(s);
  for (const s of defaults) add(s);
  for (const s of pool) add(s);
  return chosen.slice(0, limit);
}

// ── sport ─────────────────────────────────────────────────────────────

/**
 * The three classes a sport pack can be about, off the APPLIED-FOR firearm.
 *
 * ⚠️ THE EXHIBITS MUST MATCH THE FIREARM, OR THE PAGE ARGUES THE WRONG SPORT.
 * The applied-for firearm is one class; the disciplines it is eligible for are
 * that class's, and no others. MO000096, 2026-10-15: a Glock 9 mm Parabellum
 * handgun was pictured with "Long-range precision", "Clay target shooting" and
 * "Target rifle and benchrest" — rifle and shotgun venues on a page lodged for
 * a pistol — because the picker's fallback filled from the whole list (see
 * pickActivities). Operator, 2026-10-15: "the images need to be specific to
 * the type of firearm ... disciplines a Glock 43X will be eligible for."
 */
export type WeaponClass = 'handgun' | 'rifle' | 'shotgun';

/**
 * The applied-for firearm's class, from its own answers.
 *
 * ⚠️ THE TYPE BOX LEADS AND THE CALIBRE ONLY BREAKS A TIE. `firearm_type` is
 * the form's own Handgun/Rifle/Shotgun word and is the reliable signal; a 9 mm
 * is usually a handgun but can be a carbine, so the calibre is read only where
 * the type says nothing. Null — an unrecognised type — never withholds plates:
 * pickActivities falls back to the whole catalogue rather than printing none.
 */
export function weaponClass(a: Record<string, string>): WeaponClass | null {
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

interface Activity {
  /**
   * ⚠️ WHICH FIREARM CLASSES MAY BE PICTURED WITH THIS ACTIVITY. Absent means
   * any class may (a club range is a club range). See weaponClass.
   */
  classes?: readonly WeaponClass[];
  when?: (a: Record<string, string>) => boolean;
  title: string;
  description: string;
  prompt: string;
}

const SPORT_ACTIVITIES: readonly Activity[] = [
  {
    classes: ['handgun'],
    when: (a) =>
      /handgun|pistol|self-loading|semi-auto|9mm|revolver/i.test(
        `${a.firearm_type ?? ''} ${a.firearm_calibre ?? ''} ${a.firearm_action ?? ''}`,
      ) ||
      /ipsc|idpa|practical|sadpa/i.test(
        `${a.association_name ?? ''} ${a.sport_formats ?? ''}`,
      ),
    title: 'Practical shooting (IPSC / IDPA)',
    description:
      'Practical handgun shooting is run as timed stages: barricades, fault ' +
      'lines, moving targets and steel, shot under a range officer and ' +
      'scored on both time and accuracy. A compact self-loading pistol in 9 ' +
      'mm Parabellum is eligible for these divisions, and the short barrel ' +
      'and light recoil suit the close, fast courses.',
    prompt:
      'A photorealistic photograph of an outdoor practical shooting range ' +
      'bay in South Africa, earthen safety berms and wooden barricades on a ' +
      `sand surface. ${DOWNRANGE} ${NEGATIVES}`,
  },
  {
    classes: ['handgun'],
    title: 'Steel challenge',
    description:
      'Steel challenge sets five falling-plate stages, shot from a stationary ' +
      'box at close ranges where draw, reload and split times decide the ' +
      'score. It is a first-tier discipline for a service-calibre handgun.',
    prompt:
      'A photorealistic photograph of a steel-target range in South Africa, ' +
      'painted steel plates on stands against an earth berm on a flat range, ' +
      'a shooting box marked on the ground in the foreground, bright ' +
      `daylight. ${DOWNRANGE} ${NEGATIVES}`,
  },
  {
    classes: ['handgun'],
    title: 'Indoor and club range practice',
    description:
      'Regular practice at a club or indoor handgun range — slow fire, ' +
      'draw-and-fire drills and reload practice at 10 to 25 metres — is the ' +
      'recurring activity a dedicated sports status is built around.',
    prompt:
      'A photorealistic photograph of an indoor handgun range in South ' +
      'Africa, numbered shooting lanes and a concrete floor under overhead ' +
      `lighting. ${DOWNRANGE} ${NEGATIVES}`,
  },
  {
    classes: ['rifle'],
    when: (a) =>
      /rifle/i.test(a.firearm_type ?? '') ||
      /precision|prs|long.range|bisley|target/i.test(
        `${a.sport_formats ?? ''} ${a.discipline ?? ''}`,
      ),
    title: 'Long-range precision',
    description:
      'Precision rifle matches are fired prone or from props at steel and ' +
      'paper from 300 to over 800 metres, where wind reading and a steady ' +
      'position decide the score.',
    prompt:
      'A photorealistic photograph of a long-range rifle range in South ' +
      'Africa, a mown firing point with shooting mats behind a low earth ' +
      'berm, a distant line of steel targets on a hillside, wind flags and a ' +
      `clear highveld sky. ${DOWNRANGE} ${NEGATIVES}`,
  },
  {
    classes: ['rifle'],
    when: (a) =>
      /benchrest|bench rest|f-class|fclass|prone|target/i.test(
        `${a.sport_formats ?? ''} ${a.discipline ?? ''}`,
      ),
    title: 'Target rifle and benchrest',
    description:
      'Benchrest and target rifle are shot from a fixed bench or a prone ' +
      'position at ranges of 100 to 500 metres, scored on group size and ' +
      'precision.',
    prompt:
      'A photorealistic photograph looking down a covered target-rifle ' +
      'firing point in South Africa: concrete benches under a roof in the ' +
      'foreground and a long, empty mown range stretching away, with target ' +
      `frames far down at the butts. ${DOWNRANGE} ${NEGATIVES}`,
  },
  {
    classes: ['rifle'],
    title: 'Veldskiet and gong shooting',
    description:
      'Veldskiet and gong matches are shot from field positions at steel and ' +
      'gongs at unknown distances, the practical rifle discipline most South ' +
      'African hunters and sport shooters shoot between seasons.',
    prompt:
      'A photorealistic photograph of a South African veld rifle range, ' +
      'steel gongs of graduated size on a distant slope, open grassland and ' +
      'scrub, a dirt firing line in the foreground, highveld sky. ' +
      `${DOWNRANGE} ${NEGATIVES}`,
  },
  {
    classes: ['shotgun'],
    when: (a) =>
      /shotgun/i.test(`${a.firearm_type ?? ''} ${a.discipline ?? ''}`) ||
      /clay|trap|skeet|sporting/i.test(
        `${a.sport_formats ?? ''} ${a.discipline ?? ''}`,
      ),
    title: 'Clay target shooting',
    description:
      'Trap, skeet and sporting clays are shot at clay targets thrown from ' +
      'fixed or oscillating traps, at five stations and over the distances ' +
      'the discipline sets.',
    prompt:
      'A photorealistic photograph of a clay target shooting layout in South ' +
      'Africa, a curved line of shooting stands on mown grass and a low trap ' +
      `house beyond them under an open sky. ${DOWNRANGE} ${NEGATIVES}`,
  },
  {
    classes: ['shotgun'],
    title: 'Practical shotgun',
    description:
      'Practical shotgun runs timed field courses with multiple targets, ' +
      'movement and reloads under a range officer, the shotgun counterpart of ' +
      'practical handgun shooting.',
    prompt:
      'A photorealistic photograph of a practical shotgun range in South ' +
      'Africa, wooden barricades on a sand surface and steel plates scattered ' +
      `across the bay against an earth berm. ${DOWNRANGE} ${NEGATIVES}`,
  },
  {
    title: 'Club-level competition',
    description:
      'A licensed firearm is used in monthly club competitions and practice ' +
      'sessions, the regular activity a dedicated or occasional status is ' +
      'built around.',
    prompt:
      'A photorealistic photograph of a South African shooting club range at ' +
      'midday, an open gravel firing line in the foreground, earth berms and ' +
      `target stands far down the range, open veld beyond. ${DOWNRANGE} ${NEGATIVES}`,
  },
];

function pickActivities(
  answers: Record<string, string>,
  limit: number,
): Activity[] {
  const cls = weaponClass(answers);
  /**
   * ⚠️ NEVER FALL BACK ACROSS CLASSES. The old fill loop drew from the WHOLE
   * catalogue, so a handgun pack was padded with rifle and shotgun venues the
   * moment it ran short of a handgun discipline. A class-limited pool is the
   * fix: a handgun sees only handgun activities (and the class-agnostic club
   * range), a rifle only rifle ones. An unrecognised type keeps the whole
   * catalogue — an unread type is not a reason to print no exhibits.
   */
  const pool = SPORT_ACTIVITIES.filter(
    (s) => !s.classes || cls === null || s.classes.includes(cls),
  );

  const chosen: Activity[] = [];
  const seen = new Set<string>();
  const add = (s: Activity) => {
    if (chosen.length >= limit) return;
    if (seen.has(s.title)) return;
    seen.add(s.title);
    chosen.push(s);
  };
  for (const s of pool) if (s.when?.(answers)) add(s);
  for (const s of pool) add(s);
  return chosen.slice(0, limit);
}

// ── assembly ──────────────────────────────────────────────────────────

function withSlots(
  specs: Omit<PlateSpec, 'pageIndex' | 'plateIndex'>[],
  cap: number = MAX_PLATES,
): PlateSpec[] {
  return specs.slice(0, cap).map((s, i) => ({
    ...s,
    pageIndex: Math.floor(i / PLATES_PER_PAGE) + 1,
    plateIndex: (i % PLATES_PER_PAGE) + 1,
  }));
}

/**
 * The plates a pack carries, in page order.
 *
 * ⚠️ FAIL-SOFT BY CONSTRUCTION. A hunting pack with no species the research
 * names returns an empty list and simply gets no exhibits — exactly the rule
 * the quarry plate already follows. Nothing here throws.
 */
export function buildPlateSpecs(ctx: PlateContext): PlateSpec[] {
  const purpose = purposeFor(ctx.licenceType, ctx.answers);
  if (purpose === null) return [];

  if (purpose === 'hunting') {
    // One animal to a picture, up to five (see MAX_HUNTING_PLATES).
    const species = quarriesFor({
      cartridgeText: ctx.research,
      gameClasses: ctx.answers.hunt_game_class,
    });
    return withSlots(species.map(speciesPlate), MAX_HUNTING_PLATES);
  }

  if (purpose === 'self_defence') {
    return withSlots(
      pickScenes(SELF_DEFENCE_SCENES, SELF_DEFENCE_DEFAULTS, ctx.answers, MAX_PLATES),
    );
  }

  return withSlots(pickActivities(ctx.answers, MAX_PLATES));
}
