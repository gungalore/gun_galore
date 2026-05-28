/**
 * Universal Scale References — trans-biome reference data injected into
 * every Range Estimator prompt regardless of GPS biome.
 *
 * The biome flora (sa-biomes.ts) gives the AI native vegetation
 * appropriate to where the hunter is standing. But SA hunts often
 * happen in or near:
 *   • Plantations + invasive trees (Eucalypt, pine, wattle, jacaranda)
 *   • Crop fields (varmint hunting — bushpig in maize, baboon in
 *     sunflower, jackal in lucerne, etc.)
 *   • Orchards (baboon in citrus + macadamia, monkey in avocado)
 *   • Vineyards (caracal in W Cape grapes)
 *   • Sugar cane (KZN bushpig + caracal)
 *   • Farm infrastructure (gates, fence posts, windmills, water tanks)
 *
 * These references are valuable because they appear in HUNTING photos
 * regardless of which biome the hunter is in. A maize stalk is 1.5-2.5
 * m tall in the Free State just like it is in Mpumalanga — different
 * biome, same reference.
 *
 * Data notes:
 * - Sizes are SA-CALIBRATED. Plantation eucalypts in SA average 15-25 m
 *   when mature, not the 40-60 m of Australian natives. Citrus trees in
 *   commercial SA orchards are kept pruned to 3-5 m, not the 8 m they'd
 *   reach unmanaged. The AI gets the SA-typical sizes, not the textbook
 *   global maximums.
 * - SPACING matters too. Rows of citrus at 4-6 m gives the AI a strong
 *   second reference (the gap between trees, not just the trees).
 * - Farm infrastructure (fence post 1.2-1.6 m, gate posts 1.8-2.2 m,
 *   game-fence posts 2.2-2.4 m) is the single most useful close-range
 *   reference at most SA hunting locations because there's almost
 *   always a fence somewhere in frame.
 *
 * VARMINT-HUNTING FOCUS: many of these crops are exactly where SA
 * farmers shoot bushpig, warthog, baboon, monkey, caracal, and jackal.
 * The "varmint context" is acknowledged explicitly in the W3 system
 * prompt so the AI knows to PRIORITISE crop scale references when it
 * sees a cultivated landscape.
 */

export type UniversalReferenceCategory =
  | 'invasive-tree'
  | 'plantation'
  | 'field-crop'
  | 'orchard'
  | 'vineyard'
  | 'sugarcane'
  | 'farm-infrastructure'
  | 'irrigation'
  | 'vehicle'
  | 'person'
  | 'hay-bale';

export type UniversalReference = {
  /** Category tag used to group the prompt sections. */
  category: UniversalReferenceCategory;
  /** Display name in English. */
  english: string;
  /** Afrikaans common name (where applicable). */
  afrikaans?: string;
  /** Scientific binomial (where applicable). */
  scientific?: string;
  /** Typical height range in metres for SA-relevant size. */
  heightM?: { min: number; max: number };
  /** Optional canopy/object width for round-ish references. */
  widthM?: { min: number; max: number };
  /** Optional row/object spacing — crucial scale signal in orchards,
   *  vineyards, and plantations because regular spacing IS itself a
   *  ruler. */
  spacingM?: { min: number; max: number };
  /** One-line note the AI can use for distinguishing or context. */
  notes?: string;
};

export const UNIVERSAL_REFERENCES: ReadonlyArray<UniversalReference> = [
  // ─── Invasive + introduced trees (common across SA) ───────────────
  {
    category: 'invasive-tree',
    english: 'Eucalyptus / Bluegum',
    afrikaans: 'Bloekomboom',
    scientific: 'Eucalyptus camaldulensis / E. grandis',
    heightM: { min: 15, max: 30 },
    notes: 'Common as plantation timber, windbreaks, riverine invasive. SA-typical mature height (NOT the 40 m+ of Australian natives).',
  },
  {
    category: 'invasive-tree',
    english: 'Pine',
    afrikaans: 'Den',
    scientific: 'Pinus radiata / P. patula',
    heightM: { min: 10, max: 25 },
    spacingM: { min: 2.5, max: 3.5 },
    notes: 'SA plantation pines; regular row spacing visible from above',
  },
  {
    category: 'invasive-tree',
    english: 'Jacaranda',
    afrikaans: 'Jakaranda',
    scientific: 'Jacaranda mimosifolia',
    heightM: { min: 8, max: 15 },
    widthM: { min: 6, max: 12 },
    notes: 'Iconic farmstead/urban tree; mauve flowers Oct-Nov; spreading canopy',
  },
  {
    category: 'invasive-tree',
    english: 'Black wattle',
    afrikaans: 'Swartwattel',
    scientific: 'Acacia mearnsii',
    heightM: { min: 5, max: 15 },
    notes: 'Riparian invasive, often in dense stands along streams',
  },
  {
    category: 'invasive-tree',
    english: 'Poplar',
    afrikaans: 'Populier',
    scientific: 'Populus deltoides',
    heightM: { min: 15, max: 25 },
    notes: 'Tall straight river-valley tree; rustling leaves in wind',
  },
  {
    category: 'invasive-tree',
    english: 'Cypress / Italian cypress',
    afrikaans: 'Sipres',
    scientific: 'Cupressus spp.',
    heightM: { min: 8, max: 25 },
    notes: 'Tall narrow column form; common windbreak species on farms',
  },

  // ─── Plantation forestry ──────────────────────────────────────────
  {
    category: 'plantation',
    english: 'Pine plantation',
    afrikaans: 'Denplantasie',
    heightM: { min: 10, max: 25 },
    spacingM: { min: 2.5, max: 3.5 },
    notes: 'Uniform-height stand of pines in regular rows — Mpumalanga / KZN escarpment',
  },
  {
    category: 'plantation',
    english: 'Eucalyptus plantation',
    afrikaans: 'Bloekomplantasie',
    heightM: { min: 15, max: 30 },
    spacingM: { min: 2.5, max: 4 },
    notes: 'Uniform-height eucalypt stand for timber/pulp',
  },
  {
    category: 'plantation',
    english: 'Wattle plantation',
    afrikaans: 'Wattelplantasie',
    heightM: { min: 10, max: 15 },
    notes: 'Dense wattle stand for tannin/pulp',
  },

  // ─── Field crops (varmint hunting key context!) ───────────────────
  {
    category: 'field-crop',
    english: 'Maize / Mielies',
    afrikaans: 'Mielies',
    scientific: 'Zea mays',
    heightM: { min: 1.5, max: 2.5 },
    spacingM: { min: 0.75, max: 1 },
    notes:
      'MATURE maize (Jan-Apr in SA) ~2 m tall with tassels above. Row spacing 0.75-1 m. Bushpig + warthog + baboon damage common — primary varmint context. Young maize (Nov-Dec) is 0.3-1 m.',
  },
  {
    category: 'field-crop',
    english: 'Wheat',
    afrikaans: 'Koring',
    scientific: 'Triticum aestivum',
    heightM: { min: 0.6, max: 1.2 },
    notes: 'Mature wheat golden-yellow, dense stand. Free State + W Cape primary regions.',
  },
  {
    category: 'field-crop',
    english: 'Soya bean',
    afrikaans: 'Sojaboon',
    scientific: 'Glycine max',
    heightM: { min: 0.6, max: 1.2 },
    notes: 'Bushy low canopy in rows. Mpumalanga + Free State; bushpig + warthog damage.',
  },
  {
    category: 'field-crop',
    english: 'Sunflower',
    afrikaans: 'Sonneblom',
    scientific: 'Helianthus annuus',
    heightM: { min: 1.5, max: 3 },
    spacingM: { min: 0.7, max: 0.9 },
    notes: 'Distinctive single tall stem with large yellow flower head. Free State + North West. Baboon damage common.',
  },
  {
    category: 'field-crop',
    english: 'Lucerne / Alfalfa',
    afrikaans: 'Lusern',
    scientific: 'Medicago sativa',
    heightM: { min: 0.3, max: 0.9 },
    notes: 'Low green forage crop. Multiple cuts per year, varies by stage. Jackal + caracal hunting context.',
  },
  {
    category: 'field-crop',
    english: 'Sorghum',
    afrikaans: 'Mannakoring / Graansorghum',
    scientific: 'Sorghum bicolor',
    heightM: { min: 1, max: 2 },
    notes: 'Maize-like but smaller heads, often reddish-brown',
  },
  {
    category: 'field-crop',
    english: 'Cotton',
    afrikaans: 'Katoen',
    scientific: 'Gossypium hirsutum',
    heightM: { min: 0.8, max: 1.5 },
    notes: 'Bushy with white bolls at harvest. Limpopo + Mpumalanga.',
  },
  {
    category: 'field-crop',
    english: 'Canola',
    afrikaans: 'Canola',
    scientific: 'Brassica napus',
    heightM: { min: 0.6, max: 1.5 },
    notes: 'Yellow flowers in winter (W Cape). Vivid colour aids identification.',
  },
  {
    category: 'field-crop',
    english: 'Tobacco',
    afrikaans: 'Tabak',
    scientific: 'Nicotiana tabacum',
    heightM: { min: 1, max: 2 },
    notes: 'Large broad leaves on tall stem. Limpopo + KZN.',
  },

  // ─── Orchards (baboon + monkey + bushpig varmint context) ──────────
  {
    category: 'orchard',
    english: 'Citrus orchard (orange/lemon/lime)',
    afrikaans: 'Sitrusboord',
    scientific: 'Citrus spp.',
    heightM: { min: 3, max: 5 },
    spacingM: { min: 4, max: 6 },
    notes: 'Pruned commercial orchard, uniform rows. Limpopo + E Cape primary regions. Baboon damage extensive.',
  },
  {
    category: 'orchard',
    english: 'Avocado orchard',
    afrikaans: 'Avokadoboord',
    scientific: 'Persea americana',
    heightM: { min: 6, max: 15 },
    spacingM: { min: 6, max: 10 },
    notes: 'Larger than citrus; KZN + Mpumalanga + Limpopo. Monkey + baboon damage.',
  },
  {
    category: 'orchard',
    english: 'Mango orchard',
    afrikaans: 'Mango-boord',
    scientific: 'Mangifera indica',
    heightM: { min: 8, max: 15 },
    spacingM: { min: 8, max: 10 },
    notes: 'Large evergreen trees; Limpopo + Mpumalanga lowveld',
  },
  {
    category: 'orchard',
    english: 'Pecan orchard',
    afrikaans: 'Pekanboord',
    scientific: 'Carya illinoinensis',
    heightM: { min: 10, max: 20 },
    spacingM: { min: 10, max: 12 },
    notes: 'Tall deciduous orchard trees; N Cape + Mpumalanga river valleys',
  },
  {
    category: 'orchard',
    english: 'Macadamia orchard',
    afrikaans: 'Macadamia-boord',
    scientific: 'Macadamia integrifolia',
    heightM: { min: 5, max: 12 },
    spacingM: { min: 6, max: 8 },
    notes: 'Evergreen, pruned hedge-like in production blocks. KZN + Mpumalanga + Limpopo. Baboon damage.',
  },
  {
    category: 'orchard',
    english: 'Olive grove',
    afrikaans: 'Olyfboord',
    scientific: 'Olea europaea',
    heightM: { min: 4, max: 8 },
    spacingM: { min: 5, max: 7 },
    notes: 'W Cape primarily; silvery-green leaves',
  },
  {
    category: 'orchard',
    english: 'Apple orchard',
    afrikaans: 'Appelboord',
    scientific: 'Malus domestica',
    heightM: { min: 2.5, max: 5 },
    spacingM: { min: 3, max: 5 },
    notes: 'Pruned to harvest height; W Cape mountain valleys',
  },

  // ─── Vineyards (caracal hunting in W Cape) ─────────────────────────
  {
    category: 'vineyard',
    english: 'Wine grape vines (on trellis)',
    afrikaans: 'Wynstokke',
    scientific: 'Vitis vinifera',
    heightM: { min: 1.2, max: 2.0 },
    spacingM: { min: 2, max: 3 },
    notes:
      'Vines trained on trellis; canopy 0.8-1.5 m, trellis posts 1.8-2.5 m. ROW SPACING 2-3 m is a strong scale reference. W Cape primary, also N Cape. Caracal + porcupine + bushpig damage.',
  },
  {
    category: 'vineyard',
    english: 'Vineyard trellis post',
    afrikaans: 'Wingerdpaal',
    heightM: { min: 1.8, max: 2.5 },
    notes: 'Wooden or concrete post in vineyard, taller than vine canopy',
  },

  // ─── Sugar cane (KZN bushpig + caracal hunting) ────────────────────
  {
    category: 'sugarcane',
    english: 'Sugar cane',
    afrikaans: 'Suikerriet',
    scientific: 'Saccharum officinarum',
    heightM: { min: 2, max: 4 },
    notes:
      'Dense rows of bamboo-like stems, 2-4 m tall at maturity. KZN coastal + midlands. Major bushpig + caracal + monkey hunting context.',
  },

  // ─── Farm infrastructure (almost always in frame) ──────────────────
  {
    category: 'farm-infrastructure',
    english: 'Standard farm fence post',
    afrikaans: 'Heining-paal',
    heightM: { min: 1.2, max: 1.6 },
    notes: 'Wooden or steel; 4-5 wires; standard livestock fence',
  },
  {
    category: 'farm-infrastructure',
    english: 'Game fence post',
    afrikaans: 'Wildheinings-paal',
    heightM: { min: 2.2, max: 2.4 },
    notes:
      'Tall metal post for game-proof fencing on hunting concessions / private reserves. KEY ANCHOR — many SA hunting photos have a game fence somewhere in frame.',
  },
  {
    category: 'farm-infrastructure',
    english: 'Gate post',
    afrikaans: 'Hekpaal',
    heightM: { min: 1.8, max: 2.2 },
    widthM: { min: 0.15, max: 0.3 },
    notes: 'Heavy post anchoring a farm gate',
  },
  {
    category: 'farm-infrastructure',
    english: 'Telephone / utility pole',
    afrikaans: 'Telefoonpaal',
    heightM: { min: 8, max: 12 },
    notes: 'Wooden or concrete; rural distribution lines',
  },
  {
    category: 'farm-infrastructure',
    english: 'Power-line pylon (rural distribution)',
    afrikaans: 'Krapyleaktipaal',
    heightM: { min: 12, max: 25 },
    notes: 'Steel lattice or concrete; the BIG high-voltage transmission pylons are 30-50 m+',
  },
  {
    category: 'farm-infrastructure',
    english: 'Farm windmill',
    afrikaans: 'Windpomp',
    heightM: { min: 6, max: 12 },
    widthM: { min: 2, max: 3 },
    notes:
      'Iconic Karoo / Bushveld landmark — steel tower with bladed wheel. Distinctive silhouette, excellent long-range reference.',
  },
  {
    category: 'farm-infrastructure',
    english: 'Water tank (round, corrugated steel)',
    afrikaans: 'Watertenk',
    heightM: { min: 2, max: 3 },
    widthM: { min: 3, max: 6 },
    notes: 'Round galvanised steel tank, often near windmill',
  },
  {
    category: 'farm-infrastructure',
    english: 'Reservoir / dam wall',
    afrikaans: 'Dammuur',
    heightM: { min: 1.5, max: 4 },
    notes: 'Earth or concrete farm dam; height varies widely',
  },
  {
    category: 'farm-infrastructure',
    english: 'Cattle / livestock crush',
    afrikaans: 'Beeskraal',
    heightM: { min: 1.4, max: 1.8 },
    notes: 'Steel-pipe race for handling cattle',
  },

  // ─── Irrigation infrastructure ─────────────────────────────────────
  {
    category: 'irrigation',
    english: 'Centre pivot irrigation',
    afrikaans: 'Sentrumspoeling',
    heightM: { min: 2.5, max: 4 },
    notes:
      'Tall wheeled boom rotating around a central pivot; sprayheads at ~3 m. Span 200-500 m radius. Visible from far away — distinctive circular green patch from above.',
  },
  {
    category: 'irrigation',
    english: 'Irrigation pipe / sprinkler',
    afrikaans: 'Besproeiingspyp',
    heightM: { min: 0.5, max: 3 },
    notes: 'Various — drag-line, fixed sprinkler, drip pipes',
  },

  // ─── Hay bales (common in fields after harvest) ────────────────────
  {
    category: 'hay-bale',
    english: 'Round hay bale',
    afrikaans: 'Hooirol',
    heightM: { min: 1.2, max: 1.5 },
    widthM: { min: 1.2, max: 1.5 },
    notes: 'Cylindrical roll of hay/straw, common in fields after harvest',
  },
  {
    category: 'hay-bale',
    english: 'Square hay bale',
    afrikaans: 'Hooi-eend',
    heightM: { min: 0.4, max: 0.5 },
    widthM: { min: 0.4, max: 0.5 },
    notes: 'Rectangular bale, smaller than round; 0.9-1 m long',
  },
  {
    category: 'hay-bale',
    english: 'Large square hay bale',
    afrikaans: 'Groot hooi-eend',
    heightM: { min: 0.8, max: 1.3 },
    widthM: { min: 1.2, max: 1.5 },
    notes: 'Big rectangular bale, 2-2.4 m long',
  },

  // ─── Vehicles (almost certainly in frame somewhere) ────────────────
  {
    category: 'vehicle',
    english: 'Bakkie (Toyota Hilux / Ford Ranger class)',
    afrikaans: 'Bakkie',
    heightM: { min: 1.7, max: 1.9 },
    widthM: { min: 1.8, max: 2 },
    notes: 'Standard double-cab pickup; 5 m long. THE iconic SA hunting vehicle.',
  },
  {
    category: 'vehicle',
    english: 'Hunting vehicle (Land Cruiser / open game-viewer)',
    afrikaans: 'Wildkyk-voertuig',
    heightM: { min: 1.9, max: 2.5 },
    widthM: { min: 1.9, max: 2.1 },
    notes: 'Modified Land Cruiser / Defender with raised seating; PH context',
  },
  {
    category: 'vehicle',
    english: 'Tractor (farm)',
    afrikaans: 'Trekker',
    heightM: { min: 2.5, max: 3 },
    notes: 'Farm tractor; 5 m long with implements',
  },
  {
    category: 'vehicle',
    english: 'ATV / quad bike',
    afrikaans: 'Quad-bike',
    heightM: { min: 1.2, max: 1.4 },
    widthM: { min: 1.1, max: 1.3 },
    notes: 'Used for scouting/recovery on hunting concessions',
  },
  {
    category: 'vehicle',
    english: 'Sedan car',
    afrikaans: 'Sedan',
    heightM: { min: 1.4, max: 1.5 },
    widthM: { min: 1.7, max: 1.85 },
    notes: 'Standard passenger car',
  },

  // ─── People (the ultimate calibration if visible) ──────────────────
  {
    category: 'person',
    english: 'Adult standing',
    afrikaans: 'Volwassene',
    heightM: { min: 1.6, max: 1.9 },
    widthM: { min: 0.4, max: 0.5 },
    notes: 'SA adult median ~1.72 m. PRIMARY scale reference when visible in frame.',
  },
  {
    category: 'person',
    english: 'Adult seated (e.g. on tailgate)',
    afrikaans: 'Sittende volwassene',
    heightM: { min: 0.85, max: 1.0 },
    notes: 'Seated height ~1/2 of standing',
  },
  {
    category: 'person',
    english: 'Hunter with rifle aimed',
    afrikaans: 'Skut met geweer',
    heightM: { min: 1.6, max: 1.9 },
    notes: 'Standing shooter; rifle adds ~1 m horizontal but height same as standing',
  },
];
