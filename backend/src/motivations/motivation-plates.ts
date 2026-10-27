import { MotivationLicenceType } from '@prisma/client';
import { QUARRY, quarriesFor, type QuarrySpecies } from './motivation-quarry';
import { classifyCalibre } from './motivation-overlap';
import { resolveSportingPurpose, weaponClass } from './motivation-purpose';
import { coursesFor, type CourseSpec } from './motivation-courses';
import {
  SCENE_AVOID,
  SNAPSHOT_TREATMENT,
  SPECIES_AVOID,
  imageBrief,
} from './motivation-image-brief';

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
// or an act. The sport plates picture the COURSE OF FIRE — an empty range, no
// shooter — and the caption explains the course. See SCENE_AVOID and
// motivation-courses.ts.
// ────────────────────────────────────────────────────────────────────

/**
 * Bump when any wording below changes.
 *
 * ⚠️ A PLATE IS STORED FOREVER AND KEEPS ITS PROMPT VERSION, so a change to a
 * brief with no version bump leaves every existing plate looking like the old
 * wording with no way to tell which is which — the same trap
 * QUARRY_PROMPT_VERSION and researchAskVersion were written to close.
 */
export const PLATES_PROMPT_VERSION = '2026-10-27a';

/** Which of the purposes a pack's exhibits serve. */
export type PlatePurpose = 'hunting' | 'sport' | 'both' | 'self_defence';

/** Two plates to a page. */
export const PLATES_PER_PAGE = 2;

/**
 * The exhibit budget: FOUR PLATES ACROSS TWO FULL PAGES.
 *
 * ⚠️ TWO PICTURES TO A PAGE, ALWAYS TWO PAGES (2026-10-17). The operator asked
 * for "the two page images of either animals the cartridge fit to hunt with
 * descriptions or the shooting activities the firearm will be used for and if
 * applicable we can mix them if the firearm is capable of both". A hunting
 * pack therefore shows four quarry species over two pages, a sport pack four
 * courses of fire, and a firearm that does both shows two of each.
 */
export const MAX_PLATES = 4;
export const MAX_HUNTING_PLATES = 4;

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
  /**
   * The generated uses for the applied-for firearm, joined — the sentences
   * firearm-uses.service.ts writes per class and kind of shooter. The SPORT
   * exhibits mine these to choose the right courses (see coursesFor); absent
   * or thin, the firearm's class supplies the defaults.
   */
  usesText?: string;
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
    // ⚠️ ONE SECTION 16 ENTRY POINT, AND THE PACK DECIDES. A dedicated hunter
    // may shoot sport with the same rifle and the reverse, so the licence type
    // no longer picks the exhibits. See motivation-purpose.ts.
    case MotivationLicenceType.S16_DEDICATED_HUNTER:
    case MotivationLicenceType.S16_DEDICATED_SPORT:
    case MotivationLicenceType.S15_OCCASIONAL_HUNTER:
      return resolveSportingPurpose(answers);
    default:
      return null;
  }
}

/**
 * The shared close of every prompt.
 *
 * ⚠️ THE ORDER IS THE IMAGE MODEL'S OWN GUIDE, NOT OUR PREFERENCE. The old
 * tail led with "Amateur handheld phone snapshot" — a style instruction ahead
 * of the subject — then asked for motion blur, soft focus, crushed shadows and
 * a smudged lens. That is a picture the applicant's own record would not
 * contain, and it makes the animal or the course harder to identify. The
 * shared builder in motivation-image-brief.ts now holds the snapshot look,
 * the readable exposure and the safety exclusions in the order xAI documents:
 * subject, detail, art direction, light, colour, lens, treatment, exclusions.
 */

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

/** Start a species subject with a capital, since the table stores it lower-case. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function speciesPlate(
  species: QuarrySpecies,
): Omit<PlateSpec, 'pageIndex' | 'plateIndex'> {
  const habitat =
    species.setting ?? HABITAT[species.klass] ?? HABITAT.plains_medium;
  const range = RANGE[species.klass] ?? RANGE.plains_medium;
  const label = CLASS_LABEL[species.klass] ?? CLASS_LABEL.plains_medium;
  const why = CLASS_RATIONALE[species.klass] ?? CLASS_RATIONALE.plains_medium;
  return {
    title: species.name,
    description:
      `${species.name} is ${label}, ${range}. The cartridge applied for is ` +
      `matched to this class of game, and this is why: ${why}. It is pictured ` +
      `in ${habitat}, the setting a licence for this purpose is intended for.`,
    prompt: imageBrief({
      subject:
        `${capitalise(species.subject)}, standing broadside in ${habitat}, ` +
        'seen from eye level through a vehicle window',
      detail:
        'One animal, about a third of the frame wide, held inside the middle ' +
        'two-thirds of the frame with clear space around it; the body, the ' +
        'head and the eye are in focus, a few grass stems cross its lower ' +
        'legs, and the animal is seen from eye level through a vehicle window',
      art:
        'Pale dry grass, the edge of a vehicle window frame or a strand of ' +
        'fence wire at one edge, red-brown earth and a line of flat-topped ' +
        'thorn trees far behind',
      light:
        'Warm low sun from behind the camera and to the left, hard enough to ' +
        'rim the animal, with open shade holding detail on the near side, ' +
        'exposed so the whole animal reads clearly against the grass',
      colour:
        "The animal's own natural colour against pale gold grass, a " +
        'washed-out blue sky and red-brown earth',
      lens:
        "A phone's wide camera at eye level, the whole animal inside the " +
        'frame with a little room at nose and tail, and the background ' +
        'softly out of focus from distance rather than by a studio lens',
      treatment: SNAPSHOT_TREATMENT,
      avoid: SPECIES_AVOID,
    }),
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

/**
 * The applicant's home, as the exhibit picker needs it.
 *
 * ⚠️ `residence_type` IS THE FIELD THE WIZARD ACTUALLY ASKS. Every matcher below
 * read `premises_type`, which is not in the registry at all — so the condition
 * was never true on a real application, every self-defence pack fell through to
 * the urban defaults in catalogue order, and MO000100's townhouse complex led
 * its exhibits with "Communal access" and a page about an apartment block.
 *
 * `premises_type` is still read first so a draft saved before the field was
 * renamed keeps its answer.
 */
function premisesOf(answers: Record<string, string>): string {
  return `${answers.premises_type ?? ''} ${answers.residence_type ?? ''}`.trim();
}

const SELF_DEFENCE_SCENES: readonly Scene[] = [
  {
    when: (a) => /farm|smallholding|plot|rural|plaas/i.test(premisesOf(a)),
    title: 'A rural perimeter',
    description:
      'On a rural property the nearest police station is many minutes away, ' +
      'and a fence line stretches further than a single person can watch. A ' +
      'resident is on their own for the whole of that response time.',
    prompt: imageBrief({
      subject:
        'A closed galvanised steel farm gate and a long wire-and-post fence ' +
        'running away across dry veld on a rural property at dusk, with a ' +
        'white-plastered farmhouse far off and one floodlight over the gate',
      detail:
        'The gate sits a little left of centre inside the middle two-thirds ' +
        'of the frame, with the fence line leading the eye away to the ' +
        'right; weathered timber strainer posts, red-brown compacted gravel ' +
        'and dry highveld grass are in focus, and the house is small in the ' +
        'distance. The view is from beside a vehicle on the farm track, ' +
        'standing at eye level about five metres from the gate',
      art:
        'Red-brown gravel, a white farmhouse, a row of fence posts and a ' +
        'single steel gate; a jerrycan or a parked farm bakkie at the edge ' +
        'of the frame',
      light:
        'The last daylight comes from behind the camera, with the floodlight ' +
        'over the gate throwing one hard pool of light, exposed so the gate, ' +
        'fence and grass read clearly and the shadows keep detail instead of ' +
        'going black',
      colour:
        'Cool blue-grey dusk sky, warm cream plaster, galvanised grey steel, ' +
        'red-brown gravel and dry ochre grass',
      lens:
        "A phone's main camera at eye level from the track, the gate and " +
        'fence filling the frame, the farmhouse small and the background ' +
        'softly out of focus',
      treatment: SNAPSHOT_TREATMENT,
      avoid: SCENE_AVOID,
    }),
  },
  {
    when: (a) => /apartment|flat|communal|block/i.test(premisesOf(a)),
    title: 'Communal access',
    description:
      'A shared entrance and parking area is a door many people hold a key ' +
      'to, and a dim passage between a vehicle and a front door is where a ' +
      'resident is most exposed.',
    prompt: imageBrief({
      subject:
        'A low-rise brick apartment block at night, with a communal palisade ' +
        'gate, a paved walkway and a solid timber front door under a ' +
        'security light',
      detail:
        'The gate and walkway sit inside the middle two-thirds of the frame, ' +
        'with numbered parking bays and a corrugated-steel carport to the ' +
        'left and a wheelie bin at the right edge; face-brick columns and ' +
        'damp paving are in focus. The view is from the car park, standing ' +
        'at eye level about 15 metres from the gate',
      art:
        'Face-brick red, charcoal palisade steel, damp grey paving, a parked ' +
        'car and a wheelie bin; a downpipe runs down the wall',
      light:
        'A single hard white security light above the door, with the sky ' +
        'still holding a little blue, exposed so the gate, walkway and door ' +
        'read clearly and the shadows keep their shape',
      colour:
        'Warm face-brick red, cool grey paving, charcoal steel and a deep ' +
        'blue night sky',
      lens:
        'A phone camera held at eye level, the gate and door filling the ' +
        'middle of the frame, the carport clipped at one edge, the ' +
        'background softly out of focus',
      treatment: SNAPSHOT_TREATMENT,
      avoid: SCENE_AVOID,
    }),
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
    prompt: imageBrief({
      subject:
        'A busy urban intersection in late afternoon, with several lanes of ' +
        'stained tar, a red traffic signal, plastered shopfronts with roller ' +
        'shutters and a minibus taxi waiting at the light',
      detail:
        'The traffic signal and the lanes ahead sit inside the middle ' +
        'two-thirds of the frame, with the corner of a dashboard and the ' +
        'window pillar intruding at the bottom and right; road repairs, ' +
        'faded lane paint and the stopped taxi are in focus. The view is ' +
        'from the driver’s seat through the windscreen, at eye level about ' +
        'two car lengths back from the light',
      art:
        'Grey tar, a red signal, cream and faded green shopfronts, a yellow ' +
        'minibus taxi; a plastic packet and a patch of weeds at the kerb',
      light:
        'Low sun ahead and to the left, flaring a little across the ' +
        'windscreen, exposed so the signal, shopfronts and lane markings ' +
        'read clearly',
      colour:
        'Warm late-afternoon sun, grey tar, a red signal and faded cream and ' +
        'green shopfronts',
      lens:
        'A phone camera held at eye level behind the windscreen, the ' +
        'intersection filling the frame, the dashboard corner intruding, ' +
        'the background softly out of focus',
      treatment: SNAPSHOT_TREATMENT,
      avoid: SCENE_AVOID,
    }),
  },
  {
    when: (a) =>
      /gate|driveway|house|home|suburb|wall|townhouse|complex|cottage/i.test(
        premisesOf(a),
      ),
    title: 'The driveway gate',
    description:
      'A vehicle stopped at an automated gate is stationary and boxed in, ' +
      'waiting for a gate to open or close — the moment at home when a ' +
      'resident is least able to move.',
    prompt: imageBrief({
      subject:
        'A closed charcoal powder-coated sliding steel driveway gate in a ' +
        'cream plastered boundary wall at dusk, with brick paving in front ' +
        'and a suburban roof beyond',
      detail:
        'The gate fills the middle two-thirds of the frame, slightly left of ' +
        'centre, with the top of the boundary wall and a gatepost clipped at ' +
        'the edges; the slats, electric-fence brackets and brick paving are ' +
        'in focus. The view is from the driver’s seat of a car stopped in ' +
        'the driveway, at eye level about three metres back, with the wing ' +
        'mirror intruding at the lower right',
      art:
        'Charcoal slats, cream plaster, red-brown brick paving, a wheelie ' +
        'bin and a garden hose; two security lights above the wall',
      light:
        'Cool dusk sky behind the camera with two warm security lights above ' +
        'the gate, exposed so the gate, wall and paving read clearly and the ' +
        'shadows hold detail',
      colour:
        'Charcoal grey, warm cream, red-brown brick and a blue-grey dusk sky',
      lens:
        "A phone's main camera at eye level from the driver’s seat, the gate " +
        'filling the frame, the wing mirror intruding, the background softly ' +
        'out of focus',
      treatment: SNAPSHOT_TREATMENT,
      avoid: SCENE_AVOID,
    }),
  },
];

/**
 * The two fallback scenes that are not in the matched pool.
 *
 * ⚠️ SEPARATE SO THE DEFAULTS CAN BE CHOSEN BY PREMISES. See
 * `selfDefenceDefaults`.
 */
const UNLIT_REGIONAL_ROAD: Scene = {
  title: 'An unlit regional road',
  description:
    'Regional routes between towns run through open veld with no lighting ' +
    'and long gaps between police stations. A breakdown or a forced stop ' +
    'there leaves a motorist entirely without help.',
  prompt: imageBrief({
    subject:
      'A straight two-lane tar road running toward distant flat-topped hills ' +
      'at last light, through open karoo scrub with no street lighting',
    detail:
      'The road runs from the bottom of the frame into the middle two-thirds, ' +
      'slightly right of centre, with a reflector post clipped at the left ' +
      'edge; weathered asphalt, faded paint and a graded red-gravel verge ' +
      'are in focus. The view is from the road shoulder, standing at eye ' +
      'level about a metre above the tar',
    art:
      'Grey asphalt, faded white paint, red gravel, low karoo scrub and a ' +
      'single reflector post; a drift of sand across the verge',
    light:
      'The last warm light comes from low behind the camera and to the ' +
      'right, with the sky still bright, exposed so the road surface, verge ' +
      'and reflector post read clearly and the foreground holds detail',
    colour:
      'Warm ochre light, grey tar, red-brown gravel, olive scrub and a pale ' +
      'sky',
    lens:
      'A phone camera at eye level, the road leading to the hills, the ' +
      'foreground sharp and the hills softly hazed',
    treatment: SNAPSHOT_TREATMENT,
    avoid: SCENE_AVOID,
  }),
};

const HOME_AT_NIGHT: Scene = {
  title: 'A home at night',
  description:
    'A break-in at a home happens at night, when the occupants are asleep ' +
    'and the first alarm is the sound of an intruder already inside. ' +
    'Response times make the first minutes the occupant\u2019s own.',
  prompt: imageBrief({
    subject:
      'A suburban house at night behind a cream plastered boundary wall and ' +
      'a steel pedestrian gate, with lit windows and a bright floodlight ' +
      'over the garage',
    detail:
      'The wall, gate and lit windows fill the middle two-thirds of the ' +
      'frame, slightly crooked, with the roof or a gatepost cut off at an ' +
      'edge; the burglar bars, gate and garden are in focus. The view is ' +
      'from the pavement, standing at eye level about four metres from the ' +
      'gate',
    art:
      'Cream plaster, charcoal burglar bars, a steel gate, a garden bin and ' +
      'a coiled hose; a bright floodlight above the garage',
    light:
      'A bright floodlight over the garage and warm light from the windows, ' +
      'with the sky deep blue, exposed so the wall, gate and window frames ' +
      'read clearly and the shadows hold their shape',
    colour:
      'Warm cream plaster, charcoal steel, green garden and a deep blue ' +
      'night sky',
    lens:
      'A phone camera at eye level from the pavement, the house filling the ' +
      'frame, the roof clipped, the background dark but readable',
    treatment: SNAPSHOT_TREATMENT,
    avoid: SCENE_AVOID,
  }),
};

/**
 * The generic fallbacks, used for any slot the applicant's answers did not
 * fill. Always enough to reach two pages, because a self-defence pack always
 * has a purpose section.
 */
const SELF_DEFENCE_RURAL_DEFAULTS: readonly Scene[] = [
  UNLIT_REGIONAL_ROAD,
  SELF_DEFENCE_SCENES[0],
  SELF_DEFENCE_SCENES[3],
  HOME_AT_NIGHT,
];

/**
 * ⚠️ AN URBAN APPLICANT DOES NOT GET RURAL EXHIBITS. MO000100 lived in a
 * townhouse complex in Durbanville but its plate pages argued "An unlit
 * regional road" and "A rural perimeter" — the defaults were drawn whatever
 * the premises. Keep the rural pair for rural premises; fill an urban pack
 * from the communal, commute and driveway scenes plus the home at night.
 */
const SELF_DEFENCE_URBAN_DEFAULTS: readonly Scene[] = [
  SELF_DEFENCE_SCENES[1],
  SELF_DEFENCE_SCENES[2],
  SELF_DEFENCE_SCENES[3],
  HOME_AT_NIGHT,
];

function selfDefenceDefaults(
  answers: Record<string, string>,
): readonly Scene[] {
  const rural = /farm|smallholding|plot|rural|plaas/i.test(premisesOf(answers));
  return rural ? SELF_DEFENCE_RURAL_DEFAULTS : SELF_DEFENCE_URBAN_DEFAULTS;
}

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
 * The applied-for firearm's class. Moved to motivation-purpose.ts with the
 * route resolver so the two decisions share one classifier; re-exported here
 * because the exhibit pickers and their specs import it from this module.
 */
export { weaponClass };

/**
 * A course of fire as the exhibit picker draws it.
 *
 * ⚠️ THE SPORT PLATES COME FROM THE COURSE LIBRARY, NOT A VENUE CATALOGUE. See
 * motivation-courses.ts: each is the actual course the discipline's rules lay
 * out — targets, distances, positions, props — pictured empty, with a caption
 * that explains the course. The old fixed nine-activity list drew a generic
 * venue that matched no discipline in particular.
 */
function coursePlate(
  c: CourseSpec,
): Omit<PlateSpec, 'pageIndex' | 'plateIndex'> {
  return { title: c.title, description: c.description, prompt: c.prompt };
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

/** The courses of fire a sport pack pictures, at most `limit`. */
function sportSpecs(ctx: PlateContext, limit: number) {
  if (limit <= 0) return [];
  return coursesFor({
    weaponClass: weaponClass(ctx.answers),
    action: ctx.answers.firearm_action,
    // The generated uses name the disciplines, and the firearm's own words
    // (a revolver, say) break the ties the class cannot — see coursesFor.
    usesText: [
      ctx.usesText,
      ctx.answers.firearm_type,
      ctx.answers.firearm_calibre,
      ctx.answers.firearm_action,
    ]
      .filter(Boolean)
      .join(' '),
    limit,
  }).map(coursePlate);
}

/**
 * The quarry species a hunting pack pictures, at most `limit`.
 *
 * ⚠️ IT NEVER COMES UP SHORT WHILE THE CALIBRE IS KNOWN. The research block
 * names the species a round is suited to, but it is cached prose and may name
 * two or three. The reserve fills from the same class of game for that
 * cartridge (the curated table in motivation-overlap), so a two-page exhibit
 * is two pages rather than one page and an empty sheet.
 */
function huntingSpecs(
  ctx: PlateContext,
  limit: number,
  exclude: ReadonlySet<string> = new Set(),
): Omit<PlateSpec, 'pageIndex' | 'plateIndex'>[] {
  if (limit <= 0) return [];
  const named = quarriesFor({
    cartridgeText: ctx.research,
    gameClasses: ctx.answers.hunt_game_class,
  }).filter((q) => !exclude.has(q.key));

  // ⚠️ NO FIREARM AND NO RESEARCH IS NOT A GUESSING OPPORTUNITY. The reserve
  // exists to finish a page for a firearm we can classify; with neither a class
  // nor a single named species there is nothing honest to draw.
  const known =
    !!classifyCalibre(ctx.answers.firearm_calibre ?? '') ||
    !!weaponClass(ctx.answers);
  if (!named.length && !known) return [];

  const out: QuarrySpecies[] = [...named];
  const taken = new Set([...exclude, ...out.map((q) => q.key)]);
  const wanted = new Set(
    (ctx.answers.hunt_game_class ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );
  const klass = classifyCalibre(ctx.answers.firearm_calibre ?? '');
  const klassKey =
    klass === 'shotgun'
      ? 'wingshooting'
      : klass === 'dangerous_game'
        ? 'dangerous'
        : klass === 'rimfire'
          ? 'small'
          : klass === 'varmint' ||
              klass === 'medium_game' ||
              klass === 'large_game'
            ? 'plains_medium'
            : klass === 'handgun'
              ? null
              : null;

  const add = (sameClassOnly: boolean) => {
    for (const q of QUARRY) {
      if (out.length >= limit) return;
      if (taken.has(q.key)) continue;
      if (wanted.size && !wanted.has(q.klass)) continue;
      if (sameClassOnly && klassKey && q.klass !== klassKey) continue;
      taken.add(q.key);
      out.push(q);
    }
  };
  add(true);
  add(false);

  return out.slice(0, limit).map(speciesPlate);
}

/**
 * The plates a pack carries, in page order.
 *
 * ⚠️ TWO PAGES, ALWAYS. Four plates at two to a page; a hunting pack shows
 * four species, a sport pack four courses of fire, and a firearm that lawfully
 * does both shows two of each. See MAX_PLATES.
 *
 * ⚠️ FAIL-SOFT BY CONSTRUCTION. A pack whose pool is empty gets no exhibits
 * rather than an invented one. Nothing here throws.
 */
export function buildPlateSpecs(ctx: PlateContext): PlateSpec[] {
  const purpose = purposeFor(ctx.licenceType, ctx.answers);
  if (purpose === null) return [];

  // ⚠️ NOTHING IS DRAWN FOR A FIREARM NOBODY HAS DESCRIBED. The route resolver
  // can say "both" from an empty pack, but a picture of a species or a course
  // for an unnamed firearm is a guess about what the applicant is applying for.
  const noFirearm =
    !weaponClass(ctx.answers) &&
    !classifyCalibre(ctx.answers.firearm_calibre ?? '');
  if (purpose !== 'self_defence' && noFirearm) return [];

  if (purpose === 'self_defence') {
    return withSlots(
      pickScenes(
        SELF_DEFENCE_SCENES,
        selfDefenceDefaults(ctx.answers),
        ctx.answers,
        MAX_PLATES,
      ),
    );
  }

  if (purpose === 'hunting') {
    return withSlots(huntingSpecs(ctx, MAX_PLATES));
  }

  if (purpose === 'sport') {
    return withSlots(sportSpecs(ctx, MAX_PLATES));
  }

  // Both: two of each when both pools can fill their half, and the remainder
  // topped up from whichever pool still has material. A bolt-action .308 with
  // a hunting battery behind it is the case this exists for: page one is the
  // quarry, page two is the discipline.
  const hunt = huntingSpecs(ctx, Math.min(2, MAX_PLATES));
  const sport = sportSpecs(ctx, MAX_PLATES - hunt.length);
  const mixed = [...hunt, ...sport].slice(0, MAX_PLATES);
  if (mixed.length < MAX_PLATES) {
    const used = new Set(mixed.map((p) => p.title).filter(Boolean));
    // Top up from quarry first, then sport, without repeating a plate title.
    const huntingTitles = new Set(hunt.map((p) => p.title));
    const extraHunt = huntingSpecs(
      ctx,
      MAX_PLATES - mixed.length + hunt.length,
      new Set(),
    ).filter((p) => !huntingTitles.has(p.title));
    for (const p of extraHunt) {
      if (mixed.length >= MAX_PLATES) break;
      if (used.has(p.title)) continue;
      used.add(p.title);
      mixed.push(p);
    }
    const sportTitles = new Set(sport.map((p) => p.title));
    for (const p of sportSpecs(ctx, MAX_PLATES)) {
      if (mixed.length >= MAX_PLATES) break;
      if (used.has(p.title) || sportTitles.has(p.title)) continue;
      used.add(p.title);
      mixed.push(p);
    }
  }
  return withSlots(mixed.slice(0, MAX_PLATES));
}
