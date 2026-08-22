# Motivation generator — how the document is actually built

Snapshot of the live pipeline at commit `4113150`, 2026-08-22.
Field registry version `2026-08-19`.

Everything below was read out of the running code, not from design notes. Where a
number looks arbitrary it usually is not — most of them are scar tissue, and the
reasons are recorded because they cost real time to learn.

---

## 1. The pipeline

```
FactPack (137-field registry) + StructurePlan (seeded variation)
        │
        ├─ research()          Sonnet 5 + web_search      180s
        ├─ generate()          Opus 5, 8000 tok            85s
        │    └─ local checks: followsPlan · maxSimilarity · packConsistency
        │       └─ ONE retry if any fail
        ├─ verifyDocument()    Sonnet 5, thinking off      60s
        ├─ grade()             Sonnet 5, thinking off      60s   ← fails closed
        └─ askFollowUp(Batch)  Haiku 4.5                   60s
```

Orchestrated in `motivations.service.ts` (~line 2400). The Claude calls all live in
`motivation-claude.service.ts` (789 lines); prompt construction in
`motivation-prompts.ts` (702 lines).

---

## 2. Client

```ts
new Anthropic({ apiKey: key, timeout: GENERATE_TIMEOUT_MS, maxRetries: 1 })

const GENERATE_TIMEOUT_MS = 85_000;
const GRADE_TIMEOUT_MS    = 60_000;
const RESEARCH_TIMEOUT_MS = 180_000;
```

`maxRetries: 1`. Per-call timeouts are passed as the second argument to
`messages.create()` where they differ from the client default.

---

## 3. Models — three tiers, all env-overridable

```ts
const MODEL_WRITE    = process.env.ANTHROPIC_MODEL_MOTIVATION          ?? 'claude-opus-5';
const MODEL_GATE     = process.env.ANTHROPIC_MODEL_MOTIVATION_GATE     ?? 'claude-sonnet-5';
const MODEL_FOLLOWUP = process.env.ANTHROPIC_MODEL_MOTIVATION_FOLLOWUP ?? 'claude-haiku-4-5-20251001';
```

**The writer and the gate are deliberately different families.** From the source:

> If the writer invents a detail that feels plausible, the same model is the one most
> likely to wave it through on review. Groundedness is the score that vetoes
> everything, so the checker must fail differently from the writer.

Follow-ups are Haiku because a one-line question in the assistant's voice does not
need the flagship: *"the flagship would be paying Rolls-Royce prices to ask 'which
association are you with?'"*

Overriding `ANTHROPIC_MODEL_MOTIVATION` and restarting is how a writer model gets
A/B'd — the gate scores and the sameness detector then answer the question with
measurements rather than opinions.

---

## 4. The six call sites

| Method | Model | `max_tokens` | Thinking | Tools | Timeout |
|---|---|---|---|---|---|
| `generate` | WRITE | **8000** | *(unset — model default)* | — | 85s |
| `research` | GATE | 4000 | *(unset)* | `web_search_20260209` | 180s |
| `verifyDocument` | GATE | 1500 | `disabled` | — | 60s |
| `grade` | GATE | 4000 | `disabled` | — | 60s |
| `askFollowUpBatch` | FOLLOWUP | 900 | *(unset)* | — | — |
| `askFollowUp` | FOLLOWUP | — | *(unset)* | — | 60s |

### 4.1 `generate` — the writer

```ts
await this.client.messages.create({
  model: MODEL_WRITE,
  max_tokens: 8000,
  system: [
    {
      type: 'text',
      text: generationSystemPrompt(pack.licenceType),
      cache_control: { type: 'ephemeral' },   // the one large stable block
    },
  ],
  messages: [{ role: 'user', content: generationUserPrompt(pack, plan) }],
});
```

Output shorter than 200 characters is treated as a failed attempt rather than stored.

### 4.2 `grade` — the quality gate

```ts
await this.client.messages.create(
  {
    model: MODEL_GATE,
    max_tokens: 4000,
    thinking: { type: 'disabled' } as never,
    system: gateSystemPrompt(),
    messages: [{ role: 'user', content: gateUserPrompt(pack, documentText) }],
  },
  { timeout: GRADE_TIMEOUT_MS },
);
```

### 4.3 `research`

```ts
tools: [{ type: 'web_search_20260209' as never, name: 'web_search' }]
```

Gathers published context — area crime figures for a self-defence application, the
cartridge's history and role for a section 16. It is **our** material, not the
applicant's, and renders in its own prompt block rather than inside
`<applicant-facts>`.

---

## 5. Four constraints that are not negotiable

### 5.1 No `temperature`. Anywhere. Ever.

`temperature` / `top_p` / `top_k` were **removed from the API** on Opus 4.7+ and on
Sonnet 5. Sending one is a 400:

```
`temperature` is deprecated for this model.
```

This cost two days of silence. Every call site fails soft, so the 400 was caught,
logged at warn, and the feature simply did nothing. Deterministic transcription is
the default now — there is no parameter to ask for it.

### 5.2 Thinking is explicitly disabled on the gate and the verifier

Sonnet 5's adaptive thinking engages on its own when the input looks hard, and the
research block made it look hard. A live gate call **burned all 4000 output tokens on
reasoning** and emitted 255 characters of truncated JSON, which the fail-closed parse
correctly scored 0.

> A verdict is transcription of a judgement into a fixed shape; the budget must be
> text.

The writer deliberately leaves `thinking` unset — it gets the model default.

### 5.3 Both `max_tokens` values are scar tissue

**Writer, 8000.** Was 4000, sized for the 2–4 page document originally assumed. Real
submissions run 11–40 pages, so 4000 truncated mid-argument — and a motivation that
stops halfway is worse than none. Deliberately not raised further without
measurement: output tokens are wall-clock, and this route is synchronous under an
85s client timeout, nginx 90s and Cloudflare ~100s. If beta timings run close to
that, the answer is **async generation with polling**, not a bigger number.

**Gate, 4000.** Was 1200. The verdict carries `thin_fields` plus a free-text issues
list, and a strict reviewer given a long draft writes a lot of issues. At 1200 the
reply truncated mid-JSON, the brace match found no closing brace, and **every**
document failed with "the reviewer did not return a usable verdict" — a gate that
fails closed, so nothing could ever pass. Output tokens bill as used, so the headroom
is close to free.

### 5.4 Prompt caching only on the writer's system prompt

`cache_control: { type: 'ephemeral' }` sits on `generationSystemPrompt()` — the one
large, stable block. Nothing else is cached.

---

## 6. No structured outputs

There is no `output_config`, no `tool_choice`, no `response_format` and no
`StructuredOutput` anywhere in the service. The gate returns JSON **as text**, which
is brace-matched and then `JSON.parse`d. That is why a truncated reply is
indistinguishable from a bad document unless `stop_reason === 'max_tokens'` is
checked explicitly — and it is.

---

## 7. Gates and thresholds

```ts
export const QUALITY_FLOOR      = 65;
export const GROUNDEDNESS_FLOOR = 70;

const passed = overall >= QUALITY_FLOOR && groundedness >= GROUNDEDNESS_FLOOR;
```

### The gate rubric

Four scores, each 0–100, returned as bare JSON:

```json
{"completeness":0,"specificity":0,"consistency":0,"groundedness":0,
 "thin_fields":[],"issues":[]}
```

- **groundedness** — *"the most important score"*. Does every verifiable factual
  claim trace back to the supplied facts? A single invented verifiable fact puts this
  below 50 however well written the document is.
- **completeness**, **specificity**, **consistency** — a short document built on
  genuine circumstances scores **higher** than a long one padded with material.
- **thin_fields** — field keys, exactly as given, whose answer was too thin. These
  drive the Haiku follow-up questions.
- **issues** — short, plain descriptions of concrete problems.

---

## 8. The local checks, and the single retry

Before the document ever reaches the gate, three **non-model** checks run:

| Check | Source | What it catches |
|---|---|---|
| `followsPlan(text, plan)` | `motivation-structure.ts` | the document ignored its own structure plan |
| `maxSimilarity(fingerprint(text), previous)` | `motivation-structure.ts` | it reads like documents already generated |
| `packConsistency(text, answers, annexures)` | `motivation-verify.ts` | mechanical contradictions against the facts |

If any fail → **exactly one** regeneration, then proceed regardless. Same cost, same
cap. A seat is claimed **once per motivation, not once per attempt**.

---

## 9. `FactPack` — the input contract

```ts
export interface FactPack {
  licenceType: MotivationLicenceType;
  answers: Record<string, string>;   // field key → applicant's answer, registry-validated
  derived: Record<string, string>;   // facts WE computed — age, years held
  overlapNote?: string;              // our direction about a same-class overlap
  research?: string;                 // our gathered background
  annexures: ...                     // the lettered tabs the printed pack will contain
}
```

Two structural rules worth carrying into any rewrite:

**`overlapNote` is deliberately NOT an answer and NOT inside `<applicant-facts>`.**
It is a direction from us, and *"burying a direction inside a block the model is told
to treat as untrusted data is how an instruction gets ignored."*

**`research` is likewise outside `<applicant-facts>`.** We wrote it, from sources we
chose. Annexure letters come from the same `buildAnnexures()` that letters the printed
pack, so a citation can never point at a tab that will not exist.

---

## 10. `StructurePlan` — the variation engine

```ts
export interface StructurePlan {
  seed: number;
  sections: SectionPlan[];           // { id, heading, paragraphs }
  opening: 'chronological' | 'need_first' | 'circumstance_first' | 'purpose_first';
  closing: 'summary' | 'undertaking' | 'forward_looking';
  register: ...                      // sentence-length register
}
```

Section ids:

```
introduction · personal_circumstances
the_quarry | the_discipline | the_threat        ← three ids for one job
experience · the_firearm · the_calibre
comparison                                      ← only when there is an overlap
storage_safety · compliance_history
statutory_application · conclusion
```

The three purpose sections are separate ids rather than one `purpose` with per-type
headings **because the headings differ in kind, not wording** — "The quarry and the
ground I hunt" and "The discipline and its course of fire" are not alternates of each
other, and a self-defence applicant must never be handed either. Before they existed
the document went straight from circumstances to the firearm, asserting a need without
ever setting out what the firearm is *for*.

`the_calibre`, `comparison` and `statutory_application` were read off the corpus of
approved motivations (2026-08-22). The calibre section argues the *cartridge* against
the requirement — energy at the range the shot is taken, humane kill, course of fire —
where `the_firearm` argues the platform; folded together they go shallow on both.
`statutory_application` is **the only section that quotes the Act**: it quotes the
licence section and the general application regulation verbatim and then answers each
quoted element with a fact. Everywhere else is plain language.

Discipline rules, the PAJA notice and the annexure index are deliberately **not**
writer sections — they are pack assembly (`motivation-pdf-merge.ts`), cited rather
than rewritten, so the model is never set to reproducing a rulebook it cannot verify.

⚠️ **`comparison` is conditional.** It is in the plan only when
`planFor(type, seed, { hasOverlap })` is told the applicant already holds a same-class
firearm — the same condition that puts `overlapNote` in the FactPack, read off
`overlapFromAnswers()` at the one call site in `motivations.service.ts`. Missing when
an overlap exists, it is the likeliest single ground of refusal; present when none
does, it is padding the writer can only fill by inventing. `hasOverlap` therefore joins
the seed as part of the plan's reproducibility key.

⚠️ **Section order is now per licence type**, read off the approved corpus, rather than
one shared shape shuffled four ways. That costs order-variation (a skeleton permutes
one pair, where the old plan permuted four sections freely); what carries the
anti-template load now is five skeletons instead of one, the conditional comparison
section, and four heading alternates per section — per type, where the heading differs
in kind (`statutory_application` names the section of the Act; `the_calibre` names the
requirement). **Watch the admin sameness report** for same-type documents scoring high
against each other; the fix is more heading alternates, not a looser order.

A renewal gets no purpose section (the purpose was accepted when the licence was
granted) and, for the same reason one step on, **no calibre section** — with no stated
requirement, suitability would be argued against nothing.

Headings are chosen from alternates by `seed`, which is fixed at motivation creation
rather than at generation, so an admin regenerating gets the same skeleton.

---

## 11. The field registry

`motivation-fields.ts`, 2070 lines, version `2026-08-19`. **137 unique fields across
10 sections.**

| Licence type | Fields |
|---|---|
| S13 — Self-defence | 117 |
| S15 — Occasional hunter / sport shooter | 117 |
| S16 — Dedicated hunter | 128 |
| S16 — Dedicated sport shooter | 127 |
| S24 — Renewal | 117 |

| Section | Fields | Required |
|---|---|---|
| History | 36 | 12 |
| Firearms you already own | 37 | 0 |
| About you | 25 | 10 |
| The firearm | 9 | 6 |
| Dedicated status | 9 | 3 |
| Experience | 8 | 3 |
| Storage and safety | 6 | 5 |
| Your circumstances | 3 | 2 |
| The existing licence | 3 | 3 |
| SAPS 271 opt-in | 1 | 1 |

**Why a registry and not a free-form prompt** — the generator is only allowed to
*arrange* facts already held; it never invents circumstances. Registering the fields
is what makes that enforceable: the fact pack is built from these keys and nothing
else. A key appears in four places — the wizard renders it, a follow-up targets it,
the generator reads it, the gate names it in `thinFields` — so it is defined once.

`answersSchemaVersion` is stamped on every motivation. Bump `FIELD_REGISTRY_VERSION`
whenever a key is added, removed or re-meant.

**Nothing in the registry is PII.** These are definitions — keys, labels, prompts. The
*answers* are encrypted (`Motivation.answersEncrypted`). That split is why
`thinFields` and `extractedFields` stay queryable in the clear: `safe_storage_detail`
is metadata; its value is not.

---

## 12. Untrusted input handling

User-supplied text goes through `sanitizePromptValue` and is wrapped in an
`UNTRUSTED_NOTICE` block — **except long-form answers**, which are delimited and
marked untrusted instead. `sanitizePromptValue` collapses newlines and truncates at
120 characters; running a long answer through it would destroy the applicant's own
voice, which is the thing that carries into the document.

Secrets never enter a prompt.

---

## 13. File map

| File | Lines | Role |
|---|---|---|
| `motivation-claude.service.ts` | 789 | every Claude call, all parameters |
| `motivation-prompts.ts` | 702 | prompt construction, `FactPack`, gate rubric |
| `motivation-fields.ts` | 2070 | the 137-field registry |
| `motivation-structure.ts` | — | `StructurePlan`, `followsPlan`, `fingerprint`, `similarity` |
| `motivation-verify.ts` | — | `packConsistency` mechanical checks |
| `motivation-overlap.ts` | — | same-class holding detection → `overlapNote` |
| `motivations.service.ts` | — | orchestration, retry, seat accounting |
| `motivation-pdf.service.ts` | — | rendering; `motivation-pdf-merge.ts` merges SAPS 271 + annexures |

---

## 14. Known limits

- **The route is synchronous.** 85s client / 90s nginx / ~100s Cloudflare. Long
  generations are the wall a bigger `max_tokens` would hit. The fix is 202 + polling,
  not a larger number.
- **The gate fails closed.** Anything that stops `grade()` from returning a parseable
  verdict fails every document. Whatever replaces it must preserve that property, and
  must keep the `stop_reason === 'max_tokens'` check that tells a truncated verdict
  apart from a genuinely bad document.
- **One retry, then proceed.** Structure, sameness and mechanics failures do not
  block delivery; they get one regeneration and then the gate decides.
