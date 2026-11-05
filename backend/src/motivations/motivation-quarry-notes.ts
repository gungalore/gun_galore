// ────────────────────────────────────────────────────────────────────
// WHAT EACH QUARRY SPECIES ACTUALLY ASKS OF A CARTRIDGE.
//
// Operator, 2026-11-03: "the descriptions for each animal is the same. It needs
// to be specific to that animal and calibre combo." The exhibit used to say the
// same class-level sentence under every animal — "this class demands a heavy,
// controlled cartridge" — so a buffalo, an elephant, a lion and a hippo all
// read as one stock caption with the name swapped.
//
// ⚠️ THESE ARE FIELD NOTES, NOT BALLISTIC ADVICE. The `nature` line says how
// the species lives and why it is hard to take; the `demand` line says what
// that species asks of a bullet. No energy, velocity or drop figure is asserted
// here — those belong to the cartridge research, and a recalled number on a
// signed document is an invented fact. The applied calibre is named by the
// plate builder, which knows the actual application.
//
// ⚠️ CURATED AND KEYED BY THE SAME STABLE `QuarrySpecies.key`. A missing key
// falls back to the class note rather than inventing an animal, and the spec
// checks that every catalogue entry has a brief.
// ────────────────────────────────────────────────────────────────────

export interface SpeciesBrief {
  /** Completes "Cape buffalo ...". Starts lower-case. */
  nature: string;
  /** What this species asks of a cartridge. */
  demand: string;
}

export const SPECIES_BRIEFS: Readonly<Record<string, SpeciesBrief>> = {
  // ── light plains game ─────────────────────────────────────────────
  impala: {
    nature:
      'is an alert, fast herd antelope of mixed bushveld and woodland edges, quick to flush and difficult to stop once the herd breaks',
    demand:
      'a quick, accurate first shot and a flat-shooting bullet that reaches the chest before the animal can turn into cover',
  },
  springbok: {
    nature:
      'is a lightly built, open-country antelope that relies on speed and eyesight, and is usually taken at the far end of a stalk across open ground',
    demand:
      'a flat trajectory and enough retained velocity to place the shot cleanly at open-plains distance',
  },
  blesbok: {
    nature:
      'is a herd antelope of open grassland, tough for its size and often still moving after the first shot',
    demand:
      'a flat-shooting cartridge with enough bullet weight to reach the chest cleanly rather than a light varmint load',
  },
  warthog: {
    nature:
      'is a tough, low-slung pig that lives at the edge of thick cover and often runs for the nearest hole when pressed',
    demand:
      'a bullet with enough weight and penetration to break the shoulder and anchor a boar before it reaches cover',
  },
  bushbuck: {
    nature:
      'is a solitary, secretive antelope of dense riverine thicket, usually seen for a moment at close range',
    demand:
      'a quick-handling rifle and a bullet heavy enough for the angle, because the shot is often taken in cover at close quarters',
  },
  reedbuck: {
    nature:
      'is an elusive reed-and-vlei antelope that shows briefly at the edge of tall cover, usually early or late',
    demand:
      'a fast, accurate shot at close range and a bullet that will not be deflected by the first stems of reeds',
  },
  duiker: {
    nature:
      'is a small, solitary antelope of thick cover and broken ground that presents a brief, close shot',
    demand:
      'a light, accurate bullet and a rifle that comes up quickly, because the window is short and the target is small',
  },
  steenbok: {
    nature:
      'is a small, solitary antelope of open scrub and dry grassland, wary and quick to break cover',
    demand:
      'a flat-shooting, light bullet and an accurate first shot at modest range',
  },
  klipspringer: {
    nature:
      'is a small rock-dwelling antelope of steep outcrops, where the shot is often taken across broken ground at an awkward angle',
    demand:
      'an accurate, flat-shooting load and a bullet that holds together on a small, tough animal in difficult terrain',
  },

  // ── medium and large plains game ──────────────────────────────────
  kudu: {
    nature:
      'is a large, grey-coated antelope that melts into thick bush, and a mature bull is usually taken at the edge of cover after a careful stalk',
    demand:
      'a high-sectional-density bullet with a flat trajectory and enough retained energy to reach the vitals through the shoulder at bushveld distance',
  },
  gemsbok: {
    nature:
      'is a large, hardy oryx of arid open country, built to cover ground and often taken at long range',
    demand:
      'a flat trajectory and high retained energy, with a bullet that can handle a tough, heavy-bodied animal at distance',
  },
  blue_wildebeest: {
    nature:
      'is a heavy, herd-dwelling plains antelope with a deep chest and tough hide, often taken on open ground at 150 to 250 metres',
    demand:
      'a flat-shooting cartridge with enough bullet mass and penetration to reach the chest cleanly on a quartering animal',
  },
  black_wildebeest: {
    nature:
      'is a fast, hardy grassland antelope that is smaller than its blue cousin but still tough and long-winded',
    demand:
      'a flat trajectory and a bullet with enough retained energy for a clean shot at open-ground distance',
  },
  red_hartebeest: {
    nature:
      'is a long-faced, long-legged antelope of open plains, built for speed and often found well beyond the first rise',
    demand:
      'a flat-shooting, high-energy load that can reach the chest at extended plains range without excessive holdover',
  },
  waterbuck: {
    nature:
      'is a large, water-associated antelope with a thick, oily hide and a reputation for absorbing a shot',
    demand:
      'a deep-penetrating bullet with enough mass to get through the hide and shoulder and into the chest',
  },
  nyala: {
    nature:
      'is a shy, dense-cover antelope of riverine bush, usually seen at close range and rarely standing for long',
    demand:
      'a quick-handling rifle and a bullet heavy enough to reach the chest through the angle of thick cover',
  },
  zebra: {
    nature:
      'is a heavily built plains grazer with a tough hide and heavy bone, and a stallion can carry a bullet well',
    demand:
      'a deep-penetrating, heavy-for-calibre bullet that can break shoulder bone and reach the vitals',
  },
  eland: {
    nature:
      'is the largest antelope, a heavy, slow-moving but tough animal with a thick hide and a deep chest',
    demand:
      'a bullet with enough mass and penetration to reach the chest through the shoulder, not a light plains-game load',
  },
  sable: {
    nature:
      'is a large, dark woodland antelope with a heavy body and sweeping horns, often found at the edge of thick cover',
    demand:
      'a controlled-expansion bullet with enough weight to reach the chest through the shoulder at close to medium range',
  },
  roan: {
    nature:
      'is a large, powerful antelope of open woodland, tough and often found in small groups',
    demand:
      'a bullet with enough mass and penetration for a quartering shot on a heavy-bodied animal',
  },
  tsessebe: {
    nature:
      'is a fast, open-plains antelope with a light build and a habit of running hard after the first shot',
    demand:
      'a flat-shooting cartridge and a quick, accurate second shot at open-ground distance',
  },
  bushpig: {
    nature:
      'is a nocturnal, thick-set pig of dense riverine thicket, usually encountered at close range after dark',
    demand:
      'a quick-handling rifle and a heavy, deep-penetrating bullet for a close, fast shot in cover',
  },

  // ── dangerous game ───────────────────────────────────────────────
  buffalo: {
    nature:
      'is a herd-dwelling bulk grazer with a heavy boss, thick hide and a reputation for turning on a hunter after the first shot',
    demand:
      'the mass and penetration to reach the vitals through the boss, hide and shoulder bone, and enough reserve to anchor a bull that is still on its feet',
  },
  elephant: {
    nature:
      'is the largest land animal, with a small vital area set behind thick hide and heavy bone, and is usually taken at very close range in thick cover',
    demand:
      'a heavy, controlled bullet that holds together through hide and bone and reaches the vitals, rather than one that expands early on the shoulder',
  },
  lion: {
    nature:
      'is a soft-skinned but heavily boned predator, often hunted over bait at close range in low light',
    demand:
      'a bullet that opens quickly enough to do damage yet still reaches the chest, and a rifle that comes up fast for a close, moving shot',
  },
  leopard: {
    nature:
      'is a solitary, soft-skinned cat hunted over bait at close range, often at night, where the shot comes suddenly',
    demand:
      'a quick-handling rifle and a bullet that expands fast but still penetrates to the chest',
  },
  hippo: {
    nature:
      'is a semi-aquatic grazer with a massive skull, thick hide and a habit of taking to water when wounded',
    demand:
      'a heavy, deep-penetrating bullet that can break heavy bone and reach the vital area before the animal reaches the water',
  },

  // ── small game and varmints ──────────────────────────────────────
  jackal: {
    nature:
      'is a small, intelligent predator of open grassland and scrub, often called in and taken at modest range',
    demand:
      'a flat-shooting, light bullet and an accurate first shot on a small, alert target',
  },
  caracal: {
    nature:
      'is a secretive, nocturnal cat of thick scrub and rocky hillside, usually seen briefly at close range',
    demand:
      'a quick, accurate shot and a light bullet that will not be deflected by the first twigs',
  },
  dassie: {
    nature:
      'is a small rock-dwelling animal of outcrops and koppies, often taken at short range on a steep angle',
    demand: 'an accurate, flat-shooting load for a small target in broken rock',
  },
  springhare: {
    nature:
      'is a nocturnal, long-legged rodent of open sandy grassland, often taken at night at close to medium range',
    demand:
      'a light, flat-shooting bullet and an accurate shot at a small, fast-moving target',
  },
  baboon: {
    nature:
      'is a large, intelligent primate of thick cover and broken ground, often encountered at close range',
    demand:
      'a quick, accurate shot and a bullet with enough weight to anchor a tough animal in cover',
  },

  // ── birds ────────────────────────────────────────────────────────
  guineafowl: {
    nature:
      'is a fast, flocking game bird of dry grassland and thorn scrub, often flushed in a rush of wings',
    demand:
      'a shotgun pattern that opens quickly at close range and enough pellet energy for a clean kill',
  },
  francolin: {
    nature:
      'is a fast-flushing game bird of thorn scrub and dry grass, usually taken at close range',
    demand:
      'an open, even shotgun pattern for a quick shot at a bird that is already moving',
  },
  sandgrouse: {
    nature:
      'is a fast, far-flying game bird of arid open country, often decoyed to water',
    demand:
      'a shotgun load with enough pattern density and pellet energy for a crossing shot at range',
  },
  yellowbill_duck: {
    nature:
      'is a fast, wary duck of dams and vleis, often decoyed or jumped at close range',
    demand: 'a shotgun pattern that reaches a moving bird cleanly over water',
  },
  egyptian_goose: {
    nature:
      'is a large, heavy-bodied goose of dams and riverbanks, often taken on the wing or at the water\u2019s edge',
    demand:
      'a dense shotgun pattern with enough pellet energy for a big, tough bird',
  },
};
