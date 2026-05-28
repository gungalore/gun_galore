/**
 * SA Biomes — curated reference data for the AI range estimator.
 *
 * Each biome entry includes:
 * - A coarse polygon boundary (SANBI biome map, simplified to ~5-20
 *   vertices for fast point-in-polygon testing)
 * - 15-20 characteristic reference plants with typical heights spanning
 *   ground cover, low shrubs, mid-canopy, and mature trees
 *
 * Source references:
 * - SANBI Biomes & Bioregions of South Africa (2018 revision)
 * - Trees of Southern Africa — Braam van Wyk & Piet van Wyk
 * - Field Guide to Trees of Southern Africa — Schmidt, Lötter & McCleland
 * - Mucina & Rutherford 2006: Vegetation of South Africa, Lesotho &
 *   Swaziland (the authoritative classification we follow)
 *
 * Plant heights are TYPICAL ranges, not extremes — the AI uses them as
 * reference scale, so the median height of mature specimens is the
 * useful number. "Knobthorn 5-12 m" means most adult knobthorns in the
 * Bushveld fall in that band; use it as a ruler.
 *
 * Coverage: 9 SANBI biomes. The "Savanna" biome is split into Bushveld
 * + Lowveld because they have notably different vegetation profiles
 * (knobthorn-dominated thornveld vs mopane-dominated lowveld) despite
 * sharing the savanna classification, and SA hunters work in both
 * with different practical considerations.
 *
 * Polygon boundaries are HAND-DIGITISED APPROXIMATIONS — coarse enough
 * to classify the great majority of hunting locations correctly without
 * pretending to be GIS-precision shapefiles. Edge cases (biome
 * transition zones, narrow corridors, isolated forest patches) may
 * resolve to a neighbour or to no-match; we accept that — the AI
 * gracefully falls back to a generic prompt when biome=null.
 *
 * Array ORDER MATTERS: BiomeLookupService walks this list and returns
 * the first polygon containing the GPS point. So smaller/more-specific
 * biomes (Forest, Lowveld) must come BEFORE the larger fall-through
 * biomes (Bushveld, Nama-Karoo) — otherwise a Kruger location would
 * incorrectly resolve to Bushveld before the Lowveld polygon is tested.
 */

/** Where in the vertical profile a plant sits — used to tell the AI
 *  "look low / mid / high" when anchoring scale. */
export type PlantLayer = 'ground' | 'shrub' | 'mid-canopy' | 'tree';

export type PlantReference = {
  /** Scientific binomial, e.g. "Senegalia nigrescens". Most precise
   *  identifier; survives common-name disagreements between regions. */
  scientific: string;
  /** English common name, e.g. "Knobthorn". */
  english: string;
  /** Afrikaans common name, e.g. "Knoppiesdoring". */
  afrikaans: string;
  /** Typical height range in metres for mature specimens. */
  heightM: { min: number; max: number };
  /** Optional canopy diameter for mature specimens (metres). Useful
   *  when the AI sees a top-down or side-on tree as a width reference. */
  canopyM?: { min: number; max: number };
  /** Vertical layer this plant occupies. */
  layer: PlantLayer;
  /** Optional one-line description ("evergreen", "umbrella crown",
   *  "thorny", "blooms yellow Oct-Nov") — surfaced to the AI so it can
   *  distinguish similar-looking species and pick the right reference. */
  notes?: string;
};

export type BiomeProfile = {
  /** Stable identifier — used in logs and persisted in RangeEstimate
   *  rows so we can later correlate accuracy with biome. */
  id: string;
  /** Human-readable name, e.g. "Bushveld (Limpopo savanna)". */
  name: string;
  /** Short description injected into the AI's system prompt — what
   *  the biome looks like at a glance and how to use it as context. */
  description: string;
  /** Reference plants — 15-20 entries, mix of vertical layers. */
  plants: PlantReference[];
  /** One or more polygon boundaries — biome matches if ANY of these
   *  contain the GPS point. SA biomes are often non-contiguous (e.g.
   *  Succulent Karoo = Namaqualand + Klein Karoo), so multi-polygon
   *  support keeps each biome as a single semantic entity even when
   *  its geography splits across separate basins.
   *
   *  Each polygon is a closed ring of [lat, lng] pairs (last vertex
   *  need not duplicate the first). Negative lat for southern
   *  hemisphere, positive lng for eastern hemisphere (SA). */
  boundaries: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
};

// ─── Biome 1: Forest (Knysna-Tsitsikamma) ───────────────────────────
// Very small biome — afromontane forest patches along the southern
// Cape coast. Most SA hunters don't hunt here (it's mostly National
// Park) but we include it for completeness so a GPS point in the
// Garden Route doesn't fall through to a wrong neighbouring biome.

const FOREST: BiomeProfile = {
  id: 'forest-knysna-tsitsikamma',
  name: 'Afromontane Forest (Knysna-Tsitsikamma)',
  description:
    'Dense indigenous forest in narrow coastal/escarpment patches along the southern Cape. Tall closed canopy, dim understorey, ferns dominant on the floor. Iconic species: Outeniqua yellowwood, real yellowwood, stinkwood. Rare for hunting; included for GPS edge cases in the Garden Route region.',
  plants: [
    {
      scientific: 'Afrocarpus falcatus',
      english: 'Outeniqua yellowwood',
      afrikaans: 'Outeniqua-geelhout',
      heightM: { min: 25, max: 40 },
      canopyM: { min: 10, max: 20 },
      layer: 'tree',
      notes: 'Massive canopy tree — landmark scale anchor in Knysna forest',
    },
    {
      scientific: 'Podocarpus latifolius',
      english: 'Real yellowwood',
      afrikaans: 'Opregte geelhout',
      heightM: { min: 15, max: 25 },
      layer: 'tree',
      notes: 'SA national tree, evergreen conifer',
    },
    {
      scientific: 'Ocotea bullata',
      english: 'Stinkwood',
      afrikaans: 'Stinkhout',
      heightM: { min: 15, max: 25 },
      layer: 'tree',
    },
    {
      scientific: 'Ekebergia capensis',
      english: 'Cape ash',
      afrikaans: 'Essenhout',
      heightM: { min: 10, max: 20 },
      layer: 'tree',
    },
    {
      scientific: 'Rapanea melanophloeos',
      english: 'Cape beech',
      afrikaans: 'Boekenhout',
      heightM: { min: 5, max: 15 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Ilex mitis',
      english: 'Cape holly',
      afrikaans: 'Without',
      heightM: { min: 4, max: 12 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Curtisia dentata',
      english: 'Assegai tree',
      afrikaans: 'Assegaai',
      heightM: { min: 8, max: 18 },
      layer: 'tree',
    },
    {
      scientific: 'Olea capensis',
      english: 'Black ironwood',
      afrikaans: 'Swart ysterhout',
      heightM: { min: 10, max: 18 },
      layer: 'tree',
      notes: 'Very dense wood, slow-growing',
    },
    {
      scientific: 'Cunonia capensis',
      english: 'Red alder',
      afrikaans: 'Rooi-els',
      heightM: { min: 5, max: 15 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Burchellia bubalina',
      english: 'Wild pomegranate',
      afrikaans: 'Wildegranaat',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Trichocladus crinitus',
      english: 'White witch-hazel',
      afrikaans: 'Onderbos',
      heightM: { min: 1, max: 4 },
      layer: 'shrub',
    },
    {
      scientific: 'Pteridium aquilinum',
      english: 'Bracken fern',
      afrikaans: 'Adelaarsvaring',
      heightM: { min: 0.5, max: 1.5 },
      layer: 'ground',
    },
    {
      scientific: 'Cyathea capensis',
      english: 'Forest tree fern',
      afrikaans: 'Boomvaring',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
      notes: 'Distinctive trunk + crown — iconic understorey ruler',
    },
    {
      scientific: 'Diospyros whyteana',
      english: 'Bladder-nut',
      afrikaans: 'Swartbas',
      heightM: { min: 2, max: 6 },
      layer: 'shrub',
    },
    {
      scientific: 'Halleria lucida',
      english: 'Tree fuchsia',
      afrikaans: 'Notsung',
      heightM: { min: 3, max: 10 },
      layer: 'mid-canopy',
    },
  ],
  // Narrow strip along the Knysna + Tsitsikamma indigenous forest
  // belt. Deliberately tight so George (which is in fynbos transition,
  // not forest proper) doesn't fall through here.
  boundaries: [
    [
      [-33.97, 22.85],
      [-33.97, 24.40],
      [-34.05, 24.40],
      [-34.05, 22.85],
    ],
  ],
};

// ─── Biome 2: Lowveld (Kruger / Eastern escarpment lowlands) ────────
// Hot, low-altitude savanna east of the Drakensberg. Mopane-dominated
// in the north (Kruger), more mixed in the south. This is what most
// people picture as "African bush" — open canopy, baobabs, marulas,
// dense Combretum thickets.

const LOWVELD: BiomeProfile = {
  id: 'lowveld-savanna',
  name: 'Lowveld (Eastern savanna)',
  description:
    'Hot, low-altitude (200-600 m) savanna east of the Drakensberg escarpment. Mopane shrubveld dominates the north (Limpopo/N Kruger); mixed broad-leaved + thornveld in the south (S Kruger, Sabi Sand, Eastern Mpumalanga). Open canopy, well-spaced large trees over knee-high grass. Iconic species: marula, baobab, mopane, jackalberry, sausage tree, knobthorn.',
  plants: [
    {
      scientific: 'Colophospermum mopane',
      english: 'Mopane',
      afrikaans: 'Mopanie',
      heightM: { min: 4, max: 12 },
      canopyM: { min: 3, max: 8 },
      layer: 'tree',
      notes:
        'Often in stunted shrub form (1.5-3 m, "mopane shrubveld") in the north — dominant cover species there',
    },
    {
      scientific: 'Sclerocarya birrea',
      english: 'Marula',
      afrikaans: 'Maroela',
      heightM: { min: 8, max: 15 },
      canopyM: { min: 8, max: 15 },
      layer: 'tree',
      notes: 'Rounded canopy, very distinctive — iconic lowveld scale anchor',
    },
    {
      scientific: 'Adansonia digitata',
      english: 'Baobab',
      afrikaans: 'Kremetart',
      heightM: { min: 10, max: 20 },
      canopyM: { min: 10, max: 25 },
      layer: 'tree',
      notes: 'Massive swollen trunk — landmark scale, mainly N Kruger / Limpopo',
    },
    {
      scientific: 'Senegalia nigrescens',
      english: 'Knobthorn',
      afrikaans: 'Knoppiesdoring',
      heightM: { min: 5, max: 12 },
      canopyM: { min: 4, max: 8 },
      layer: 'tree',
      notes: 'Knobby thorns on trunk; flat-top crown when mature',
    },
    {
      scientific: 'Diospyros mespiliformis',
      english: 'Jackalberry',
      afrikaans: 'Jakkalsbessie',
      heightM: { min: 10, max: 20 },
      canopyM: { min: 8, max: 15 },
      layer: 'tree',
      notes: 'Tall riverine tree, dense dark-green crown',
    },
    {
      scientific: 'Kigelia africana',
      english: 'Sausage tree',
      afrikaans: 'Worsboom',
      heightM: { min: 8, max: 15 },
      canopyM: { min: 6, max: 12 },
      layer: 'tree',
      notes: 'Hanging sausage-shaped fruit unmistakable',
    },
    {
      scientific: 'Spirostachys africana',
      english: 'Tamboti',
      afrikaans: 'Tambotie',
      heightM: { min: 6, max: 12 },
      layer: 'tree',
    },
    {
      scientific: 'Combretum imberbe',
      english: 'Leadwood',
      afrikaans: 'Hardekool',
      heightM: { min: 8, max: 15 },
      canopyM: { min: 8, max: 12 },
      layer: 'tree',
      notes: 'Very heavy wood; pale grey bark, twisted trunk',
    },
    {
      scientific: 'Philenoptera violacea',
      english: 'Apple-leaf / Rain tree',
      afrikaans: 'Appelblaar',
      heightM: { min: 5, max: 12 },
      layer: 'tree',
    },
    {
      scientific: 'Combretum apiculatum',
      english: 'Red bushwillow',
      afrikaans: 'Rooibos',
      heightM: { min: 3, max: 8 },
      layer: 'mid-canopy',
      notes: 'Bushveld + lowveld common; dense canopy thickets',
    },
    {
      scientific: 'Combretum hereroense',
      english: 'Russet bushwillow',
      afrikaans: 'Kierieklapper',
      heightM: { min: 3, max: 7 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Senegalia mellifera',
      english: 'Black thorn',
      afrikaans: 'Swarthaak',
      heightM: { min: 2, max: 6 },
      layer: 'mid-canopy',
      notes: 'Dense impenetrable thickets',
    },
    {
      scientific: 'Dichrostachys cinerea',
      english: 'Sickle bush',
      afrikaans: 'Sekelbos',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
      notes: 'Pink + yellow "Chinese lantern" flowers',
    },
    {
      scientific: 'Grewia bicolor',
      english: 'White raisin',
      afrikaans: 'Witrosyntjie',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Panicum maximum',
      english: 'Guinea grass',
      afrikaans: 'Buffelsgras',
      heightM: { min: 0.6, max: 2 },
      layer: 'ground',
      notes: 'Tall tussocky grass — common reference for animal leg height',
    },
    {
      scientific: 'Themeda triandra',
      english: 'Red grass / Rooigras',
      afrikaans: 'Rooigras',
      heightM: { min: 0.4, max: 1 },
      layer: 'ground',
      notes: 'Dominant Lowveld grazing grass',
    },
    {
      scientific: 'Heteropogon contortus',
      english: 'Spear grass',
      afrikaans: 'Assegaaigras',
      heightM: { min: 0.3, max: 0.8 },
      layer: 'ground',
    },
  ],
  // East of the Drakensberg escarpment from N Kruger down to S Kruger
  // / Eastern Mpumalanga. Coastal Belt is tested AFTER this so the
  // narrow KZN strip catches its part separately.
  boundaries: [
    [
      [-22.0, 30.5],
      [-22.0, 32.0],
      [-26.0, 32.0],
      [-27.0, 31.7],
      [-26.5, 30.5],
    ],
  ],
};

// ─── Biome 3: Indian Ocean Coastal Belt (KZN coastal + E Cape NE) ───
// Narrow hot-humid coastal strip on the Indian Ocean side, characterised
// by coastal forests and subtropical thickets blending into savanna.

const COASTAL_BELT: BiomeProfile = {
  id: 'indian-ocean-coastal-belt',
  name: 'Indian Ocean Coastal Belt (KZN/E Cape coastal)',
  description:
    'Narrow hot-humid coastal strip — coastal forest patches, subtropical thickets, dune forests, mangroves at river mouths. Blends inland into savanna. Iconic species: coastal red milkwood, wild banana, Natal fig, coral tree. Hunting common in KZN thornveld inland of the coastal belt; the belt itself is largely conservation/agricultural.',
  plants: [
    {
      scientific: 'Mimusops caffra',
      english: 'Coastal red milkwood',
      afrikaans: 'Kusrooimelkhout',
      heightM: { min: 5, max: 15 },
      canopyM: { min: 4, max: 10 },
      layer: 'tree',
      notes: 'Dominant dune-forest tree along KZN coast',
    },
    {
      scientific: 'Strelitzia nicolai',
      english: 'Wild banana',
      afrikaans: 'Wildepiesang',
      heightM: { min: 6, max: 12 },
      layer: 'mid-canopy',
      notes: 'Tall fan of huge leaves on bare trunk — iconic shape',
    },
    {
      scientific: 'Ficus natalensis',
      english: 'Natal fig',
      afrikaans: 'Natalse vy',
      heightM: { min: 10, max: 20 },
      canopyM: { min: 10, max: 20 },
      layer: 'tree',
      notes: 'Spreading evergreen canopy, often with aerial roots',
    },
    {
      scientific: 'Erythrina caffra',
      english: 'Coast coral tree',
      afrikaans: 'Kuskoraalboom',
      heightM: { min: 8, max: 15 },
      layer: 'tree',
      notes: 'Brilliant red flowers in spring',
    },
    {
      scientific: 'Sideroxylon inerme',
      english: 'White milkwood',
      afrikaans: 'Witmelkhout',
      heightM: { min: 5, max: 12 },
      layer: 'tree',
      notes: 'Coastal, very salt-tolerant',
    },
    {
      scientific: 'Sclerocarya birrea',
      english: 'Marula',
      afrikaans: 'Maroela',
      heightM: { min: 8, max: 15 },
      canopyM: { min: 8, max: 15 },
      layer: 'tree',
    },
    {
      scientific: 'Albizia adianthifolia',
      english: 'Flat-crown',
      afrikaans: 'Platkroon',
      heightM: { min: 10, max: 20 },
      canopyM: { min: 10, max: 20 },
      layer: 'tree',
      notes: 'Distinctive flat umbrella crown — excellent silhouette ruler',
    },
    {
      scientific: 'Spirostachys africana',
      english: 'Tamboti',
      afrikaans: 'Tambotie',
      heightM: { min: 6, max: 12 },
      layer: 'tree',
    },
    {
      scientific: 'Croton sylvaticus',
      english: 'Forest fever-berry',
      afrikaans: 'Bosboerboon',
      heightM: { min: 6, max: 15 },
      layer: 'tree',
    },
    {
      scientific: 'Brachylaena discolor',
      english: 'Coast silver-oak',
      afrikaans: 'Kus-vaalbos',
      heightM: { min: 4, max: 10 },
      layer: 'mid-canopy',
      notes: 'Silver underleaves — common in coastal forest understory',
    },
    {
      scientific: 'Dodonaea viscosa',
      english: 'Sandolien',
      afrikaans: 'Sandolien',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Carissa macrocarpa',
      english: 'Big num-num',
      afrikaans: 'Groot noem-noem',
      heightM: { min: 1.5, max: 4 },
      layer: 'shrub',
      notes: 'Spiny coastal shrub with red fruit',
    },
    {
      scientific: 'Themeda triandra',
      english: 'Red grass',
      afrikaans: 'Rooigras',
      heightM: { min: 0.4, max: 1 },
      layer: 'ground',
    },
    {
      scientific: 'Panicum maximum',
      english: 'Guinea grass',
      afrikaans: 'Buffelsgras',
      heightM: { min: 0.6, max: 2 },
      layer: 'ground',
    },
    {
      scientific: 'Cynodon dactylon',
      english: 'Couch grass',
      afrikaans: 'Kweekgras',
      heightM: { min: 0.1, max: 0.3 },
      layer: 'ground',
    },
  ],
  // Narrow coastal strip — KZN coastline from Mozambique border down
  // to East Cape NE. Width is roughly 50-100 km inland. Polygon hugs
  // the coast; Coastal Belt is tested before Albany Thicket so the
  // coastal strip catches its share before E Cape interior takes over.
  boundaries: [
    [
      [-27.0, 32.5],
      [-28.5, 32.7],
      [-29.5, 31.5],
      [-31.0, 30.5],
      [-32.5, 28.5],
      [-33.0, 27.0],
      [-32.0, 27.5],
      [-31.0, 29.5],
      [-29.5, 30.5],
      [-28.0, 31.5],
    ],
  ],
};

// ─── Biome 4: Albany Thicket (E Cape interior) ──────────────────────
// Dense spekboom-dominated thicket between Karoo + Fynbos + Coastal
// Belt in the Eastern Cape. Thorny, semi-succulent, near-impenetrable
// in places. Major hunting biome for Eastern Cape outfitters.

const ALBANY_THICKET: BiomeProfile = {
  id: 'albany-thicket',
  name: 'Albany Thicket (E Cape semi-succulent thicket)',
  description:
    "Dense semi-succulent thicket dominated by spekboom (Portulacaria afra), interspersed with thorny shrubs, euphorbias, and small trees. Largely impenetrable in mature form (2-4 m thicket); transitions to open valleys with sweet thorn. Eastern Cape's iconic biome — kudu, bushbuck, common duiker, warthog territory.",
  plants: [
    {
      scientific: 'Portulacaria afra',
      english: 'Spekboom / Elephants food',
      afrikaans: 'Spekboom',
      heightM: { min: 1.5, max: 4 },
      canopyM: { min: 2, max: 6 },
      layer: 'shrub',
      notes: 'Dominant succulent shrub-tree, dense thicket-forming — THE Albany Thicket species',
    },
    {
      scientific: 'Schotia afra',
      english: 'Karoo boer-bean',
      afrikaans: 'Karoo-boerboon',
      heightM: { min: 3, max: 6 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Schotia latifolia',
      english: 'Bush boer-bean',
      afrikaans: 'Bosboerboon',
      heightM: { min: 4, max: 10 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Vachellia karroo',
      english: 'Sweet thorn',
      afrikaans: 'Soetdoring',
      heightM: { min: 3, max: 8 },
      canopyM: { min: 4, max: 8 },
      layer: 'mid-canopy',
      notes: 'Yellow puffball flowers Oct-Dec, fine bipinnate leaves',
    },
    {
      scientific: 'Sideroxylon inerme',
      english: 'White milkwood',
      afrikaans: 'Witmelkhout',
      heightM: { min: 5, max: 12 },
      layer: 'tree',
    },
    {
      scientific: 'Pappea capensis',
      english: 'Jacket plum / Doppruim',
      afrikaans: 'Doppruim',
      heightM: { min: 4, max: 10 },
      layer: 'tree',
    },
    {
      scientific: 'Euclea undulata',
      english: 'Common guarri',
      afrikaans: 'Gewone ghwarrie',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Euphorbia tetragona',
      english: 'Honey-thorn euphorbia',
      afrikaans: 'Naboom',
      heightM: { min: 3, max: 10 },
      layer: 'mid-canopy',
      notes: 'Candelabra-shaped succulent — iconic shape',
    },
    {
      scientific: 'Aloe ferox',
      english: 'Bitter aloe / Cape aloe',
      afrikaans: 'Bitteraalwyn',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
      notes: 'Single tall stem with rosette of leaves; iconic on hillsides',
    },
    {
      scientific: 'Carissa bispinosa',
      english: 'Forest num-num',
      afrikaans: 'Bosnoem-noem',
      heightM: { min: 1, max: 3 },
      layer: 'shrub',
    },
    {
      scientific: 'Gymnosporia buxifolia',
      english: 'Common spike-thorn',
      afrikaans: 'Gewone pendoring',
      heightM: { min: 2, max: 6 },
      layer: 'shrub',
    },
    {
      scientific: 'Ehretia rigida',
      english: 'Puzzle bush',
      afrikaans: 'Deurmekaarbos',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Searsia longispina',
      english: 'Spiny karee',
      afrikaans: 'Doring-karee',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Cussonia spicata',
      english: 'Common cabbage tree',
      afrikaans: 'Gewone kiepersol',
      heightM: { min: 3, max: 8 },
      layer: 'mid-canopy',
      notes: 'Bare trunk + tuft of large leaves — distinctive silhouette',
    },
    {
      scientific: 'Themeda triandra',
      english: 'Red grass',
      afrikaans: 'Rooigras',
      heightM: { min: 0.4, max: 1 },
      layer: 'ground',
    },
    {
      scientific: 'Sporobolus fimbriatus',
      english: 'Dropseed',
      afrikaans: 'Fynsaadgras',
      heightM: { min: 0.3, max: 0.8 },
      layer: 'ground',
    },
  ],
  // Eastern Cape interior — bounded west by the Karoo, east by KZN
  // coastal belt, south by the Outeniqua/Tsitsikamma fynbos. Includes
  // Grahamstown, Cradock, parts of the Sundays River valley.
  boundaries: [
    [
      [-32.0, 23.5],
      [-32.0, 27.5],
      [-33.5, 27.5],
      [-34.0, 26.0],
      [-33.5, 23.5],
    ],
  ],
};

// ─── Biome 5: Fynbos (Cape floristic region) ────────────────────────
// Mediterranean climate evergreen heathland on the Cape mountains +
// southern coast. NO TALL TREES in pure fynbos — restios + proteas +
// ericas dominate. Important to convey to the AI that "no big tree
// references" is normal here, not an error.

const FYNBOS: BiomeProfile = {
  id: 'fynbos',
  name: 'Fynbos (Cape floristic region)',
  description:
    'Mediterranean-climate evergreen heathland on Cape mountains + south coast — restios + proteas + ericas + buchu. CRUCIAL: pure fynbos has NO tall trees and very few mid-canopy species. Reference scale comes from shrub-layer (mostly 0.5-2 m). Tall trees in this region are invasive (pine, gum) and unreliable as native scale anchors. Mountain hunting: klipspringer, grey rhebok, common duiker. Limited big-game hunting.',
  plants: [
    {
      scientific: 'Protea cynaroides',
      english: 'King protea',
      afrikaans: 'Koningsprotea',
      heightM: { min: 1, max: 2 },
      canopyM: { min: 1, max: 2 },
      layer: 'shrub',
      notes: 'Massive bowl-shaped flower head, SA national flower',
    },
    {
      scientific: 'Protea repens',
      english: 'Common sugarbush',
      afrikaans: 'Gewone suikerbos',
      heightM: { min: 1.5, max: 3 },
      layer: 'shrub',
    },
    {
      scientific: 'Protea nitida',
      english: 'Waboom',
      afrikaans: 'Waboom',
      heightM: { min: 3, max: 8 },
      layer: 'mid-canopy',
      notes:
        'Tallest fynbos protea — one of the few quasi-tree-sized species in pure fynbos',
    },
    {
      scientific: 'Leucadendron argenteum',
      english: 'Silver tree',
      afrikaans: 'Silwerboom',
      heightM: { min: 5, max: 10 },
      layer: 'mid-canopy',
      notes: 'Cape Peninsula endemic; silvery leaves catch light',
    },
    {
      scientific: 'Leucadendron salignum',
      english: 'Common sunshine conebush',
      afrikaans: 'Geelbos',
      heightM: { min: 0.5, max: 2 },
      layer: 'shrub',
    },
    {
      scientific: 'Erica plukenetii',
      english: 'Hangertjie heath',
      afrikaans: 'Hangertjie',
      heightM: { min: 0.3, max: 1 },
      layer: 'shrub',
    },
    {
      scientific: 'Erica cerinthoides',
      english: 'Fire heath',
      afrikaans: 'Vuurheide',
      heightM: { min: 0.5, max: 1.5 },
      layer: 'shrub',
    },
    {
      scientific: 'Agathosma betulina',
      english: 'Round-leaf buchu',
      afrikaans: 'Rondeblaarboegoe',
      heightM: { min: 0.3, max: 1 },
      layer: 'shrub',
      notes: 'Aromatic, blackcurrant scent when crushed',
    },
    {
      scientific: 'Elegia tectorum',
      english: 'Cape thatching reed',
      afrikaans: 'Dekriet',
      heightM: { min: 1, max: 2 },
      layer: 'shrub',
      notes: 'Restio — tall reed-like stems, dense tussocks',
    },
    {
      scientific: 'Cannomois virgata',
      english: 'Bell reed',
      afrikaans: 'Belriet',
      heightM: { min: 1, max: 2.5 },
      layer: 'shrub',
      notes: 'Large restio with feathery seed heads',
    },
    {
      scientific: 'Restio quadratus',
      english: 'Cape restio',
      afrikaans: 'Bergriet',
      heightM: { min: 0.5, max: 1.5 },
      layer: 'shrub',
    },
    {
      scientific: 'Widdringtonia nodiflora',
      english: 'Mountain cypress',
      afrikaans: 'Bergsipres',
      heightM: { min: 3, max: 10 },
      layer: 'mid-canopy',
      notes: 'One of few indigenous fynbos conifers; survives fire',
    },
    {
      scientific: 'Olea europaea subsp. africana',
      english: 'Wild olive',
      afrikaans: 'Olienhout',
      heightM: { min: 3, max: 8 },
      layer: 'mid-canopy',
      notes: 'Common in transition zones to renosterveld',
    },
    {
      scientific: 'Cliffortia ruscifolia',
      english: 'Common climbers-friend',
      afrikaans: 'Steekspekbos',
      heightM: { min: 0.5, max: 1.5 },
      layer: 'shrub',
    },
    {
      scientific: 'Pelargonium cucullatum',
      english: 'Hooded-leaf pelargonium',
      afrikaans: 'Wildemalva',
      heightM: { min: 0.5, max: 1.5 },
      layer: 'shrub',
    },
  ],
  // SW Cape mountains + southern coast. Tested LAST among the southern
  // biomes so Forest, Albany Thicket, and Succulent Karoo (Klein Karoo
  // + Namaqualand) catch their enclaves first; whatever's left in the
  // SW Cape belongs to Fynbos.
  boundaries: [
    [
      [-31.5, 17.5],
      [-31.5, 20.0],
      [-33.0, 22.0],
      [-33.5, 24.5],
      [-34.0, 26.0],
      [-34.85, 26.0],
      [-34.85, 17.5],
    ],
  ],
};

// ─── Biome 6: Succulent Karoo (Klein Karoo + Namaqualand) ───────────
// Winter-rainfall semi-desert with extraordinary succulent diversity.
// Spring flower displays in Namaqualand. Smaller and lower than the
// Great Karoo.

const SUCCULENT_KAROO: BiomeProfile = {
  id: 'succulent-karoo',
  name: 'Succulent Karoo (Klein Karoo + Namaqualand)',
  description:
    'Winter-rainfall semi-desert (~150-300 mm/yr) — dwarf succulent shrubs (mesembs, crassulas, euphorbias), low Karoo bossies, scattered quiver trees (north) and spekboom (east). Few mature trees outside of drainage lines. Iconic spring flower displays. Hunting: gemsbok, springbok, klipspringer, kudu.',
  plants: [
    {
      scientific: 'Aloidendron dichotomum',
      english: 'Quiver tree',
      afrikaans: 'Kokerboom',
      heightM: { min: 3, max: 8 },
      canopyM: { min: 3, max: 6 },
      layer: 'tree',
      notes:
        'Iconic Namaqualand — single trunk + spreading branched crown; unmistakable silhouette',
    },
    {
      scientific: 'Portulacaria afra',
      english: 'Spekboom',
      afrikaans: 'Spekboom',
      heightM: { min: 1, max: 3 },
      layer: 'shrub',
      notes: 'More compact form here than in Albany Thicket',
    },
    {
      scientific: 'Vachellia karroo',
      english: 'Sweet thorn',
      afrikaans: 'Soetdoring',
      heightM: { min: 2, max: 6 },
      layer: 'mid-canopy',
      notes: 'Drainage-line specialist in Karoo regions',
    },
    {
      scientific: 'Searsia lancea',
      english: 'Karee',
      afrikaans: 'Karee',
      heightM: { min: 4, max: 9 },
      canopyM: { min: 5, max: 10 },
      layer: 'tree',
      notes: 'River + drainage tree; weeping crown',
    },
    {
      scientific: 'Cotyledon orbiculata',
      english: 'Pig\'s ear',
      afrikaans: 'Plakkie / Botterboom',
      heightM: { min: 0.3, max: 1.2 },
      layer: 'shrub',
      notes: 'Succulent paddle leaves',
    },
    {
      scientific: 'Tylecodon paniculatus',
      english: 'Botterboom',
      afrikaans: 'Botterboom',
      heightM: { min: 0.5, max: 2 },
      layer: 'shrub',
      notes: 'Thick yellow-green stems, deciduous',
    },
    {
      scientific: 'Lampranthus spp.',
      english: 'Vygies',
      afrikaans: 'Vygies',
      heightM: { min: 0.1, max: 0.4 },
      layer: 'ground',
      notes: 'Carpet of magenta + pink + yellow in spring',
    },
    {
      scientific: 'Mesembryanthemum spp.',
      english: 'Ice plants / Vygies',
      afrikaans: 'Vygies',
      heightM: { min: 0.05, max: 0.3 },
      layer: 'ground',
    },
    {
      scientific: 'Aloe ferox',
      english: 'Bitter aloe',
      afrikaans: 'Bitteraalwyn',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
      notes: 'Single stem + crown rosette',
    },
    {
      scientific: 'Aloe striata',
      english: 'Coral aloe',
      afrikaans: 'Korale-aalwyn',
      heightM: { min: 0.3, max: 1 },
      layer: 'shrub',
    },
    {
      scientific: 'Pentzia incana',
      english: 'Ankerkaroo',
      afrikaans: 'Ankerkaroo',
      heightM: { min: 0.3, max: 0.8 },
      layer: 'shrub',
      notes: 'Important grazing dwarf shrub',
    },
    {
      scientific: 'Pteronia incana',
      english: 'Blue bush',
      afrikaans: 'Blou-bossie',
      heightM: { min: 0.3, max: 1 },
      layer: 'shrub',
    },
    {
      scientific: 'Euphorbia mauritanica',
      english: 'Pencil milk-bush',
      afrikaans: 'Geel-noors',
      heightM: { min: 0.5, max: 2 },
      layer: 'shrub',
      notes: 'Pencil-thin green succulent stems',
    },
    {
      scientific: 'Eriocephalus africanus',
      english: 'Wild rosemary / Kapok bush',
      afrikaans: 'Kapokbos',
      heightM: { min: 0.4, max: 1.2 },
      layer: 'shrub',
      notes: 'Cotton-wool seed heads',
    },
    {
      scientific: 'Stipagrostis ciliata',
      english: 'Tall bushman grass',
      afrikaans: 'Boesmangras',
      heightM: { min: 0.3, max: 0.9 },
      layer: 'ground',
    },
  ],
  // Two non-contiguous polygons — Succulent Karoo is geographically
  // split between Namaqualand (NW Cape coastal arid) and the Klein
  // Karoo (between the Swartberg and Outeniqua mountains). Same plant
  // ecology in both regions; one biome, two polygons.
  boundaries: [
    // Namaqualand — NW Cape coastal arid
    [
      [-28.0, 17.0],
      [-28.0, 19.0],
      [-32.0, 19.0],
      [-32.0, 17.0],
    ],
    // Klein Karoo — enclosed basin between Swartberg + Outeniqua ranges
    [
      [-33.3, 20.0],
      [-33.3, 24.0],
      [-33.85, 24.0],
      [-33.85, 20.0],
    ],
  ],
};

// ─── Biome 7: Kalahari (NW Cape / western savanna) ──────────────────
// Red-sand semi-desert savanna in NW Cape, blending into Botswana.
// Camel thorn + shepherd's tree + brandybush + bushman grass. Distinctive
// red dunes and well-spaced trees.

const KALAHARI: BiomeProfile = {
  id: 'kalahari-savanna',
  name: 'Kalahari (Northern Cape semi-arid savanna)',
  description:
    "Red-sand semi-arid savanna of NW Cape into Botswana. Well-spaced camel thorns + shepherd's trees over sparse bushman grass on red Kalahari sand. Sky is the dominant visual; trees stand alone on the horizon. Hunting: gemsbok, springbok, eland, blue wildebeest. Distinctive low + clear horizon makes reference scaling clean — a camel thorn 12 m tall is usually the tallest object for kilometres.",
  plants: [
    {
      scientific: 'Vachellia erioloba',
      english: 'Camel thorn',
      afrikaans: 'Kameeldoring',
      heightM: { min: 8, max: 17 },
      canopyM: { min: 10, max: 18 },
      layer: 'tree',
      notes:
        'Iconic Kalahari tree — massive umbrella crown, stands alone in red sand. Excellent scale anchor.',
    },
    {
      scientific: 'Boscia albitrunca',
      english: "Shepherd's tree",
      afrikaans: 'Witgat',
      heightM: { min: 4, max: 9 },
      canopyM: { min: 5, max: 12 },
      layer: 'tree',
      notes: 'Pale-white smooth bark on trunk, dense dark-green crown — silhouette landmark',
    },
    {
      scientific: 'Combretum imberbe',
      english: 'Leadwood',
      afrikaans: 'Hardekool',
      heightM: { min: 8, max: 15 },
      layer: 'tree',
    },
    {
      scientific: 'Senegalia mellifera',
      english: 'Black thorn',
      afrikaans: 'Swarthaak',
      heightM: { min: 2, max: 6 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Senegalia luederitzii',
      english: 'False umbrella thorn',
      afrikaans: 'Bastersambreelboom',
      heightM: { min: 4, max: 10 },
      layer: 'tree',
    },
    {
      scientific: 'Senegalia hebeclada',
      english: 'Candle-pod thorn',
      afrikaans: 'Trassiebos',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Vachellia hebeclada',
      english: 'Trassie / Candle thorn',
      afrikaans: 'Trassiebos',
      heightM: { min: 1.5, max: 4 },
      layer: 'shrub',
    },
    {
      scientific: 'Grewia flava',
      english: 'Brandybush',
      afrikaans: 'Brandybos',
      heightM: { min: 2, max: 4 },
      layer: 'shrub',
      notes: 'Edible berry, very common Kalahari understorey',
    },
    {
      scientific: 'Rhigozum trichotomum',
      english: 'Three-thorn',
      afrikaans: 'Driedoring',
      heightM: { min: 1, max: 2.5 },
      layer: 'shrub',
      notes: 'Stiff three-pronged twigs, yellow flowers',
    },
    {
      scientific: 'Combretum apiculatum',
      english: 'Red bushwillow',
      afrikaans: 'Rooibos',
      heightM: { min: 3, max: 8 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Stipagrostis uniplumis',
      english: 'Silky bushman grass',
      afrikaans: 'Boesmangras',
      heightM: { min: 0.4, max: 0.9 },
      layer: 'ground',
      notes: 'Dominant Kalahari grazing grass — defines the landscape',
    },
    {
      scientific: 'Stipagrostis ciliata',
      english: 'Tall bushman grass',
      afrikaans: 'Langbeen-boesmangras',
      heightM: { min: 0.6, max: 1.2 },
      layer: 'ground',
    },
    {
      scientific: 'Schmidtia kalahariensis',
      english: 'Kalahari sour grass',
      afrikaans: 'Suurgras',
      heightM: { min: 0.3, max: 0.6 },
      layer: 'ground',
    },
    {
      scientific: 'Citrullus lanatus',
      english: 'Tsamma melon',
      afrikaans: 'Tsamma',
      heightM: { min: 0.1, max: 0.3 },
      layer: 'ground',
      notes: 'Trailing vine with watermelon-like fruit on the ground',
    },
    {
      scientific: 'Lycium hirsutum',
      english: 'Honey-thorn',
      afrikaans: 'Honingdoring',
      heightM: { min: 1, max: 2.5 },
      layer: 'shrub',
    },
  ],
  // NW Cape into Botswana. Red Kalahari sand, camel thorn savanna,
  // distinct from greener Bushveld further east.
  boundaries: [
    [
      [-24.0, 19.0],
      [-24.0, 24.0],
      [-26.0, 24.5],
      [-28.5, 23.5],
      [-29.0, 21.0],
      [-28.5, 19.0],
    ],
  ],
};

// ─── Biome 8: Bushveld (Northern savanna — Limpopo / NW / Mpumalanga
//                        plains, central Mpumalanga / N KZN bushveld) ─
// The classic plains-game biome. Mixed tall-tree savanna over knee-high
// grass; large landowner concessions; high diversity of antelope.

const BUSHVELD: BiomeProfile = {
  id: 'bushveld-savanna',
  name: 'Bushveld (Northern savanna)',
  description:
    'Classic plains-game savanna of Limpopo, NW Province, central Mpumalanga, N KZN. Well-spaced mid-canopy thornveld (knobthorn, sweet thorn, leadwood) over knee-to-waist-high grass with scattered bush thickets. Higher altitude + less hot than the Lowveld. Most diverse plains-game hunting biome in SA — kudu, impala, blue wildebeest, warthog, blesbok, eland.',
  plants: [
    {
      scientific: 'Senegalia nigrescens',
      english: 'Knobthorn',
      afrikaans: 'Knoppiesdoring',
      heightM: { min: 5, max: 12 },
      canopyM: { min: 4, max: 8 },
      layer: 'tree',
      notes: 'Bushveld flagship tree — flat-topped, knobby thorns on trunk',
    },
    {
      scientific: 'Sclerocarya birrea',
      english: 'Marula',
      afrikaans: 'Maroela',
      heightM: { min: 8, max: 15 },
      canopyM: { min: 8, max: 15 },
      layer: 'tree',
      notes: 'Rounded dense canopy; very distinctive shape',
    },
    {
      scientific: 'Combretum imberbe',
      english: 'Leadwood',
      afrikaans: 'Hardekool',
      heightM: { min: 8, max: 15 },
      canopyM: { min: 8, max: 12 },
      layer: 'tree',
    },
    {
      scientific: 'Combretum apiculatum',
      english: 'Red bushwillow',
      afrikaans: 'Rooibos',
      heightM: { min: 3, max: 8 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Combretum molle',
      english: 'Velvet bushwillow',
      afrikaans: 'Fluweelboswilg',
      heightM: { min: 4, max: 9 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Vachellia karroo',
      english: 'Sweet thorn',
      afrikaans: 'Soetdoring',
      heightM: { min: 3, max: 9 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Vachellia tortilis',
      english: 'Umbrella thorn',
      afrikaans: 'Haak-en-steek',
      heightM: { min: 4, max: 10 },
      canopyM: { min: 6, max: 12 },
      layer: 'tree',
      notes: 'Classic umbrella crown — flat-topped, very recognisable',
    },
    {
      scientific: 'Ziziphus mucronata',
      english: "Buffalo thorn / Wag-'n-bietjie",
      afrikaans: 'Wag-\'n-bietjie',
      heightM: { min: 2, max: 7 },
      layer: 'mid-canopy',
      notes: 'Paired thorns (one hooked, one straight); culturally significant',
    },
    {
      scientific: 'Dichrostachys cinerea',
      english: 'Sickle bush',
      afrikaans: 'Sekelbos',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Peltophorum africanum',
      english: 'Weeping wattle',
      afrikaans: 'Huilboom',
      heightM: { min: 5, max: 12 },
      layer: 'tree',
      notes: 'Yellow flowers; "weeping" droplets from spittle bugs',
    },
    {
      scientific: 'Philenoptera violacea',
      english: 'Apple-leaf',
      afrikaans: 'Appelblaar',
      heightM: { min: 5, max: 12 },
      layer: 'tree',
    },
    {
      scientific: 'Dombeya rotundifolia',
      english: 'Wild pear',
      afrikaans: 'Drolpeer',
      heightM: { min: 3, max: 6 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Senegalia mellifera',
      english: 'Black thorn',
      afrikaans: 'Swarthaak',
      heightM: { min: 2, max: 6 },
      layer: 'mid-canopy',
    },
    {
      scientific: 'Themeda triandra',
      english: 'Red grass',
      afrikaans: 'Rooigras',
      heightM: { min: 0.4, max: 1 },
      layer: 'ground',
      notes: 'Dominant bushveld grazing grass',
    },
    {
      scientific: 'Heteropogon contortus',
      english: 'Spear grass',
      afrikaans: 'Assegaaigras',
      heightM: { min: 0.3, max: 0.8 },
      layer: 'ground',
    },
    {
      scientific: 'Eragrostis curvula',
      english: 'Weeping love grass',
      afrikaans: 'Oulandsgras',
      heightM: { min: 0.4, max: 1 },
      layer: 'ground',
    },
    {
      scientific: 'Hyparrhenia hirta',
      english: 'Common thatching grass',
      afrikaans: 'Steekgras',
      heightM: { min: 0.6, max: 1.5 },
      layer: 'ground',
    },
  ],
  // Northern savanna — Limpopo, NW Province, north Gauteng, central
  // Mpumalanga bushveld. Southern boundary deliberately pulled up to
  // ~-25.5 so points in the Mpumalanga grassland (Ermelo, Volksrust)
  // fall through to Highveld instead. Eastern boundary stops before
  // Drakensberg escarpment — Lowveld owns the strip east of -30.5°E.
  boundaries: [
    [
      [-22.0, 25.0],
      [-22.0, 30.5],
      [-25.5, 30.5],
      [-25.5, 25.5],
      [-23.5, 25.0],
    ],
  ],
};

// ─── Biome 9: Highveld Grassland (interior plateau) ─────────────────
// The big open grassland plateau — Free State, Gauteng, parts of
// Mpumalanga + KZN highlands. Long shots over open ground; few trees
// in pure grassland (only along drainage + on rocky outcrops).

const HIGHVELD: BiomeProfile = {
  id: 'highveld-grassland',
  name: 'Highveld Grassland (interior plateau)',
  description:
    'Open rolling grassland of the central plateau (1200-1800 m altitude). FEW NATIVE TREES in open grassland — only along drainage lines or on rocky outcrops. Most "trees" are introduced eucalypts/pines (plantations) or jacarandas in towns; native woody references are scattered. Reference scale comes from grass + few drainage trees. Long-range hunting — blesbok, black wildebeest, springbok, mountain reedbuck.',
  plants: [
    {
      scientific: 'Themeda triandra',
      english: 'Red grass / Rooigras',
      afrikaans: 'Rooigras',
      heightM: { min: 0.4, max: 1 },
      layer: 'ground',
      notes: 'Dominant Highveld grass; red-brown seed heads in autumn',
    },
    {
      scientific: 'Hyparrhenia hirta',
      english: 'Common thatching grass',
      afrikaans: 'Steekgras',
      heightM: { min: 0.6, max: 1.5 },
      layer: 'ground',
      notes: 'Tall tussocks, useful for above-knee scale',
    },
    {
      scientific: 'Eragrostis curvula',
      english: 'Weeping love grass',
      afrikaans: 'Oulandsgras',
      heightM: { min: 0.4, max: 1.2 },
      layer: 'ground',
    },
    {
      scientific: 'Aristida congesta',
      english: 'Tassel three-awn',
      afrikaans: 'Katstertsteekgras',
      heightM: { min: 0.2, max: 0.7 },
      layer: 'ground',
    },
    {
      scientific: 'Cymbopogon plurinodis',
      english: 'Narrow-leaved turpentine grass',
      afrikaans: 'Terpentyngras',
      heightM: { min: 0.5, max: 1.2 },
      layer: 'ground',
    },
    {
      scientific: 'Searsia lancea',
      english: 'Karee',
      afrikaans: 'Karee',
      heightM: { min: 4, max: 9 },
      canopyM: { min: 5, max: 10 },
      layer: 'tree',
      notes: 'Drainage-line tree — weeping habit, evergreen',
    },
    {
      scientific: 'Vachellia karroo',
      english: 'Sweet thorn',
      afrikaans: 'Soetdoring',
      heightM: { min: 3, max: 8 },
      layer: 'mid-canopy',
      notes: 'Drainage + disturbed-land coloniser; encroaching in Highveld',
    },
    {
      scientific: 'Olea europaea subsp. africana',
      english: 'Wild olive',
      afrikaans: 'Olienhout',
      heightM: { min: 3, max: 9 },
      layer: 'mid-canopy',
      notes: 'Rocky-ridge tree; dense dark crown',
    },
    {
      scientific: 'Searsia pyroides',
      english: 'Common wild currant',
      afrikaans: 'Taaibos',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Leucosidea sericea',
      english: 'Oldwood',
      afrikaans: 'Ouhout',
      heightM: { min: 3, max: 7 },
      layer: 'mid-canopy',
      notes: 'High-altitude valleys; gnarled trunks',
    },
    {
      scientific: 'Cussonia paniculata',
      english: 'Mountain cabbage tree',
      afrikaans: 'Bergkiepersol',
      heightM: { min: 3, max: 8 },
      layer: 'mid-canopy',
      notes: 'Bare grey trunk + tuft of large compound leaves; very distinctive',
    },
    {
      scientific: 'Aloe arborescens',
      english: 'Krantz aloe',
      afrikaans: 'Kransaalwyn',
      heightM: { min: 2, max: 4 },
      layer: 'shrub',
      notes: 'Clumping aloe on rocky outcrops, red flower spikes winter',
    },
    {
      scientific: 'Helichrysum spp.',
      english: 'Everlastings / Sewejaartjies',
      afrikaans: 'Sewejaartjies',
      heightM: { min: 0.1, max: 0.5 },
      layer: 'ground',
    },
    {
      scientific: 'Berkheya purpurea',
      english: 'Mountain berkheya',
      afrikaans: 'Bergdisseldoring',
      heightM: { min: 0.5, max: 1.5 },
      layer: 'shrub',
    },
    {
      scientific: 'Protea caffra',
      english: 'Common protea',
      afrikaans: 'Gewone suikerbos',
      heightM: { min: 2, max: 6 },
      layer: 'mid-canopy',
      notes: 'Hardy protea in Mpumalanga/Gauteng grassland transitions',
    },
  ],
  // Central plateau grassland — Free State, Gauteng south, Mpumalanga
  // grassland (Ermelo / Standerton), NE KZN highlands. Northern edge
  // at ~-25.5 dovetails with Bushveld's southern edge.
  boundaries: [
    [
      [-25.5, 26.0],
      [-25.5, 30.5],
      [-27.5, 30.5],
      [-29.0, 30.0],
      [-30.5, 29.5],
      [-31.5, 28.0],
      [-31.5, 26.0],
    ],
  ],
};

// ─── Biome 10: Nama-Karoo (Great Karoo — central + western interior) ─
// Vast summer-rainfall semi-arid biome — dwarf shrubs + tussock grass +
// scattered trees along drainage. The classic Karoo landscape.

const NAMA_KAROO: BiomeProfile = {
  id: 'nama-karoo',
  name: 'Nama-Karoo (Great Karoo — central interior)',
  description:
    'Summer-rainfall semi-arid biome of the central + western SA interior (~150-400 mm/yr). Dwarf Karoo shrubs (bossies) + scattered tussock grass + few trees along drainage. Vast open horizons, sparse vegetation, low silhouettes. Hunting: kudu, gemsbok, springbok, mountain reedbuck. Reference scale dominated by knee-high bossies and occasional drainage karees.',
  plants: [
    {
      scientific: 'Pentzia incana',
      english: 'Ankerkaroo',
      afrikaans: 'Ankerkaroo',
      heightM: { min: 0.3, max: 0.8 },
      layer: 'shrub',
      notes: 'Dominant Karoo grazing dwarf shrub — "bossie" of the Karoo',
    },
    {
      scientific: 'Pentzia spinescens',
      english: 'Doringskaroo',
      afrikaans: 'Doringskaroo',
      heightM: { min: 0.3, max: 0.8 },
      layer: 'shrub',
    },
    {
      scientific: 'Eriocephalus ericoides',
      english: 'Cape snow bush / Kapokbossie',
      afrikaans: 'Kapokbossie',
      heightM: { min: 0.3, max: 1 },
      layer: 'shrub',
      notes: 'Aromatic; cotton-wool seed heads',
    },
    {
      scientific: 'Galenia africana',
      english: 'Kraalbos',
      afrikaans: 'Kraalbos',
      heightM: { min: 0.3, max: 0.8 },
      layer: 'shrub',
      notes: 'Yellow-green succulent dwarf shrub',
    },
    {
      scientific: 'Rhigozum obovatum',
      english: 'Karoo three-thorn',
      afrikaans: 'Karoo-driedoring',
      heightM: { min: 0.5, max: 1.5 },
      layer: 'shrub',
    },
    {
      scientific: 'Lycium cinereum',
      english: 'Honey-thorn',
      afrikaans: 'Honingdoring',
      heightM: { min: 1, max: 2.5 },
      layer: 'shrub',
    },
    {
      scientific: 'Searsia lancea',
      english: 'Karee',
      afrikaans: 'Karee',
      heightM: { min: 4, max: 9 },
      canopyM: { min: 5, max: 10 },
      layer: 'tree',
      notes:
        'Drainage-line tree — often the ONLY tree on the horizon for kilometres',
    },
    {
      scientific: 'Vachellia karroo',
      english: 'Sweet thorn',
      afrikaans: 'Soetdoring',
      heightM: { min: 2, max: 7 },
      layer: 'mid-canopy',
      notes: 'Drainage + disturbed land — yellow flowers very visible',
    },
    {
      scientific: 'Olea europaea subsp. africana',
      english: 'Wild olive',
      afrikaans: 'Olienhout',
      heightM: { min: 3, max: 8 },
      layer: 'mid-canopy',
      notes: 'Rocky outcrop tree',
    },
    {
      scientific: 'Tetragonia spicata',
      english: 'Spike kink-stem',
      afrikaans: 'Brakspekbos',
      heightM: { min: 0.2, max: 0.6 },
      layer: 'ground',
    },
    {
      scientific: 'Stipagrostis ciliata',
      english: 'Tall bushman grass',
      afrikaans: 'Boesmangras',
      heightM: { min: 0.3, max: 0.9 },
      layer: 'ground',
    },
    {
      scientific: 'Aristida diffusa',
      english: 'Iron grass',
      afrikaans: 'Ystergras',
      heightM: { min: 0.3, max: 0.7 },
      layer: 'ground',
    },
    {
      scientific: 'Pteronia pallens',
      english: 'Scholtzbos',
      afrikaans: 'Scholtzbos',
      heightM: { min: 0.4, max: 1 },
      layer: 'shrub',
    },
    {
      scientific: 'Aloe ferox',
      english: 'Bitter aloe',
      afrikaans: 'Bitteraalwyn',
      heightM: { min: 2, max: 5 },
      layer: 'shrub',
    },
    {
      scientific: 'Euphorbia mauritanica',
      english: 'Pencil milk-bush',
      afrikaans: 'Geel-noors',
      heightM: { min: 0.5, max: 2 },
      layer: 'shrub',
    },
  ],
  // Great Karoo proper — central + western SA interior. Wraps around
  // the Succulent Karoo's Klein Karoo polygon (Succulent Karoo is
  // tested first, so a point in Oudtshoorn goes there before falling
  // through to Nama-Karoo).
  boundaries: [
    [
      [-28.5, 19.0],
      [-28.5, 26.0],
      [-32.5, 26.0],
      [-33.0, 24.0],
      [-32.5, 19.5],
    ],
  ],
};

/**
 * The biomes covering South Africa, ORDERED FROM MOST SPECIFIC TO MOST
 * GENERAL. BiomeLookupService walks this list and returns the first
 * polygon containing the GPS point — so e.g. Forest must be tested
 * before Fynbos (a Knysna forest point would otherwise fall through to
 * Fynbos), Lowveld before Bushveld (a Kruger point would otherwise
 * fall through to Bushveld), etc.
 */
export const SA_BIOMES: ReadonlyArray<BiomeProfile> = [
  FOREST,           // tiny Knysna + Tsitsikamma forest enclaves
  LOWVELD,          // E of Drakensberg, low altitude
  COASTAL_BELT,     // narrow KZN + E Cape NE coastal strip
  SUCCULENT_KAROO,  // Namaqualand + Klein Karoo (multi-polygon)
  ALBANY_THICKET,   // E Cape interior thicket
  KALAHARI,         // NW Cape arid savanna
  HIGHVELD,         // central plateau grassland
  NAMA_KAROO,       // Great Karoo (central interior)
  BUSHVELD,         // N savanna catch-all
  FYNBOS,           // SW Cape catch-all (south of all of the above)
];
