import type { NewsIncident } from '../news/news.types';

// ────────────────────────────────────────────────────────────────────
// THE AREAS, NOT THE ARTICLES.
//
// Operator, 2026-09-08, giving the design in three messages:
//
//   "you can add clippings of surrounding dangerous areas if the user travels
//    a lot. Or you can pull the areas and list them and ask the user if he
//    travels through these areas regularly."
//
//   "we could also use the work address and google maps routes to see through
//    which areas they travel and link it that way?"
//
//   "generate a list of dangerous areas around the applicants home in a 50km
//    radius that has articles attached to it and lets them just tick the ones
//    they travel through with a reason thats optional."
//
// ⚠️ SO THE MEMBER IS ASKED A QUESTION THEY CAN ACTUALLY ANSWER. "Which of
// these fourteen articles would you like in your pack" is a question about our
// filing; "do you drive through Edgemead" is a question about their life, and
// it is the one a DFO can weigh. The articles follow from the answer.
//
// ⚠️ AND IT IS WHY THE ANNEXURE EXISTS AT ALL TODAY. `press_clippings` is an
// `internal` key whose registry comment says "the wizard writes the value
// itself, once the member has picked from GET /motivations/:id/incidents" —
// and Phase 4 deleted that wizard. The endpoint works, the writer supports it,
// the pack has a letter reserved for it, and nothing could set the value. This
// is the picker, in the shape the operator asked for.
//
// PURE — no Nest, no Prisma, no clock, no geocoder. The station lookup and the
// route test are async and live in the service.
// ────────────────────────────────────────────────────────────────────

/** One place the local press reports crime in, with what it reported. */
export interface DangerArea {
  /**
   * The place as the papers print it.
   *
   * ⚠️ THE DISPLAY NAME, NOT THE GROUPING KEY. Two papers write "Jakes Gerwel
   * Drive" and "jakes gerwel drive"; they are one area and the member sees the
   * commoner spelling. `key` is what everything else matches on.
   */
  name: string;
  key: string;
  /** Newest first. What goes in the annexure if this area is ticked. */
  incidentIds: string[];
  /** How many reports name it. The reason one area outranks another. */
  count: number;
  /** Nearest report, in km from the applicant's home. Null when unplaced. */
  distanceKm: number | null;
  /** The kinds of crime reported there, most common first. */
  crimeTypes: string[];
  /** So the row means something before it is expanded. */
  latestHeadline: string;
  latestOn: string;
  /**
   * The applicant's route passes through here.
   *
   * ⚠️ ALWAYS FALSE TODAY, AND DELIBERATELY IN THE SHAPE. The route half —
   * home to work through the Maps directions API — is the operator's "auto
   * generate the dangerous areas with the routes". Until it lands, every area
   * is offered and none is pre-ticked, which is the honest resting state: we
   * have not worked out where they drive, so we ask.
   */
  onRoute: boolean;
}

/**
 * Places too big to be an area somebody "travels through".
 *
 * ⚠️ WITHOUT THIS, ONE ROW SWALLOWS THE LIST. Nearly every Cape article names
 * "Cape Town" and most name the province, so the commonest area would be the
 * whole metro — which no applicant can usefully tick and which tells a DFO
 * nothing. An area has to be small enough that driving through it is a fact
 * about the applicant.
 *
 * ⚠️ A LIST OF WHAT TO DROP, NOT A LIST OF WHAT IS ALLOWED. A place missing
 * from here is simply offered, which is the safe direction: a member can
 * decline a row they do not recognise, and cannot tick one we never showed.
 */
export const TOO_BROAD = new Set(
  [
    'SOUTH AFRICA',
    'SA',
    'WESTERN CAPE',
    'EASTERN CAPE',
    'NORTHERN CAPE',
    'GAUTENG',
    'KWAZULU-NATAL',
    'KWAZULU NATAL',
    'FREE STATE',
    'MPUMALANGA',
    'LIMPOPO',
    'NORTH WEST',
    'CAPE TOWN',
    'JOHANNESBURG',
    'PRETORIA',
    'DURBAN',
    'PORT ELIZABETH',
    'GQEBERHA',
    'BLOEMFONTEIN',
    'EAST LONDON',
    'POLOKWANE',
    'NELSPRUIT',
    'MBOMBELA',
    'KIMBERLEY',
    'SOWETO',
  ].map((s) => s),
);

/**
 * Single sites, which are destinations rather than areas.
 *
 * ⚠️ THE OPERATOR READ "Pepper Club Hotel" OFF THE LIVE LIST. "Do you travel
 * through Pepper Club Hotel regularly" is not a question anybody can answer:
 * a hotel is one building, and the place extractor picked it up because it is
 * a proper noun in a crime report.
 *
 * ⚠️ A MALL IS DELIBERATELY NOT ON THIS LIST. A shopping centre car park is
 * exactly where a hijacking happens, and it is somewhere a member genuinely
 * goes every week — dropping it would lose real evidence to tidy up a list.
 * The test is "is this one building", not "is this a business".
 *
 * ⚠️ NOR IS "Station". Bellville Station and Cape Town Station are places
 * people travel through daily, and the word is far too load-bearing in South
 * African place names to spend on this.
 */
const VENUE_WORDS = [
  'HOTEL',
  'LODGE',
  'GUESTHOUSE',
  'GUEST HOUSE',
  'RESTAURANT',
  'CASINO',
  'STADIUM',
  'CHURCH',
  'MOSQUE',
  'PRISON',
  'AIRPORT',
  'HOSPITAL',
  'CLINIC',
  'SCHOOL',
  'UNIVERSITY',
  'COLLEGE',
  'TAVERN',
];

/** Is this one building rather than somewhere you drive through? */
export function isVenue(key: string): boolean {
  return VENUE_WORDS.some((w) => key === w || key.endsWith(` ${w}`) || key.includes(`${w} `));
}

/** How many areas a member is asked to read. */
export const MAX_AREAS = 12;

/** Grouping key: case and punctuation are how two papers spell one place. */
export function areaKey(place: string): string {
  return (place ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Roll a list of incidents up into the areas they name.
 *
 * ⚠️ ONE INCIDENT CAN LAND IN SEVERAL AREAS, AND MUST. A smash-and-grab at the
 * corner of two roads in a named suburb names three places, and an applicant
 * who drives one of those roads should be offered it. The clipping then
 * appears once in the pack however many ticked areas claim it — deduplication
 * belongs where the ids are turned into an annexure, not here.
 */
export function dangerAreas(
  incidents: readonly NewsIncident[],
  opts: { max?: number; onRoute?: readonly string[] } = {},
): DangerArea[] {
  const routeKeys = new Set((opts.onRoute ?? []).map(areaKey));
  const byKey = new Map<
    string,
    {
      names: Map<string, number>;
      ids: string[];
      crimes: Map<string, number>;
      distanceKm: number | null;
      latestHeadline: string;
      latestOn: string;
    }
  >();

  // Newest first, so the first incident to claim an area names its headline.
  const ordered = [...incidents].sort((a, b) =>
    b.publishedOn.localeCompare(a.publishedOn),
  );

  for (const inc of ordered) {
    for (const place of inc.places ?? []) {
      const key = areaKey(place);
      if (!key || key.length < 3 || TOO_BROAD.has(key) || isVenue(key)) continue;

      let area = byKey.get(key);
      if (!area) {
        area = {
          names: new Map(),
          ids: [],
          crimes: new Map(),
          distanceKm: inc.distanceKm,
          latestHeadline: inc.headline,
          latestOn: inc.publishedOn,
        };
        byKey.set(key, area);
      }
      const shown = (place ?? '').trim();
      area.names.set(shown, (area.names.get(shown) ?? 0) + 1);
      if (!area.ids.includes(inc.id)) area.ids.push(inc.id);
      if (inc.crimeType) {
        area.crimes.set(inc.crimeType, (area.crimes.get(inc.crimeType) ?? 0) + 1);
      }
      // ⚠️ THE NEAREST REPORT, NOT THE FIRST. The list is ordered by date, so
      // taking the first incident's distance would rank an area by whichever
      // paper wrote about it most recently.
      if (
        inc.distanceKm !== null &&
        (area.distanceKm === null || inc.distanceKm < area.distanceKm)
      ) {
        area.distanceKm = inc.distanceKm;
      }
    }
  }

  const commonest = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const out: DangerArea[] = [...byKey.entries()].map(([key, a]) => ({
    key,
    name: commonest(a.names)[0]?.[0] ?? key,
    incidentIds: a.ids,
    count: a.ids.length,
    distanceKm: a.distanceKm,
    crimeTypes: commonest(a.crimes).map(([c]) => c),
    latestHeadline: a.latestHeadline,
    latestOn: a.latestOn,
    onRoute: routeKeys.has(key),
  }));

  /**
   * ⚠️ ON-ROUTE FIRST, THEN WEIGHT, THEN NEARNESS. An area the applicant
   * demonstrably drives through beats a busier one they have never seen, which
   * is the whole point of asking about routes at all. Below that, the number
   * of reports is what makes an area worth reading about, and distance breaks
   * the tie — an unplaced area sorts last rather than first, because "we do not
   * know where this is" is not "it is next door".
   */
  out.sort(
    (a, b) =>
      Number(b.onRoute) - Number(a.onRoute) ||
      b.count - a.count ||
      (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) ||
      a.name.localeCompare(b.name),
  );

  return out.slice(0, opts.max ?? MAX_AREAS);
}

/** One area the member says they travel through, and optionally why. */
export interface TravelledArea {
  key: string;
  /**
   * Why they are there, in their own words. Optional by the operator's own
   * instruction — "a reason thats optional for the reason being in that area".
   */
  reason?: string;
}

/** How many characters of reason we keep. One line, not an essay. */
export const REASON_MAX = 300;

/**
 * Read the stored answer back.
 *
 * ⚠️ NEVER THROWS, THE SAME POSTURE AS parsePressClippingIds. A corrupt value
 * reads back as nothing ticked, which loses a selection; refusing to render
 * the section at all would lose the applicant their whole case.
 */
export function parseTravelledAreas(raw: string | undefined): TravelledArea[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    const out: TravelledArea[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const key = typeof rec.key === 'string' ? areaKey(rec.key) : '';
      if (!key) continue;
      const reason =
        typeof rec.reason === 'string' ? rec.reason.trim().slice(0, REASON_MAX) : '';
      out.push(reason ? { key, reason } : { key });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The clippings a set of ticked areas puts in the pack.
 *
 * ⚠️ DERIVED ON THE SERVER, NEVER SENT BY THE BROWSER. The member ticks AREAS;
 * which articles that means is our arithmetic, and a stale bundle deciding it
 * would put an annexure in a pack that the ticked areas do not account for.
 *
 * ⚠️ AND IT IS CAPPED, IN AREA ORDER. `PRESS_CLIPPINGS_MAX` is the operator's
 * limit on how many cuttings ride behind one application — "enough to make the
 * precinct's pattern visible, not so many that the annexure becomes the
 * document". Taking them area by area rather than by date means every ticked
 * area is represented before any area gets a second one.
 */
export function clippingIdsFor(
  areas: readonly DangerArea[],
  ticked: readonly TravelledArea[],
  max: number,
): string[] {
  const want = new Set(ticked.map((t) => t.key));
  const chosen = areas.filter((a) => want.has(a.key));
  const out: string[] = [];
  for (let round = 0; out.length < max; round++) {
    let addedThisRound = false;
    for (const area of chosen) {
      const id = area.incidentIds[round];
      if (!id) continue;
      addedThisRound = true;
      if (!out.includes(id)) out.push(id);
      if (out.length >= max) break;
    }
    if (!addedThisRound) break;
  }
  return out.slice(0, max);
}
