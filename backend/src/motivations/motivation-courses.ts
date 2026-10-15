import type { WeaponClass } from './motivation-plates';

// ────────────────────────────────────────────────────────────────────
// THE SPORT EXHIBITS: THE COURSE OF FIRE, AND NOTHING ELSE.
//
// Operator, 2026-10-15: "the current prompts does not look good. We need to
// research what the layout rules are for each course and let it generate the
// picture according to that. Also take out any humans and action. we just need
// to show the course of fire and explain it."
//
// ⚠️ SO EACH PICTURE IS AN EMPTY COURSE, AND THE CAPTION EXPLAINS IT. The old
// sport plates drew a generic venue ("an outdoor practical shooting range bay")
// that matched no discipline in particular. These are the actual courses the
// common South African sport shooter shoots, each with the layout that
// discipline's rules set out — the targets, the distances, the positions and
// the props — so the picture and the words agree with the discipline the
// document argues.
//
// ⚠️ NO PEOPLE, NO ACTION, AND THAT IS A RULE, NOT A STYLE. An empty range
// between strings makes no claim about the applicant and cannot be read as
// "this is him shooting". The words carry the activity; the picture carries the
// place. See EMPTY below — it is the tail of every prompt.
//
// ⚠️ THE LAYOUT IS CODE-OWNED AND GROUNDED. Nothing here is asked of a model:
// the courses are curated from the same governing-body rules the discipline
// registry cites (shooting-disciplines.ts — IPSC/SAPSA, SADPA, SCSA, CHASA, SA
// Hunters, NARFO, the clay bodies), and the caption states only what the course
// is, never a figure the research did not supply.
// ────────────────────────────────────────────────────────────────────

/**
 * The tail of every prompt.
 *
 * ⚠️ TAKEN OUT OF THE PICTURE, EVERY TIME. The operator's word was "take out
 * any humans and action", and a course picture is at its most useful when the
 * range is empty — a documentary photograph of the place the shooting happens,
 * not of somebody doing it.
 */
const EMPTY = [
  'Photorealistic documentary photograph, natural South African daylight, sharp',
  'focus, long lens, no people, no shooter, no hands, no firearms, no muzzle,',
  'no muzzle flash, no motion or action, no vehicles, no text, no lettering, no',
  'watermark, no logo, no overlay, no borders, no markings of any kind.',
].join(' ');

export interface CourseSpec {
  /** Stable key. Never changes once a plate can be stored under it. */
  key: string;
  /** The caption headline. */
  title: string;
  /** Which firearm classes this course may be pictured for. */
  classes: readonly WeaponClass[];
  /**
   * For rifles only: whether the course is shot with a self-loading or a
   * manual-action rifle. Left off the other classes.
   */
  action?: 'semi' | 'manual';
  /** Lowercased keywords to detect this course in the generated uses. */
  match: readonly string[];
  /**
   * Fallback ordering. Lower comes first when nothing in the uses matched.
   * Left off the common courses (rank 0); set higher on the niche ones so a
   * default pack shows SA Hunters / Fullbore / F-Class / PRS ahead of Lever and
   * Cowboy.
   */
  rank?: number;
  /** Explains the course of fire and ties it to this firearm. */
  description: string;
  /** The empty-course image prompt. */
  prompt: string;
}

const COURSES: readonly CourseSpec[] = [
  // ── handgun ──────────────────────────────────────────────────────────
  {
    key: 'ipsc-handgun',
    title: 'IPSC Practical Pistol',
    classes: ['handgun'],
    match: ['ipsc', 'practical pistol', 'practical shooting', 'sapsa'],
    description:
      'Practical shooting is run as a timed course of fire inside a bay: the ' +
      'shooter moves between shooting positions and engages cardboard targets ' +
      'and steel from behind barricades and around props, scored on both time ' +
      'and accuracy under a range officer. A service-calibre self-loading ' +
      'handgun is the firearm the divisions are built around, and its short ' +
      'barrel and light recoil suit the close, fast stages.',
    prompt:
      'An empty outdoor practical shooting bay on a South African range: ' +
      'earthen side and back berms enclosing a sand bay, wooden barricades and ' +
      'low walls, white-painted fault lines marking a course of fire on the ' +
      'ground, and a mix of brown cardboard targets on stakes with a few steel ' +
      'plates downrange against the berm. ' +
      EMPTY,
  },
  {
    key: 'sadpa-idpa',
    title: 'Defensive Pistol (SADPA / IDPA)',
    classes: ['handgun'],
    match: ['sadpa', 'idpa', 'defensive pistol', 'concealed'],
    description:
      'Defensive pistol courses are shot from cover and, unless stated ' +
      'otherwise, from concealment: the shooter uses barricades and simulated ' +
      'cover, engages cardboard targets including no-shoot figures, and is ' +
      'scored on time with penalties for hits outside the scoring zones. A ' +
      'compact self-loading handgun carried as for everyday use is eligible, ' +
      'which is why its size and handling matter.',
    prompt:
      'An empty defensive-pistol stage on a South African range: dark plywood ' +
      'barricades and simulated cover along a dirt bay, a white line marking ' +
      'the edge of cover on the ground, and cardboard targets on stakes ' +
      'downrange, one a no-shoot figure with raised hands, against a dirt ' +
      'berm. ' +
      EMPTY,
  },
  {
    key: 'steel-challenge',
    title: 'Steel Challenge',
    classes: ['handgun'],
    match: ['steel challenge', 'stop plate'],
    description:
      'Steel Challenge is a fixed-stage speed discipline: five painted steel ' +
      'plates are set in an arc in front of a berm, one of them a red stop ' +
      'plate, and the shooter engages them from a marked shooting box, scored ' +
      'purely on elapsed time. A service-calibre handgun is the class the ' +
      'centrefire divisions are built around.',
    prompt:
      'An empty steel-target range in South Africa: five painted steel plates ' +
      'on stands set in a wide arc in front of a tall dirt berm, one a bright ' +
      'red rectangular stop plate, with a white-painted shooting box marked on ' +
      'bare dirt in the foreground. ' +
      EMPTY,
  },
  {
    key: 'icore',
    title: 'ICORE (revolver)',
    classes: ['handgun'],
    match: ['icore', 'revolver', 'wheelgun'],
    description:
      'ICORE is a revolver discipline: six- or eight-shot wheelguns are shot ' +
      'on timed stages against paper and steel, with reloads from speed ' +
      'loaders or moon clips deciding much of the score. A revolver in a ' +
      'service calibre is the firearm the divisions are built around.',
    prompt:
      'An empty revolver stage on a South African range: a dirt bay with ' +
      'wooden barricades and a low wall, cardboard targets on stakes and a few ' +
      'steel plates downrange against an earth berm, white fault lines painted ' +
      'on the ground. ' +
      EMPTY,
  },
  {
    key: 'natshoot-handgun',
    title: 'Natshoot / SA Jagters 20 m handgun',
    classes: ['handgun'],
    match: ['natshoot', 'postal', '20 m', '20m'],
    description:
      'The Natshoot (SA Hunters) handgun exercises are static target shoots: ' +
      'rimfire and centrefire handguns are shot from a 20 m firing line at ' +
      'paper targets, testing basic marksmanship. It is the discipline a ' +
      'dedicated handgun owner shoots at branch level and by post.',
    prompt:
      'An empty 20 m handgun firing line on a South African range: a covered ' +
      'concrete firing point with numbered lanes and low dividers, and a row ' +
      'of paper target frames standing at the 20 m line beyond, open veld ' +
      'behind. ' +
      EMPTY,
  },

  // ── self-loading rifle / carbine ─────────────────────────────────────
  {
    key: 'ipsc-rifle',
    title: 'IPSC Practical Rifle',
    classes: ['rifle'],
    action: 'semi',
    match: ['ipsc', 'practical rifle', 'self-loading', 'semi-auto'],
    description:
      'Practical rifle is a dynamic course of fire: the shooter moves through ' +
      'a bay between positions and props, engaging cardboard and steel targets ' +
      'at different distances, scored on time and accuracy. A self-loading ' +
      'rifle is the class the semi-auto divisions are built around.',
    prompt:
      'An empty practical rifle bay on a South African range: earthen berms ' +
      'enclosing a wide bay, timber barricades and low walls with white fault ' +
      'lines forming a course of fire, cardboard targets on stakes and steel ' +
      'plates set out across the bay at varied distances against the berm. ' +
      EMPTY,
  },
  {
    key: 'three-gun',
    title: '3-Gun / 3GN (rifle stage)',
    classes: ['rifle'],
    action: 'semi',
    match: ['3-gun', '3gn', 'multi-gun', 'multi gun'],
    description:
      'Multi-gun stages combine a self-loading rifle with a handgun and a ' +
      'shotgun in one course of fire; the rifle stage runs long-range steel ' +
      'and paper targets with movement between positions. A self-loading ' +
      'rifle is one of the three firearms the format is built on.',
    prompt:
      'An empty multi-gun rifle stage on a South African range: a wide bay of ' +
      'earth berms with timber barricades, platforms and props, steel plates ' +
      'and cardboard targets set out at long, varied distances downrange, ' +
      'white fault lines on the ground. ' +
      EMPTY,
  },
  {
    key: 'tps',
    title: 'Tactical Precision Shooting (TPS)',
    classes: ['rifle'],
    action: 'semi',
    match: ['tactical', 'tps', '2-gun'],
    description:
      'Tactical precision matches are run on dedicated rifle ranges as ' +
      'two-gun or rifle-only courses, combining engagement of distant steel ' +
      'from supported positions with movement between barricades and props. A ' +
      'self-loading rifle is the firearm the format is built around.',
    prompt:
      'An empty tactical rifle range in South Africa: a dirt and gravel bay ' +
      'with timber barricades, a low wall and a shooting platform, steel ' +
      'plates and cardboard targets standing at several distances against an ' +
      'earth backdrop. ' +
      EMPTY,
  },
  {
    key: 'sadpa-long-gun',
    title: 'SADPA Multi-Platform / Long Gun',
    classes: ['rifle'],
    action: 'semi',
    match: ['sadpa', 'carbine', 'long gun'],
    description:
      'SADPA long-gun and multi-platform courses are shot from cover with a ' +
      'defensive carbine: the shooter engages cardboard and steel from behind ' +
      'barricades and simulated cover, scored on time. A self-loading rifle ' +
      'or carbine is the firearm the stages are built around.',
    prompt:
      'An empty defensive carbine stage on a South African range: plywood ' +
      'barricades and simulated cover in a dirt bay, white fault lines on the ' +
      'ground, and cardboard targets with a few steel plates downrange against ' +
      'an earth berm. ' +
      EMPTY,
  },

  // ── manual-loading rifle ─────────────────────────────────────────────
  {
    key: 'sa-hunters-bolt',
    title: 'SA Hunters bolt-action exercises',
    classes: ['rifle'],
    action: 'manual',
    match: ['hunters', 'bolt', '100 m', '200 m', '300 m', 'standing', 'sitting'],
    description:
      'The SA Hunters (SA Jagters) hunting-rifle exercises are shot from the ' +
      'field positions the body sets out — standing, sitting off sticks and ' +
      'prone off a bipod — at fixed distances against realistic animal ' +
      'targets. A bolt-action hunting rifle is the firearm the exercises are ' +
      'built around.',
    prompt:
      'An empty hunting-rifle range in South Africa: a mown firing point with ' +
      'wooden shooting sticks and a single shooting mat, looking out over open ' +
      'veld to a line of flat animal-silhouette targets standing at staged ' +
      'distances on an earth bank. ' +
      EMPTY,
  },
  {
    key: 'fullbore',
    title: 'Fullbore / Precision Long-Range',
    classes: ['rifle'],
    action: 'manual',
    match: ['fullbore', 'full-bore', 'long-range', 'long range', 'target rifle'],
    description:
      'Fullbore and precision long-range shooting is prone at long, fixed ' +
      'distances: the shooter lies on a mat behind a sling-supported or ' +
      'bipod-supported rifle and fires at target frames at the butts, wind ' +
      'flags reading the range. A bolt-action target or precision rifle is the ' +
      'firearm the discipline is built around.',
    prompt:
      'An empty fullbore rifle range in South Africa: a mown firing point with ' +
      'shooting mats and a spotting scope on a tripod looking down a long open ' +
      'range, wind flags on poles along the way, and target frames standing ' +
      'far down at the stop butt. ' +
      EMPTY,
  },
  {
    key: 'lever-action',
    title: 'Lever-Action Rifle',
    classes: ['rifle'],
    action: 'manual',
    match: ['lever'],
    rank: 10,
    description:
      'Lever-action events are timed and precision exercises for lever-action ' +
      'rifles in rimfire and centrefire, shot from standing and supported ' +
      'positions at paper and steel. A lever-action rifle is the firearm the ' +
      'events are built around.',
    prompt:
      'An empty lever-action range in South Africa: a simple dirt firing line ' +
      'with a low rail and timber posts, steel plates and paper targets on ' +
      'stands downrange against an earth bank, open veld beyond. ' +
      EMPTY,
  },
  {
    key: 'cowboy',
    title: 'Cowboy Action Shooting',
    classes: ['rifle'],
    action: 'manual',
    match: ['cowboy'],
    rank: 11,
    description:
      'Cowboy action stages are themed courses of fire using lever-action ' +
      'rifles and single-action revolvers against steel targets across a set ' +
      'dressed with western props, scored on time. A lever-action or ' +
      'single-shot rifle fits the format.',
    prompt:
      'An empty western-set stage on a South African range: a dirt course of ' +
      'fire framed by a rough timber facade, barrels and props, with steel ' +
      'plates standing downrange against an earth bank and the course marked ' +
      'on the ground. ' +
      EMPTY,
  },
  {
    key: 'f-class',
    title: 'F-Class',
    classes: ['rifle'],
    action: 'manual',
    match: ['f-class', 'fclass', 'f-open', 'f-tr'],
    description:
      'F-Class is prone long-range shooting from a rest or bipod at fixed ' +
      'distances, scored on group and score at the target frames. F-Open and ' +
      'F-TR differ in the rest and the rifle weight, and both are shot with a ' +
      'scoped bolt-action rifle.',
    prompt:
      'An empty F-Class firing point in South Africa: a mown range with prone ' +
      'mats, front rests and rear bags set out in a row, a spotting scope on a ' +
      'tripod, and target frames with wind flags far downrange at the butts ' +
      'under a wide sky. ' +
      EMPTY,
  },
  {
    key: 'prs',
    title: 'Precision Rifle Series (PRS)',
    classes: ['rifle'],
    action: 'manual',
    match: ['prs', 'precision rifle', 'barricade', 'props'],
    description:
      'PRS-style matches are shot from improvised positions — barricades, ' +
      'props, tank traps and rooftops — against steel at unknown, varied ' +
      'distances, with a bolt-action precision rifle in a chassis. The course ' +
      'of fire changes stage by stage and rewards a steady position and wind ' +
      'reading.',
    prompt:
      'An empty precision-rifle course in South Africa: a wide field range ' +
      'with a wooden barricade, a platform, tank-trap props and a low wall set ' +
      'out along the firing area, and steel plates standing at several unknown ' +
      'distances across open ground against a hillside. ' +
      EMPTY,
  },

  // ── shotgun ──────────────────────────────────────────────────────────
  {
    key: 'clay',
    title: 'Clay Pigeon / Trap / Skeet',
    classes: ['shotgun'],
    match: ['trap', 'skeet', 'clay', 'sporting'],
    description:
      'The clay disciplines are shot at clay targets thrown from trap houses: ' +
      'trap fires from a single house across five stations, skeet crosses ' +
      'between a high and a low house, and sporting clays presents targets ' +
      'from stands set around a course. A shotgun — over-and-under or ' +
      'side-by-side — is the firearm every one of them is built around.',
    prompt:
      'An empty clay-target layout in South Africa: a curved line of shooting ' +
      'stands on mown grass, a low trap house set into the ground ahead, and ' +
      'concrete skeet houses to the sides, with open sky and trees beyond. ' +
      EMPTY,
  },
  {
    key: 'ipsc-shotgun',
    title: 'IPSC Practical Shotgun',
    classes: ['shotgun'],
    match: ['ipsc', 'practical shotgun', 'popper', 'shell'],
    description:
      'Practical shotgun runs as a timed course of fire: the shooter moves ' +
      'through a bay engaging steel poppers, plates and cardboard targets and ' +
      'reloading on the move, scored on time and accuracy. A shotgun of 20 ' +
      'gauge or larger is the firearm the divisions are built around.',
    prompt:
      'An empty practical shotgun bay on a South African range: earthen berms ' +
      'enclosing a sand bay with timber barricades and low walls, white fault ' +
      'lines on the ground, and steel poppers and plates standing at varied ' +
      'distances against the berm. ' +
      EMPTY,
  },
  {
    key: 'multi-gun-shotgun',
    title: 'Multi-Gun / 3-/4-Gun (shotgun stage)',
    classes: ['shotgun'],
    match: ['multi-gun', 'multi gun', '3-gun', '4-gun'],
    description:
      'In multi-gun a shotgun is one of two to four firearms shot inside a ' +
      'single course of fire; the shotgun stage runs close steel, plates and ' +
      'clay targets with movement and reloading between positions. A shotgun ' +
      'is the firearm the stage is built around.',
    prompt:
      'An empty multi-gun shotgun stage on a South African range: a bay of ' +
      'earth berms with timber barricades and props, steel poppers and plates ' +
      'and a clay-throwing area downrange, white fault lines marking the ' +
      'course on the ground. ' +
      EMPTY,
  },
];

/**
 * The courses to picture, best match first, capped.
 *
 * ⚠️ THE GENERATED USES CHOOSE WHERE THEY CAN, THE CLASS DECIDES WHERE THEY
 * CANNOT. The applied-for firearm's uses (firearm-uses.service.ts) name the
 * disciplines it is genuinely shot in; a course whose keywords appear there is
 * drawn first. Where nothing matches — a thin or missing uses list — the
 * firearm's own class (and, for a rifle, its action) supplies the default
 * courses, so a pack is never left with no exhibits.
 *
 * ⚠️ NEVER CROSS-CLASS. A handgun pack shows handgun courses; a manual rifle
 * shows manual-rifle courses. The class filter runs before anything else.
 * An unrecognised class keeps every course rather than none.
 */
export function coursesFor(args: {
  weaponClass: WeaponClass | null;
  /** The applied-for firearm's action, raw. */
  action?: string;
  /** The generated uses for this firearm, joined. */
  usesText?: string;
  limit: number;
}): CourseSpec[] {
  const cls = args.weaponClass;
  const action = (args.action ?? '').toLowerCase();
  const semi = /semi|self[-\s]?load|autoload/.test(action)
    ? true
    : /bolt|lever|single|manual|pump/.test(action)
      ? false
      : null;
  const text = (args.usesText ?? '').toLowerCase();

  const allowed = COURSES.filter((c) => {
    if (cls && !c.classes.includes(cls)) return false;
    if (cls === 'rifle' && c.action) {
      if (semi === true) return c.action === 'semi';
      if (semi === false) return c.action === 'manual';
    }
    return true;
  });
  if (!allowed.length) return [];

  const chosen: CourseSpec[] = [];
  const seen = new Set<string>();
  const add = (c: CourseSpec) => {
    if (chosen.length >= args.limit) return;
    if (seen.has(c.key)) return;
    seen.add(c.key);
    chosen.push(c);
  };
  for (const c of allowed) if (c.match.some((k) => text.includes(k))) add(c);
  // The fallback prefers the common courses (rank 0) over the niche ones.
  const byRank = [...allowed].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  for (const c of byRank) add(c);
  return chosen.slice(0, args.limit);
}
