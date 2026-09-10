// ────────────────────────────────────────────────────────────────────
// WHICH ANIMAL GOES ON THE CARTRIDGE PAGE.
//
// Operator, 2026-09-10: "We are going to insert the quarry it can hunt on the
// same page", and then "the animal should be a real animal and not show the
// vital zone."
//
// ⚠️ CHOSEN, NOT ASKED. There is no model call here and there must not be one:
// the cartridge research already names the species the round suits — "well
// matched to small- and medium-sized plains game (such as springbok, blesbok,
// impala, and warthog)" — and species names are distinctive nouns. Matching a
// curated list against text we already hold is deterministic, free, auditable
// in a diff, and cannot hallucinate an animal that does not live here.
//
// ⚠️ AND IT IS FILTERED BY WHAT THE APPLICANT SAID THEY HUNT. A .308 suits
// kudu and it suits duiker; printing a kudu for somebody whose own answers say
// they hunt small game puts a picture in their application that their own
// paragraphs do not support. Where the two disagree the applicant wins, and
// where the applicant said nothing the cartridge decides alone.
//
// ⚠️ NOTHING HERE IS A CLAIM ABOUT THE APPLICANT. The picture illustrates the
// class of animal the round is used on; it does not say this person has shot
// one, and no caption may say so.
// ────────────────────────────────────────────────────────────────────

/** The classes the wizard offers — see HUNT_GAME_CLASS in motivation-cards. */
export type GameClass =
  | 'small'
  | 'plains_light'
  | 'plains_medium'
  | 'dangerous'
  | 'wingshooting';

export interface QuarrySpecies {
  /** Stable key. This is the plate's primary key, so it never changes. */
  key: string;
  /** How the caption names it. */
  name: string;
  /**
   * What the picture model is asked to draw.
   *
   * ⚠️ SEX AND AGE STATED, because "impala" alone gets a ewe about half the
   * time and the animal a hunting application is about is the ram. Where a
   * species has no meaningful horn difference the plain noun is right.
   */
  subject: string;
  /** Which of the wizard's classes this animal belongs to. */
  klass: GameClass;
  /**
   * Extra spellings the research might use. The key and the name are always
   * matched; these are for the ones that differ.
   */
  aliases?: readonly string[];
}

/**
 * Common South African game, ordered so the FIRST match in a class is the one
 * a reader would expect to see for it.
 *
 * ⚠️ ORDER IS THE TIE-BREAK AND IT IS DELIBERATE. A cartridge brief usually
 * names three or four species; the plate shows one, and for the lighter plains
 * game that one should be an impala rather than a steenbok — it is the animal
 * the class is named after in practice.
 *
 * ⚠️ NO PROTECTED OR PERMIT-ONLY SPECIES. Rhino is absent on purpose: a
 * picture of one in a licence application is a question nobody wants asked,
 * whatever the paperwork says.
 */
export const QUARRY: readonly QuarrySpecies[] = [
  // ── the lighter plains game ──────────────────────────────────────
  { key: 'impala', name: 'Impala', subject: 'an adult impala ram', klass: 'plains_light' },
  { key: 'springbok', name: 'Springbok', subject: 'an adult springbok ram', klass: 'plains_light' },
  { key: 'blesbok', name: 'Blesbok', subject: 'an adult blesbok ram', klass: 'plains_light' },
  { key: 'warthog', name: 'Warthog', subject: 'an adult warthog boar', klass: 'plains_light' },
  { key: 'bushbuck', name: 'Bushbuck', subject: 'an adult bushbuck ram', klass: 'plains_light' },
  { key: 'reedbuck', name: 'Reedbuck', subject: 'an adult reedbuck ram', klass: 'plains_light' },
  { key: 'duiker', name: 'Grey duiker', subject: 'an adult grey (common) duiker', klass: 'plains_light', aliases: ['grey duiker', 'common duiker'] },
  { key: 'steenbok', name: 'Steenbok', subject: 'an adult steenbok', klass: 'plains_light' },
  { key: 'klipspringer', name: 'Klipspringer', subject: 'an adult klipspringer on rock', klass: 'plains_light' },

  // ── medium to large plains game ──────────────────────────────────
  { key: 'kudu', name: 'Kudu', subject: 'a mature greater kudu bull with full spiral horns', klass: 'plains_medium', aliases: ['greater kudu', 'kudu bull', 'kudu bulls'] },
  { key: 'gemsbok', name: 'Gemsbok', subject: 'an adult gemsbok (oryx) bull', klass: 'plains_medium', aliases: ['oryx'] },
  { key: 'blue_wildebeest', name: 'Blue wildebeest', subject: 'an adult blue wildebeest bull', klass: 'plains_medium', aliases: ['wildebeest', 'blue wildebeest'] },
  { key: 'black_wildebeest', name: 'Black wildebeest', subject: 'an adult black wildebeest bull', klass: 'plains_medium', aliases: ['black wildebeest'] },
  { key: 'red_hartebeest', name: 'Red hartebeest', subject: 'an adult red hartebeest bull', klass: 'plains_medium', aliases: ['hartebeest'] },
  { key: 'waterbuck', name: 'Waterbuck', subject: 'a mature waterbuck bull', klass: 'plains_medium' },
  { key: 'nyala', name: 'Nyala', subject: 'a mature nyala bull', klass: 'plains_medium' },
  { key: 'zebra', name: 'Burchell’s zebra', subject: 'an adult Burchell’s plains zebra stallion', klass: 'plains_medium', aliases: ['burchell', 'plains zebra'] },
  { key: 'eland', name: 'Eland', subject: 'a mature eland bull', klass: 'plains_medium' },
  { key: 'sable', name: 'Sable', subject: 'a mature sable antelope bull', klass: 'plains_medium', aliases: ['sable antelope'] },
  { key: 'roan', name: 'Roan', subject: 'a mature roan antelope bull', klass: 'plains_medium', aliases: ['roan antelope'] },
  { key: 'tsessebe', name: 'Tsessebe', subject: 'an adult tsessebe', klass: 'plains_medium' },
  { key: 'bushpig', name: 'Bushpig', subject: 'an adult bushpig boar', klass: 'plains_medium' },

  // ── dangerous game ───────────────────────────────────────────────
  { key: 'buffalo', name: 'Cape buffalo', subject: 'a mature Cape buffalo bull with a hard boss', klass: 'dangerous', aliases: ['cape buffalo'] },
  { key: 'elephant', name: 'Elephant', subject: 'a mature African elephant bull', klass: 'dangerous' },
  { key: 'lion', name: 'Lion', subject: 'a mature male lion', klass: 'dangerous' },
  { key: 'leopard', name: 'Leopard', subject: 'an adult leopard', klass: 'dangerous' },
  { key: 'hippo', name: 'Hippopotamus', subject: 'an adult hippopotamus out of the water', klass: 'dangerous', aliases: ['hippopotamus'] },

  // ── small game and varmints ──────────────────────────────────────
  { key: 'jackal', name: 'Black-backed jackal', subject: 'an adult black-backed jackal', klass: 'small', aliases: ['black-backed jackal', 'black backed jackal'] },
  { key: 'caracal', name: 'Caracal', subject: 'an adult caracal', klass: 'small', aliases: ['rooikat'] },
  { key: 'dassie', name: 'Rock hyrax', subject: 'an adult rock hyrax (dassie) on rock', klass: 'small', aliases: ['rock hyrax', 'hyrax'] },
  { key: 'springhare', name: 'Springhare', subject: 'an adult springhare', klass: 'small' },
  { key: 'baboon', name: 'Chacma baboon', subject: 'an adult chacma baboon', klass: 'small', aliases: ['chacma'] },

  // ── birds ────────────────────────────────────────────────────────
  { key: 'guineafowl', name: 'Helmeted guineafowl', subject: 'an adult helmeted guineafowl', klass: 'wingshooting', aliases: ['helmeted guineafowl'] },
  { key: 'francolin', name: 'Francolin', subject: 'an adult Natal francolin', klass: 'wingshooting', aliases: ['spurfowl'] },
  { key: 'sandgrouse', name: 'Sandgrouse', subject: 'an adult Namaqua sandgrouse', klass: 'wingshooting' },
  { key: 'yellowbill_duck', name: 'Yellow-billed duck', subject: 'an adult yellow-billed duck', klass: 'wingshooting', aliases: ['yellow-billed duck', 'yellowbill'] },
  { key: 'egyptian_goose', name: 'Egyptian goose', subject: 'an adult Egyptian goose', klass: 'wingshooting', aliases: ['egyptian goose', 'spurwing goose'] },
];

const byKey = new Map(QUARRY.map((q) => [q.key, q]));

export function quarryByKey(key: string): QuarrySpecies | undefined {
  return byKey.get(key);
}

/** Every spelling that should match a species. */
function spellings(q: QuarrySpecies): string[] {
  return [q.key.replace(/_/g, ' '), q.name.toLowerCase(), ...(q.aliases ?? [])];
}

/**
 * ⚠️ WHOLE WORDS, NOT SUBSTRINGS. "roan" is inside "roan antelope" harmlessly
 * and inside nothing else here, but "eland" sits inside "Zeeland" and "lion"
 * inside "medallion"; a substring match would put an elephant on the page for
 * a sentence about a rifle's medallion. The boundary is non-letter or string
 * edge, so hyphens and plurals still match.
 */
function mentions(text: string, term: string): boolean {
  const t = term.toLowerCase().trim();
  if (!t) return false;
  const i0 = text.indexOf(t);
  if (i0 < 0) return false;
  for (let i = i0; i >= 0; i = text.indexOf(t, i + 1)) {
    const before = i === 0 ? '' : text[i - 1];
    const after = text[i + t.length] ?? '';
    const okBefore = !before || !/[a-z]/.test(before);
    // A trailing "s" is a plural, not another word.
    const okAfter = !after || !/[a-z]/.test(after) || after === 's';
    if (okBefore && okAfter) return true;
  }
  return false;
}

/**
 * How many animals go in one plate.
 *
 * ⚠️ FIVE, BECAUSE A LINE-UP STOPS READING AS ONE PAST THAT. The operator's
 * own samples ran to five across a 1.83:1 frame and each animal is still large
 * enough to identify; a sixth would be a herd photograph.
 */
export const MAX_IN_PLATE = 5;

/**
 * The species to picture, in the order they should stand.
 *
 * ⚠️ EMPTY IS A PERFECTLY GOOD ANSWER. A cartridge brief that names no
 * species, an applicant who is not hunting, a round nobody uses on game — the
 * page simply has no photograph, exactly as it did before this existed. A
 * guessed animal is worse than a plainer page.
 */
export function quarriesFor(args: {
  /** The cartridge research — the "well matched to" prose. */
  cartridgeText?: string;
  /** The applicant's own `hunt_game_class` answer, comma-separated. */
  gameClasses?: string;
}): QuarrySpecies[] {
  const text = (args.cartridgeText ?? '').toLowerCase();
  if (!text.trim()) return [];

  /**
   * ⚠️ ONLY WHAT THE ROUND IS *FOR*. The same paragraph that lists what a
   * cartridge suits usually goes on to list what it must not be used on —
   * "under-matched to eland, kudu bulls, buffalo, elephant or lion" — and
   * matching the whole block would reliably picture the animal the document
   * has just said this firearm cannot ethically take.
   */
  const stop = /under-?matched|not\s+(?:suited|recommended)|too\s+light\s+for/i.exec(
    text,
  );
  const usable = stop ? text.slice(0, stop.index) : text;

  const wanted = new Set(
    (args.gameClasses ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean),
  );

  const named = QUARRY.filter((q) =>
    spellings(q).some((x) => mentions(usable, x)),
  );
  if (!named.length) return [];

  /**
   * ⚠️ THE APPLICANT'S OWN ANSWERS FILTER THE LINE-UP, they do not merely
   * break a tie. A .308 suits kudu and it suits duiker; a plate showing both
   * to somebody whose answers say they hunt only the lighter plains game puts
   * animals in their application that their own paragraphs never mention.
   * Where the two share nothing at all, nothing is printed.
   */
  const kept = wanted.size ? named.filter((q) => wanted.has(q.klass)) : named;
  return kept.slice(0, MAX_IN_PLATE);
}

/**
 * Which species are in a plate, in the order they stand in the frame.
 *
 * ⚠️ ORDER IS PRESERVED, NOT SORTED, because the caption is built back out
 * of this string and has to name them left to right. An earlier version sorted
 * it so that two cartridges naming the same set could share one photograph;
 * plates are per-application now (operator: "we can call that api for each
 * motivation, it's stupid cheap"), so the sharing is gone and the order is
 * what matters.
 */
export function quarryPlateKey(species: readonly QuarrySpecies[]): string {
  return species.map((q) => q.key).join('+');
}

/** The species a stored plate holds, back from its key. */
export function quarryFromKey(keys: string): QuarrySpecies[] {
  return keys
    .split('+')
    .map((k) => byKey.get(k))
    .filter((q): q is QuarrySpecies => !!q);
}

/** How the caption names them, in the order they stand. */
export function quarryCaption(species: readonly QuarrySpecies[]): string {
  const names = species.map((q) => q.name);
  if (!names.length) return '';
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  /**
   * ⚠️ IT NAMES THE ANIMALS AND CLAIMS NOTHING. It must never say this
   * applicant has hunted one, or intends to: the picture illustrates what the
   * cartridge is used on, and a sentence putting the applicant in it would be
   * a statement of fact they are signing for.
   */
  return `${list} — game this cartridge is commonly used on, shown to scale.`;
}

/**
 * What the picture model is asked for.
 *
 * ⚠️ A PHOTOGRAPH, AND NOTHING DRAWN ON IT. Operator, 2026-09-10: "the
 * animal should be a real animal and not show the vital zone." The first
 * attempt was a field-guide illustration with the heart and lungs marked,
 * which is an anatomical claim this platform is in no position to make in a
 * document somebody signs and lodges — a wrong killzone is worse than no
 * picture at all.
 *
 * ⚠️ ONE FRAME, ALL OF THEM, TO SCALE. Operator, 2026-09-10, having tried it
 * themselves: "I asked Nano banana for all the querry you mentioned al
 * broadside. and it gave me a nice picture of all of them. I kind of like
 * that." It is also the better document: relative size is exactly what a
 * reader weighing a cartridge against its quarry wants to see, and one wide
 * frame fills the foot of the page where five separate ones could not.
 *
 * ⚠️ VERSIONED. A plate is stored forever under its set's key; changing this
 * wording without changing PROMPT_VERSION would leave every existing plate
 * looking like the old brief with no way to tell which is which.
 */
export const QUARRY_PROMPT_VERSION = '2026-09-10b';

export function quarryPrompt(species: readonly QuarrySpecies[]): string {
  const subjects = species.map((q) => q.subject).join(', then ');
  return [
    'A photorealistic wildlife photograph, wide landscape frame, of these',
    `animals standing together in one line across the frame: ${subjects}.`,
    'Every animal broadside side-on to the camera, facing left, whole body in',
    'frame, none overlapping another, evenly spaced, all at the same distance',
    'from the camera so their sizes are correctly in proportion to one another.',
    'Natural South African bushveld in soft early-morning light, background',
    'gently out of focus. Sharp focus on the animals, natural colours, taken',
    'with a long lens.',
    'No people, no vehicles, no blood, no injury, no firearms, no text, no',
    'watermark, no overlay, no markings of any kind on the animals.',
  ].join(' ');
}
