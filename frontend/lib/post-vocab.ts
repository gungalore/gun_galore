// Suggestion vocabularies for the community composer's autocomplete fields.
//
// ⚠️ SUGGESTIONS ONLY (operator decision 2026-10-09). The member may type any
// word; the backend normalises and caps but never drops a value that is not in
// these lists. This file is where "as full as it can be" lives — nothing here
// renders on screen until the member types, so a long list costs bytes, not UI.
//
// Mirrors (loosely) backend/src/feed/feed.types.ts POST_CHIP_VOCAB /
// POST_SINGLE_VOCAB, which are now seeds rather than gates.

import { fold } from './fold-text';
import { CARTRIDGES } from './post-vocab-cartridges';

export type VocabKey =
  | 'species-hunting'
  | 'species-fishing'
  | 'flair-general'
  | 'flair-firearms'
  | 'flair-fishing'
  | 'flair-overlanding'
  | 'flair-camping'
  | 'flair-questions'
  | 'firearm-type'
  | 'water-type'
  | 'site-type'
  | 'gear-category'
  | 'gear-condition'
  | 'context'
  | 'test-result'
  | 'cartridge';

export interface VocabEntry {
  /** Stored value (a normalised slug) OR the verbatim label for label-mode. */
  value: string;
  /** What the picker shows and inserts. */
  label: string;
  /** Afrikaans / colloquial / alternate spellings that should match. */
  aliases?: string[];
  /** Optional group header in the dropdown. */
  group?: string;
}

const e = (value: string, label?: string, aliases?: string[], group?: string): VocabEntry => ({
  value,
  label: label ?? value,
  ...(aliases ? { aliases } : {}),
  ...(group ? { group } : {}),
});

// ── Hunting: quarry huntable in South Africa ────────────────────────────────
// Permit-huntable dangerous game is included (operator decision 2026-10-09).
// Legally protected species are NOT listed: rhino, African wild dog, pangolin.
const HUNTING_SPECIES: VocabEntry[] = [
  // Plains game
  e('impala', 'Impala', ['rooibok', 'rooi bok'], 'Plains game'),
  e('greater-kudu', 'Greater kudu', ['kudu', 'koedoe'], 'Plains game'),
  e('blue-wildebeest', 'Blue wildebeest', ['blouwildebees', 'wildebeest'], 'Plains game'),
  e('black-wildebeest', 'Black wildebeest', ['swartwildebees'], 'Plains game'),
  e('gemsbok', 'Gemsbok', ['oryx'], 'Plains game'),
  e('blesbok', 'Blesbok', ['blesbuck'], 'Plains game'),
  e('bontebok', 'Bontebok', [], 'Plains game'),
  e('springbok', 'Springbok', [], 'Plains game'),
  e('common-eland', 'Common eland', ['eland'], 'Plains game'),
  e('warthog', 'Warthog', ['vlakvark'], 'Plains game'),
  e('bushpig', 'Bushpig', ['bosvark'], 'Plains game'),
  e('red-hartebeest', 'Red hartebeest', ['hartebeest', 'rooihartbees'], 'Plains game'),
  e('tsessebe', 'Tsessebe', [], 'Plains game'),
  e('sable-antelope', 'Sable antelope', ['sable'], 'Plains game'),
  e('roan-antelope', 'Roan antelope', ['roan'], 'Plains game'),
  e('nyala', 'Nyala', [], 'Plains game'),
  e('bushbuck', 'Bushbuck', ['bosbok'], 'Plains game'),
  e('common-waterbuck', 'Common waterbuck', ['waterbuck'], 'Plains game'),
  e('mountain-reedbuck', 'Mountain reedbuck', ['rietbok'], 'Plains game'),
  e('common-reedbuck', 'Common reedbuck', [], 'Plains game'),
  e('grey-rhebok', 'Grey rhebok', ['vaalribbok'], 'Plains game'),
  e('steenbok', 'Steenbok', [], 'Plains game'),
  e('common-duiker', 'Common duiker', ['duiker'], 'Plains game'),
  e('red-duiker', 'Red duiker', [], 'Plains game'),
  e('grey-duiker', 'Grey duiker', [], 'Plains game'),
  e('klipspringer', 'Klipspringer', [], 'Plains game'),
  e('oribi', 'Oribi', [], 'Plains game'),
  e('cape-grysbok', 'Cape grysbok', ['grysbok'], 'Plains game'),
  e('sharpe-grysbok', "Sharpe's grysbok", [], 'Plains game'),
  e('burchells-zebra', "Burchell's zebra", ['zebra', 'plains-zebra'], 'Plains game'),
  e('giraffe', 'Giraffe', [], 'Plains game'),
  e('suni', 'Suni', [], 'Plains game'),
  // Smaller game & varmin
  e('cape-hare', 'Cape hare', ['haas'], 'Small game & varmin'),
  e('scrub-hare', 'Scrub hare', [], 'Small game & varmin'),
  e('springhare', 'Springhare', ['springhaas'], 'Small game & varmin'),
  e('porcupine', 'Porcupine', ['ystervark'], 'Small game & varmin'),
  e('rock-dassie', 'Rock dassie', ['dassie', 'rock-hyrax'], 'Small game & varmin'),
  // Predators & varmin (permit)
  e('black-backed-jackal', 'Black-backed jackal', ['jakkals'], 'Predators & varmin'),
  e('side-striped-jackal', 'Side-striped jackal', [], 'Predators & varmin'),
  e('caracal', 'Caracal', ['rooikat', 'lynx'], 'Predators & varmin'),
  e('serval', 'Serval', [], 'Predators & varmin'),
  e('african-wild-cat', 'African wild cat', ['wildcat'], 'Predators & varmin'),
  e('spotted-hyaena', 'Spotted hyaena', ['hyena', 'gevlekte-hiena'], 'Predators & varmin'),
  e('brown-hyaena', 'Brown hyaena', [], 'Predators & varmin'),
  e('aardwolf', 'Aardwolf', ['maanhaarjakkals'], 'Predators & varmin'),
  e('honey-badger', 'Honey badger', ['ratel'], 'Predators & varmin'),
  e('african-civet', 'African civet', ['siwetkat'], 'Predators & varmin'),
  e('small-spotted-genet', 'Small-spotted genet', ['genet'], 'Predators & varmin'),
  e('large-spotted-genet', 'Large-spotted genet', [], 'Predators & varmin'),
  e('slender-mongoose', 'Slender mongoose', [], 'Predators & varmin'),
  e('yellow-mongoose', 'Yellow mongoose', [], 'Predators & varmin'),
  e('water-mongoose', 'Water mongoose', [], 'Predators & varmin'),
  e('chacma-baboon', 'Chacma baboon', ['baboon', 'bobbejaan'], 'Predators & varmin'),
  e('vervet-monkey', 'Vervet monkey', ['monkey', 'blou-aap'], 'Predators & varmin'),
  // Dangerous game (permit)
  e('cape-buffalo', 'Cape buffalo', ['buffalo'], 'Dangerous game (permit)'),
  e('african-elephant', 'African elephant', ['elephant'], 'Dangerous game (permit)'),
  e('lion', 'Lion', [], 'Dangerous game (permit)'),
  e('leopard', 'Leopard', [], 'Dangerous game (permit)'),
  e('cheetah', 'Cheetah', [], 'Dangerous game (permit)'),
  e('hippopotamus', 'Hippopotamus', ['hippo', 'seekoei'], 'Dangerous game (permit)'),
  e('nile-crocodile', 'Nile crocodile', ['crocodile', 'krokodil'], 'Dangerous game (permit)'),
  // Wing shooting
  e('helmeted-guineafowl', 'Helmeted guineafowl', ['guineafowl', 'tarentaal'], 'Wing shooting'),
  e('swainsons-francolin', "Swainson's francolin", ['francolin', 'swempie'], 'Wing shooting'),
  e('orange-river-francolin', 'Orange River francolin', [], 'Wing shooting'),
  e('natal-francolin', 'Natal francolin', [], 'Wing shooting'),
  e('shelleys-francolin', "Shelley's francolin", [], 'Wing shooting'),
  e('redwing-francolin', 'Redwing francolin', ['rooivlerk-patrijs'], 'Wing shooting'),
  e('greywing-francolin', 'Greywing francolin', [], 'Wing shooting'),
  e('red-billed-francolin', 'Red-billed francolin', [], 'Wing shooting'),
  e('coqui-francolin', 'Coqui francolin', [], 'Wing shooting'),
  e('cape-spurfowl', 'Cape spurfowl', ['fisant', 'pheasant'], 'Wing shooting'),
  e('common-quail', 'Common quail', ['quail'], 'Wing shooting'),
  e('harlequin-quail', 'Harlequin quail', [], 'Wing shooting'),
  e('ring-necked-pheasant', 'Ring-necked pheasant', ['pheasant'], 'Wing shooting'),
  e('chukar-partridge', 'Chukar partridge', ['chukar'], 'Wing shooting'),
  e('laughing-dove', 'Laughing dove', ['dove'], 'Wing shooting'),
  e('ring-necked-dove', 'Ring-necked dove', [], 'Wing shooting'),
  e('cape-turtle-dove', 'Cape turtle dove', ['tortelduif'], 'Wing shooting'),
  e('rameron-pigeon', 'Rameron pigeon', ['bosduif'], 'Wing shooting'),
  e('speckled-pigeon', 'Speckled pigeon', [], 'Wing shooting'),
  e('egyptian-goose', 'Egyptian goose', ['kolgans'], 'Wing shooting'),
  e('spur-winged-goose', 'Spur-winged goose', [], 'Wing shooting'),
  e('yellow-billed-duck', 'Yellow-billed duck', ['geelbekeend'], 'Wing shooting'),
  e('red-billed-teal', 'Red-billed teal', [], 'Wing shooting'),
  e('hottentot-teal', 'Hottentot teal', [], 'Wing shooting'),
  e('cape-shoveler', 'Cape shoveler', [], 'Wing shooting'),
  e('south-african-shelduck', 'South African shelduck', [], 'Wing shooting'),
  e('white-faced-whistling-duck', 'White-faced whistling duck', [], 'Wing shooting'),
  e('african-snipe', 'African snipe', ['ethiopian-snipe'], 'Wing shooting'),
  e('greater-painted-snipe', 'Greater painted snipe', [], 'Wing shooting'),
];

// ── Fishing: freshwater, estuary, offshore, sharks/rays, invertebrates ──────
const FISHING_SPECIES: VocabEntry[] = [
  e('largemouth-bass', 'Largemouth bass', ['bass'], 'Freshwater'),
  e('smallmouth-bass', 'Smallmouth bass', [], 'Freshwater'),
  e('spotted-bass', 'Spotted bass', [], 'Freshwater'),
  e('carp', 'Carp', ['common-carp', 'karp'], 'Freshwater'),
  e('mirror-carp', 'Mirror carp', [], 'Freshwater'),
  e('grass-carp', 'Grass carp', [], 'Freshwater'),
  e('african-sharptooth-catfish', 'African sharptooth catfish', ['barbel', 'catfish'], 'Freshwater'),
  e('mozambique-tilapia', 'Mozambique tilapia', ['bream', 'kurper'], 'Freshwater'),
  e('banded-kurper', 'Banded kurper', [], 'Freshwater'),
  e('vlei-kurper', 'Vlei kurper', [], 'Freshwater'),
  e('three-spot-tilapia', 'Three-spot tilapia', ['three-spot-bream'], 'Freshwater'),
  e('smallmouth-yellowfish', 'Smallmouth yellowfish', ['yellowfish', 'geelvis'], 'Freshwater'),
  e('largemouth-yellowfish', 'Largemouth yellowfish', [], 'Freshwater'),
  e('scaly-yellowfish', 'Scaly yellowfish', [], 'Freshwater'),
  e('clanwilliam-yellowfish', 'Clanwilliam yellowfish', [], 'Freshwater'),
  e('orange-river-mudfish', 'Orange River mudfish', ['mudfish'], 'Freshwater'),
  e('sawfin', 'Sawfin', [], 'Freshwater'),
  e('african-tigerfish', 'African tigerfish', ['tigerfish'], 'Freshwater'),
  e('nembwe', 'Nembwe', [], 'Freshwater'),
  e('purple-labeo', 'Purple labeo', ['mud-mullet'], 'Freshwater'),
  e('trout', 'Trout', [], 'Freshwater'),
  e('rainbow-trout', 'Rainbow trout', [], 'Freshwater'),
  e('brown-trout', 'Brown trout', [], 'Freshwater'),
  e('dusky-kob', 'Dusky kob', ['kob', 'geelbek'], 'Estuary & shore'),
  e('silver-kob', 'Silver kob', [], 'Estuary & shore'),
  e('garrick', 'Garrick', ['leervis'], 'Estuary & shore'),
  e('white-stumpnose', 'White stumpnose', ['stumpnose'], 'Estuary & shore'),
  e('river-snapper', 'River snapper', ['mangrove-snapper'], 'Estuary & shore'),
  e('grunter', 'Spotted grunter', ['grunter'], 'Estuary & shore'),
  e('white-grunter', 'White grunter', [], 'Estuary & shore'),
  e('cape-sole', 'Cape sole', ['sole'], 'Estuary & shore'),
  e('white-steenbras', 'White steenbras', ['steenbras'], 'Estuary & shore'),
  e('red-steenbras', 'Red steenbras', ['copper-steenbras'], 'Estuary & shore'),
  e('galjoen', 'Galjoen', [], 'Estuary & shore'),
  e('blacktail', 'Blacktail', ['dassie'], 'Estuary & shore'),
  e('zebra', 'Zebra', ['zebrafish'], 'Estuary & shore'),
  e('bronze-bream', 'Bronze bream', ['bluefish'], 'Estuary & shore'),
  e('white-musselcracker', 'White musselcracker', ['musselcracker'], 'Estuary & shore'),
  e('black-musselcracker', 'Black musselcracker', [], 'Estuary & shore'),
  e('poenskop', 'Poenskop', ['black-musselcracker-2'], 'Estuary & shore'),
  e('cape-knifejaw', 'Cape knifejaw', [], 'Estuary & shore'),
  e('yellowtail', 'Cape yellowtail', ['yellowtail-amberjack'], 'Offshore'),
  e('king-mackerel', 'King mackerel', ['couta', 'kingfish'], 'Offshore'),
  e('queen-mackerel', 'Queen mackerel', ['natal-snoek'], 'Offshore'),
  e('snoek', 'Snoek', ['barracouta'], 'Offshore'),
  e('cape-salmon', 'Cape salmon', ['geelbek-2'], 'Offshore'),
  e('kabeljou', 'Kabeljou', ['kob-2'], 'Offshore'),
  e('hake', 'Hake', [], 'Offshore'),
  e('yellowfin-tuna', 'Yellowfin tuna', ['tuna'], 'Offshore'),
  e('longfin-tuna', 'Longfin tuna', ['albacore'], 'Offshore'),
  e('skipjack-tuna', 'Skipjack tuna', ['bonito'], 'Offshore'),
  e('dorado', 'Dorado', ['mahi-mahi', 'dolphinfish'], 'Offshore'),
  e('wahoo', 'Wahoo', [], 'Offshore'),
  e('marlin', 'Marlin', ['striped-marlin', 'blue-marlin', 'black-marlin'], 'Offshore'),
  e('sailfish', 'Sailfish', [], 'Offshore'),
  e('swordfish', 'Swordfish', [], 'Offshore'),
  e('yellowtail-kingfish', 'Yellowtail kingfish', [], 'Offshore'),
  e('roman', 'Roman', ['soldier'], 'Reef'),
  e('hottentot', 'Hottentot', [], 'Reef'),
  e('red-fingers', 'Red fingers', [], 'Reef'),
  e('fransmadam', 'Fransmadam', [], 'Reef'),
  e('seventy-four', 'Seventy-four', [], 'Reef'),
  e('janbruin', 'Janbruin', [], 'Reef'),
  e('daggerhead-kob', 'Daggerhead kob', [], 'Reef'),
  e('bludger', 'Bludger', [], 'Reef'),
  e('bronzwhaler-shark', 'Bronze whaler shark', ['copper-shark'], 'Sharks & rays'),
  e('ragged-tooth-shark', 'Ragged-tooth shark', ['sand-tiger'], 'Sharks & rays'),
  e('smoothhound-shark', 'Smoothhound shark', [], 'Sharks & rays'),
  e('gulper-shark', 'Gulper shark', [], 'Sharks & rays'),
  e('mako-shark', 'Mako shark', [], 'Sharks & rays'),
  e('blue-shark', 'Blue shark', [], 'Sharks & rays'),
  e('hammerhead-shark', 'Hammerhead shark', [], 'Sharks & rays'),
  e('catshark', 'Catshark', [], 'Sharks & rays'),
  e('eagle-ray', 'Eagle ray', [], 'Sharks & rays'),
  e('stingray', 'Stingray', [], 'Sharks & rays'),
  e('guitarfish', 'Guitarfish', ['sandshark'], 'Sharks & rays'),
  e('skate', 'Skate', [], 'Sharks & rays'),
  e('west-coast-rock-lobster', 'West Coast rock lobster', ['crayfish', 'kreef'], 'Invertebrates'),
  e('squid', 'Squid', ['chokka', 'calamari'], 'Invertebrates'),
  e('blue-swimmer-crab', 'Blue swimmer crab', ['crab'], 'Invertebrates'),
  e('mudprawn', 'Mudprawn', ['prawn'], 'Invertebrates'),
  e('white-mussel', 'White mussel', ['mussel'], 'Invertebrates'),
];

const VOCAB: Record<VocabKey, readonly VocabEntry[]> = {
  'species-hunting': HUNTING_SPECIES,
  'species-fishing': FISHING_SPECIES,
  'flair-general': [
    e('meetup'), e('announcement'), e('photo'), e('news'), e('discussion'),
    e('question'), e('advice'), e('trip-report'), e('introduction'),
    e('identification'), e('help-needed'), e('throwback'), e('safety'),
    e('conservation'), e('ethical-hunting'), e('community'),
  ],
  'flair-firearms': [
    e('range'), e('hunting'), e('competition'), e('maintenance'),
    e('grouping'), e('zeroing'), e('load-development'), e('suppressed'),
    e('optics'), e('cleaning'), e('troubleshooting'), e('accuracy'),
    e('long-range'), e('precision'), e('pistol'), e('shotgun'), e('rimfire'),
    e('first-shots'), e('safe-handling'), e('build'),
  ],
  'flair-fishing': [
    e('lure'), e('bait'), e('fly'), e('trolling'), e('bottom'),
    e('spinning'), e('jigging'), e('drop-shot'), e('soft-plastic'),
    e('crankbait'), e('spoon'), e('surface'), e('ledger'), e('float'),
    e('nymph'), e('dry-fly'), e('streamer'), e('rock-and-surf'),
    e('kayak'), e('boat'), e('shore'), e('deep-sea'),
    e('catch-and-release'), e('tag-and-release'), e('specimen'), e('bank-fishing'),
  ],
  'flair-overlanding': [
    e('trail-report'), e('recovery'), e('passable'), e('closed'), e('fuel'),
    e('water-crossing'), e('sand'), e('mud'), e('rock'), e('technical'),
    e('grade'), e('tyre-pressure'), e('low-range'), e('winching'),
    e('tyre-repair'), e('camp-spot'), e('convoy'), e('solo'),
    e('breakdown'), e('road-condition'), e('scenic'),
  ],
  'flair-camping': [
    e('water'), e('toilets'), e('firepit'), e('none'),
    e('hot-showers'), e('ablutions'), e('electricity'), e('drinking-water'),
    e('borehole'), e('river-frontage'), e('dam-frontage'), e('sea-view'),
    e('shade'), e('wildlife'), e('fenced'), e('pets-allowed'),
    e('no-cell-signal'), e('4x4-required'), e('2wd-accessible'),
    e('caravan-sites'), e('camping-sites'), e('chalets'), e('bush-lapa'),
    e('washing-up'), e('laundry'), e('kiosk'), e('braai-wood'),
    e('birding'), e('fishing-spot'), e('boat-launch'), e('hiking-trails'),
    e('mtb-trails'), e('kids-area'), e('pool'), e('restaurant'), e('fridge'),
    e('wifi'), e('dump-point'), e('starry-skies'), e('remote'),
  ],
  'flair-questions': [
    e('setup'), e('troubleshooting'), e('legal'), e('safety'),
    e('local-advice'), e('buying-advice'), e('value'), e('identification'),
    e('load-data'), e('calibre-choice'), e('scope-choice'), e('bullet-choice'),
    e('hunting-spot'), e('fishing-spot'), e('licence'), e('competency'),
    e('dealer'), e('shipping'), e('maintenance'), e('beginner'),
  ],
  'firearm-type': [
    e('rifle'), e('carbine'), e('bolt-action'), e('lever-action'),
    e('pump-action'), e('semi-auto'), e('straight-pull'), e('single-shot'),
    e('double-rifle'), e('break-action'), e('shotgun'), e('side-by-side'),
    e('over-under'), e('pistol'), e('revolver'), e('semi-auto-pistol'),
    e('airgun'), e('pcp-airgun'), e('springer-airgun'), e('air-pistol'),
    e('rimfire'), e('muzzleloader'), e('black-powder'), e('crossbow'),
    e('bow'), e('recurve-bow'), e('compound-bow'), e('other'),
  ],
  'water-type': [
    e('river'), e('dam'), e('estuary'), e('nearshore'), e('offshore'),
    e('lagoon'), e('farm-dam'), e('impoundment'), e('tailwater'),
    e('backwater'), e('deep-drop'), e('reef'), e('surf-zone'),
    e('rock-shore'), e('estuary-mouth'), e('tidal-river'), e('lake'),
    e('stream'), e('spring-creek'),
  ],
  'site-type': [
    e('campsite'), e('wilderness'), e('caravan'), e('hut'), e('other'),
    e('caravan-park'), e('bush-camp'), e('glamping'), e('trail-camp'),
    e('beach-camp'), e('private-farm'), e('conservancy'), e('national-park'),
    e('provincial-park'), e('municipal-camp'), e('river-camp'),
    e('wilderness-camp'), e('lodge'), e('backpackers'), e('chalet'),
  ],
  'gear-category': [
    e('firearm'), e('optic'), e('ammo'), e('camping'), e('fishing'),
    e('vehicle'), e('other'), e('rifle-scope'), e('red-dot'), e('binocular'),
    e('spotting-scope'), e('night-vision'), e('thermal'), e('suppressor'),
    e('bipod'), e('sling'), e('cleaning-kit'), e('safe'), e('holster'),
    e('reloading-press'), e('reloading-dies'), e('reloading-equipment'),
    e('brass'), e('projectiles'), e('powder'), e('primers'), e('chronograph'),
    e('range-finder'), e('gps'), e('comms-radio'), e('tent'), e('sleeping-bag'),
    e('backpack'), e('boots'), e('clothing'), e('knife'), e('torch'),
    e('headlamp'), e('cooler'), e('fridge'), e('trailer'), e('rooftop-tent'),
    e('recovery-gear'), e('tyres'), e('suspension'), e('winch'),
    e('fishing-rod'), e('fishing-reel'), e('tackle'), e('lure'), e('rod-bag'),
    e('bow'), e('arrows'), e('broadheads'),
  ],
  'gear-condition': [
    e('new'), e('used'), e('like-new'), e('as-new'), e('excellent'),
    e('good'), e('fair'), e('worn'), e('damaged'), e('refurbished'),
    e('demo'), e('boxed'),
  ],
  context: [
    e('at-range'), e('in-field'), e('at-home'), e('on-trip'),
    e('in-the-shop'), e('while-zeroing'), e('after-service'),
    e('on-arrival'), e('at-a-competition'), e('during-a-hunt'),
    e('at-a-farm'), e('on-a-trail'),
  ],
  'test-result': [
    e('sub-moa', 'Sub-MOA'), e('0-5-moa', '0.5 MOA'), e('1-moa', '1 MOA'),
    e('1-5-moa', '1.5 MOA'), e('2-moa', '2 MOA'), e('3-moa', '3 MOA'),
    e('3-shot-group', '3-shot group'), e('5-shot-group', '5-shot group'),
    e('10-shot-group', '10-shot group'), e('50m-zero', '50 m zero'),
    e('100m-zero', '100 m zero'), e('200m-zero', '200 m zero'),
    e('point-of-impact', 'Point of impact'), e('cold-bore', 'Cold bore'),
  ],
  cartridge: CARTRIDGES,
};

export function entriesFor(key: VocabKey): readonly VocabEntry[] {
  return VOCAB[key] ?? [];
}

/** The display label for a stored value, or undefined when it is not known. */
export function labelFor(key: VocabKey, value: string): string | undefined {
  return entriesFor(key).find((x) => x.value === value)?.label;
}

/** Best match rank for one haystack; -1 means no match. */
function rankOne(foldedQuery: string, haystack: string): number {
  const h = fold(haystack);
  if (!h) return -1;
  if (h === foldedQuery) return 0;
  if (h.startsWith(foldedQuery)) return 1;
  if (
    haystack
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((w) => {
        const fw = fold(w);
        return fw && fw.startsWith(foldedQuery);
      })
  ) {
    return 2;
  }
  if (h.includes(foldedQuery)) return 3;
  return -1;
}

/**
 * Ranked suggestions for a query. Exact value/label/alias matches first, then
 * starts-with, then word-start, then any substring. Ties keep the data-file
 * order (which is chosen to be the most useful first). Deterministic — see the
 * post-vocab spec.
 */
export function matchEntries(
  query: string,
  entries: readonly VocabEntry[],
  limit = 12,
): VocabEntry[] {
  const q = fold(query);
  if (!q) return [];
  const scored: { entry: VocabEntry; rank: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    let best = rankOne(q, entry.label);
    const variants = [entry.value, ...(entry.aliases ?? [])];
    for (const v of variants) {
      const r = rankOne(q, v);
      if (r >= 0 && (best < 0 || r < best)) best = r;
    }
    if (best >= 0) scored.push({ entry, rank: best, order });
  });
  scored.sort((a, b) => (a.rank - b.rank) || (a.order - b.order));
  return scored.slice(0, limit).map((s) => s.entry);
}
