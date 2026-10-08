// The two model-output JSON schemas (spec 5.1 and 5.2), category-neutral.
// Category-specific data lives in the flexible `attributes` / `specSheet`
// objects. Every property carries a description: models treat descriptions as
// implicit instructions.

export const CATEGORY_SLUGS = [
  'air-rifles',
  'cleaning-equipment',
  'firearms',
  'gun-smithing-parts',
  'optics',
  'reloading-components',
  'shooting-accessories',
  'fishing',
  'camping-outdoor',
  'knives',
  'self-defence',
  'paintball',
  'reloading-equipment',
  'overlanding',
  'hunting',
  'outdoor-clothing-footwear',
  'archery-bowhunting',
] as const;

export const IDENTIFY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['inScope', 'views', 'identification', 'questions'],
  properties: {
    inScope: {
      type: 'boolean',
      description:
        'true if the item belongs to one of the All Outdoor categories listed in the system prompt',
    },
    outOfScopeReason: {
      type: ['string', 'null'],
      description: 'one sentence, only when inScope is false',
    },
    views: {
      type: 'object',
      additionalProperties: false,
      required: ['received', 'missing'],
      properties: {
        received: {
          type: 'array',
          maxItems: 12,
          items: { type: 'string' },
          description: 'key views present in the photos for THIS item type',
        },
        missing: {
          type: 'array',
          maxItems: 12,
          items: { type: 'string' },
          description: 'key views absent for this item type',
        },
      },
    },
    identification: {
      type: 'object',
      additionalProperties: false,
      required: [
        'categorySlug',
        'make',
        'model',
        'confidence',
        'readable',
        'unreadable',
        'visibleFeatures',
      ],
      properties: {
        // ⚠️ NO `enum` AND NO NULL UNION HERE. Qwen's structured-output decoder
        // returns an empty array (`[]`) for the WHOLE response when this field
        // carries an enum containing null, failing every identify call. A plain
        // string with the slugs listed in the description works; an empty
        // string means "unsure" and is normalised to null in parseIdentify.
        categorySlug: {
          type: 'string',
          description:
            `best-match All Outdoor category slug, or an empty string if unsure. One of: ${CATEGORY_SLUGS.join(', ')}`,
        },
        make: { type: ['string', 'null'], description: 'brand or maker, null if not determinable' },
        model: { type: ['string', 'null'], description: 'model name or number, null if not determinable' },
        keySpec: {
          type: ['string', 'null'],
          description:
            'the specification that drives value for this item type. Possible reading only, never fact',
        },
        confidence: {
          type: 'string',
          enum: ['HIGH', 'MEDIUM', 'LOW'],
          description: 'confidence in the identification, not in any price',
        },
        readable: {
          type: 'array',
          items: { type: 'string' },
          description:
            'text actually legible in the photos. Never a serial value; write "serial plate visible" instead',
        },
        unreadable: {
          type: 'array',
          items: { type: 'string' },
          description: 'text present but not legible. Never guess it',
        },
        visibleFeatures: {
          type: 'array',
          items: { type: 'string' },
          description: 'only what is visible: accessories, wear, condition, missing parts',
        },
      },
    },
    questions: {
      type: 'array',
      maxItems: 8,
      description: 'clarifying questions, most value-relevant first; q1 is fixed by the backend',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'text', 'type', 'options', 'allow_custom', 'allow_unsure', 'required'],
        properties: {
          id: { type: 'string', pattern: '^q[0-9]{1,2}$', description: 'q2..q8' },
          text: { type: 'string', maxLength: 140, description: 'one short line, never multi-part' },
          type: { type: 'string', enum: ['single', 'multi'], description: 'single choice or tickbox multi' },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 6,
            items: { type: 'string', maxLength: 40 },
            description: 'short choices; never specific model names unless clearly legible in readable',
          },
          allow_custom: { type: 'boolean', description: 'always true; an Other box is always offered' },
          allow_unsure: { type: 'boolean', description: 'always true; Not sure lowers confidence but never blocks' },
          required: { type: 'boolean', description: 'true only for answers without which no valuation is possible' },
        },
      },
    },
  },
};

export const RESULT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['itemSummary', 'comps', 'pricing', 'confidence', 'demandNote', 'ad', 'unverified'],
  properties: {
    itemSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['oneLiner', 'categorySlug', 'make', 'model', 'conditionBand', 'specSheet'],
      properties: {
        oneLiner: { type: 'string', maxLength: 80 },
        categorySlug: { type: 'string' },
        make: { type: ['string', 'null'] },
        model: { type: ['string', 'null'] },
        keySpec: { type: ['string', 'null'], description: 'confirmed key specification from answers' },
        conditionBand: { type: 'string', enum: ['NEW', 'EXCELLENT', 'GOOD', 'FAIR', 'POOR'] },
        attributes: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: 'category-specific attributes as string pairs, snake_case keys',
        },
        specSheet: {
          type: 'array',
          maxItems: 15,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['label', 'value'],
            properties: { label: { type: 'string' }, value: { type: 'string' } },
          },
        },
        accessories: {
          type: 'array',
          maxItems: 8,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name'],
            properties: {
              name: { type: 'string' },
              valueCents: { type: ['integer', 'null'] },
              note: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
    comps: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'sourceSite', 'url', 'priceZar', 'pageOpened'],
        properties: {
          kind: { type: 'string', enum: ['USED_COMP', 'RETAIL_ANCHOR', 'ACCESSORY'] },
          sourceSite: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          model: { type: ['string', 'null'] },
          condition: { type: ['string', 'null'] },
          priceZar: { type: 'integer', minimum: 1 },
          listedDate: { type: ['string', 'null'], format: 'date' },
          pageOpened: { type: 'boolean' },
          match: {
            type: 'object',
            additionalProperties: false,
            required: ['diffs'],
            description:
              'How closely this comp matches the item. List a diff for every category match dimension that differs (for example calibre .30-06 vs 6.5 Creedmoor, or capacity 80L vs 50L). Empty diffs means it is the same model and specification.',
            properties: {
              diffs: {
                type: 'array',
                maxItems: 6,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['dimension'],
                  properties: {
                    dimension: { type: 'string', description: 'the match dimension key' },
                    itemValue: { type: ['string', 'null'], description: "this item's value" },
                    compValue: { type: ['string', 'null'], description: "the comp's value" },
                  },
                },
              },
            },
          },
        },
      },
    },
    pricing: {
      type: 'object',
      additionalProperties: false,
      required: ['lowZar', 'midZar', 'highZar', 'askingZar', 'expectedSaleZar'],
      properties: {
        lowZar: { type: ['integer', 'null'], minimum: 0 },
        midZar: { type: ['integer', 'null'], minimum: 0 },
        highZar: { type: ['integer', 'null'], minimum: 0 },
        askingZar: { type: ['integer', 'null'], minimum: 0 },
        expectedSaleZar: { type: ['integer', 'null'], minimum: 0 },
        retailAnchorZar: { type: ['integer', 'null'], minimum: 0 },
        missingData: { type: ['string', 'null'], description: 'plain-language explanation when data is missing' },
      },
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      required: ['level', 'reason'],
      properties: {
        level: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
        reason: { type: 'string', maxLength: 300 },
      },
    },
    demandNote: { type: 'string', maxLength: 400 },
    ad: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'bullets', 'priceZar'],
      properties: {
        title: { type: 'string', maxLength: 70 },
        bullets: {
          type: 'array',
          minItems: 3,
          maxItems: 8,
          items: { type: 'string', maxLength: 120 },
        },
        priceZar: { type: 'integer', minimum: 0 },
        description: { type: ['string', 'null'], maxLength: 2000 },
      },
    },
    unverified: { type: 'array', maxItems: 10, items: { type: 'string' } },
  },
};

// ── Minimal structural validators ─────────────────────────────────────
// The provider is asked for a strict schema, but the gateway may only
// guarantee parseable JSON. These validate the fields the services touch
// before anything is persisted. On failure the caller retries with the error
// echoed back (spec 8.7), then fails SCHEMA_VALIDATION_FAILED.

export interface IdentifyOutput {
  inScope: boolean;
  outOfScopeReason?: string | null;
  views: { received: string[]; missing: string[] };
  identification: {
    categorySlug: string | null;
    make: string | null;
    model: string | null;
    keySpec?: string | null;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    readable: string[];
    unreadable: string[];
    visibleFeatures: string[];
  };
  questions: RawQuestion[];
}

export interface RawQuestion {
  id: string;
  text: string;
  type: 'single' | 'multi';
  options: string[];
  allow_custom: boolean;
  allow_unsure: boolean;
  required: boolean;
}

export interface CompDiff {
  dimension: string;
  itemValue?: string | null;
  compValue?: string | null;
}

export interface RawComp {
  kind: 'USED_COMP' | 'RETAIL_ANCHOR' | 'ACCESSORY';
  sourceSite: string;
  url: string;
  model?: string | null;
  condition?: string | null;
  priceZar: number;
  listedDate?: string | null;
  pageOpened: boolean;
  /** How closely this comp matches the item. Missing means brand/class at best. */
  match?: { diffs: CompDiff[] };
}

export interface ResultOutput {
  itemSummary: {
    oneLiner: string;
    categorySlug: string;
    make: string | null;
    model: string | null;
    keySpec?: string | null;
    conditionBand: 'NEW' | 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
    attributes?: Record<string, string>;
    specSheet: Array<{ label: string; value: string }>;
    accessories?: Array<{ name: string; valueCents?: number | null; note?: string | null }>;
  };
  comps: RawComp[];
  pricing: {
    lowZar: number | null;
    midZar: number | null;
    highZar: number | null;
    askingZar: number | null;
    expectedSaleZar: number | null;
    retailAnchorZar?: number | null;
    missingData?: string | null;
  };
  confidence: { level: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string };
  demandNote: string;
  ad: { title: string; bullets: string[]; priceZar: number; description?: string | null };
  unverified: string[];
}

export function parseIdentify(raw: string): IdentifyOutput {
  const obj = JSON.parse(extractJson(raw)) as IdentifyOutput;
  if (typeof obj.inScope !== 'boolean') throw new Error('inScope missing');
  if (!obj.views || !Array.isArray(obj.views.received) || !Array.isArray(obj.views.missing))
    throw new Error('views missing');
  const id = obj.identification;
  if (!id || typeof id.confidence !== 'string' || !Array.isArray(id.readable))
    throw new Error('identification missing');
  if (!Array.isArray(obj.questions)) throw new Error('questions missing');
  // Normalise the category slug: empty string or an unknown value becomes null
  // (the UI then offers the category picker; the service defaults safely).
  if (
    id.categorySlug == null ||
    (typeof id.categorySlug === 'string' &&
      (id.categorySlug.trim() === '' || !CATEGORY_SLUGS.includes(id.categorySlug as never)))
  ) {
    id.categorySlug = null;
  }
  return obj;
}

export function parseResult(raw: string): ResultOutput {
  const obj = JSON.parse(extractJson(raw)) as ResultOutput;
  const s = obj.itemSummary;
  if (!s || typeof s.oneLiner !== 'string' || !Array.isArray(s.specSheet))
    throw new Error('itemSummary missing');
  if (!Array.isArray(obj.comps)) throw new Error('comps missing');
  if (!obj.pricing || typeof obj.pricing !== 'object') throw new Error('pricing missing');
  if (!obj.confidence || typeof obj.confidence.level !== 'string')
    throw new Error('confidence missing');
  if (typeof obj.demandNote !== 'string') throw new Error('demandNote missing');
  if (!obj.ad || typeof obj.ad.title !== 'string' || !Array.isArray(obj.ad.bullets))
    throw new Error('ad missing');
  if (!Array.isArray(obj.unverified)) throw new Error('unverified missing');
  return obj;
}

/**
 * Models sometimes wrap JSON in a ```json fence despite a schema request.
 * Strip the fence rather than fail on a cosmetic wrapper.
 */
function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) return fence[1].trim();
  return trimmed;
}
