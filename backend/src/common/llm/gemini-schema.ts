// ────────────────────────────────────────────────────────────────────
// JSON Schema → Gemini's OpenAPI-flavoured subset.
//
// ⚠️ WHY THIS EXISTS AT ALL. Anthropic takes a tool's `input_schema` as
// plain JSON Schema and ignores what it does not understand. Gemini does
// NOT: it validates the schema object it is handed and rejects the whole
// request with a 400 INVALID_ARGUMENT when it meets a key outside its
// subset. So the schemas fifteen call sites already wrote — most of them
// with `$schema`, `additionalProperties: false` and a `title`, because
// that is what a JSON-Schema linter asks for — would every one of them
// fail on the new provider. Stripping them here means no call site has to
// know which provider is live, which is the entire point of the adapter.
//
// Confirmed against ai.google.dev/api/generate-content and
// ai.google.dev/gemini-api/docs/structured-output on 2026-09-07: the
// accepted keys are type, format, description, nullable, enum, items,
// properties, required, propertyOrdering, minimum, maximum, minItems,
// maxItems. Everything else is dropped rather than passed through, on the
// principle that a silently weaker schema beats a 400.
// ────────────────────────────────────────────────────────────────────

/** The keys Gemini accepts on a schema node. Anything else is dropped. */
const PASSTHROUGH_KEYS = [
  'description',
  'enum',
  'format',
  'maxItems',
  'maximum',
  'minItems',
  'minimum',
  'nullable',
  'propertyOrdering',
] as const;

const GEMINI_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
]);

/**
 * Convert one JSON Schema node into the subset Gemini accepts.
 *
 * PURE — no I/O, no mutation of the input, no environment. Recurses into
 * `properties`, `items` and the branches of a `oneOf`/`anyOf` union.
 *
 * Spec:
 *  - Drops `$schema`, `$id`, `$ref`, `definitions`, `$defs`,
 *    `additionalProperties`, `default`, `examples`, `title`, `const`,
 *    `pattern`, and any other key not in the accepted list. Dropping is
 *    deliberate: an unknown key is a 400, a missing key is a looser
 *    schema, and the model still gets the shape from type/properties.
 *  - `type: ["string", "null"]` (and any 2-member union with `"null"`)
 *    becomes `{ type: 'string', nullable: true }` — Gemini has no union
 *    type but does have `nullable`, and a nullable field is exactly what
 *    a caller writing that union meant.
 *  - `type: "null"` alone becomes `{ type: 'string', nullable: true }`:
 *    there is no null type, and a nullable string is the nearest thing
 *    that will not be rejected.
 *  - A type union with no `"null"` member (e.g. `["string","number"]`)
 *    keeps only the FIRST member, because Gemini can express no better.
 *  - An unrecognised type string is dropped, leaving the node untyped;
 *    Gemini treats an untyped node as free-form rather than erroring.
 *  - `required` is kept only when it is an array of strings, and only
 *    entries that survive into `properties` are kept — a `required` naming
 *    a property Gemini never saw is a 400.
 *  - `oneOf`/`anyOf` collapse to their FIRST branch, converted. Gemini's
 *    subset has no union combinator; the first branch is the one call
 *    sites in this repo write as the happy path.
 *  - `const: X` becomes `enum: [X]`, which is the same constraint in a
 *    key Gemini accepts.
 *  - A non-object input (or null) yields `{}` — an untyped node, never a
 *    throw. The converter must not be the thing that breaks a call.
 */
export function toGeminiSchema(
  jsonSchema: unknown,
): Record<string, unknown> {
  if (!jsonSchema || typeof jsonSchema !== 'object' || Array.isArray(jsonSchema)) {
    return {};
  }
  const src = jsonSchema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  // ── type, and the null-union rewrite ──────────────────────────────
  const rawType = src.type;
  if (typeof rawType === 'string') {
    if (rawType === 'null') {
      out.type = 'string';
      out.nullable = true;
    } else if (GEMINI_TYPES.has(rawType)) {
      out.type = rawType;
    }
  } else if (Array.isArray(rawType)) {
    const members = rawType.filter((t): t is string => typeof t === 'string');
    const nonNull = members.filter((t) => t !== 'null');
    if (members.length !== nonNull.length) out.nullable = true;
    const first = nonNull.find((t) => GEMINI_TYPES.has(t));
    if (first) out.type = first;
    else if (out.nullable) out.type = 'string';
  }

  // ── plain passthrough keys ────────────────────────────────────────
  for (const key of PASSTHROUGH_KEYS) {
    if (src[key] !== undefined) out[key] = src[key];
  }
  // `const` says the same thing as a one-member enum, in a key Gemini has.
  if (src.const !== undefined && out.enum === undefined) {
    out.enum = [src.const];
  }
  // Gemini only honours `enum` on a string; an untyped enum is rejected.
  if (out.enum !== undefined && out.type === undefined) out.type = 'string';

  // ── object properties ─────────────────────────────────────────────
  if (src.properties && typeof src.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(
      src.properties as Record<string, unknown>,
    )) {
      props[name] = toGeminiSchema(child);
    }
    out.properties = props;
    if (out.type === undefined) out.type = 'object';

    // ⚠️ A `required` entry naming a property that is not in `properties`
    // is a 400, and hand-written schemas drift that way. Filter to what
    // actually survived.
    if (Array.isArray(src.required)) {
      const required = src.required.filter(
        (r): r is string => typeof r === 'string' && r in props,
      );
      if (required.length > 0) out.required = required;
    }
  }

  // ── array items ───────────────────────────────────────────────────
  if (src.items !== undefined) {
    // A tuple form (`items: [ ... ]`) has no Gemini equivalent; take the
    // first element's shape, which is what a homogeneous list wants.
    const items = Array.isArray(src.items) ? src.items[0] : src.items;
    out.items = toGeminiSchema(items);
    if (out.type === undefined) out.type = 'array';
  }

  // ── unions: keep the first branch ─────────────────────────────────
  if (out.type === undefined && out.properties === undefined) {
    const branch = src.oneOf ?? src.anyOf;
    if (Array.isArray(branch) && branch.length > 0) {
      return { ...toGeminiSchema(branch[0]), ...out };
    }
  }

  return out;
}
