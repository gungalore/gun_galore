import * as fs from 'node:fs';
import * as path from 'node:path';

// ────────────────────────────────────────────────────────────────────
// NO SAMPLING PARAMETERS ON A CLAUDE CALL.
//
// temperature / top_p / top_k were REMOVED from the Anthropic API on Opus 4.7
// and later, and on Sonnet 5 — which is what ANTHROPIC_MODEL_JUDGE points at
// in production. Sending one returns:
//
//   400 {"type":"invalid_request_error",
//        "message":"`temperature` is deprecated for this model."}
//
// ⚠️ THIS TEST EXISTS BECAUSE THE FAILURE IS SILENT.
//
// On 2026-08-19 the operator reported "it does not recognize my proof of
// address". The cause was `temperature: 0` on four Claude calls. Every one of
// them fails soft — the 400 was caught, logged at warn level, and the feature
// simply did nothing:
//
//   • document extraction returned no fields, so nothing prefilled
//   • the motivation quality gate failed CLOSED, so no document could pass
//   • Claude KYC had been failing since 2026-08-17, two days unnoticed
//
// Nothing alerted, because from the outside a fail-soft path and a working
// path that finds nothing look identical. A grep is a poor test in general;
// here it is the right one, because the thing being guarded is a parameter
// name in a request body and the consequence of getting it wrong is silence.
// ────────────────────────────────────────────────────────────────────

const BANNED = ['temperature', 'top_p', 'top_k'];

/** Every file that builds an Anthropic request. */
function claudeCallers(): string[] {
  const root = path.join(__dirname, '..');
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) {
        continue;
      }
      const src = fs.readFileSync(full, 'utf8');
      // The marker of a real request: the SDK's create call.
      if (/messages\.create\(/.test(src)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/** Strip comments, so the explanatory notes above each call site do not trip. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .join('\n');
}

describe('Claude request parameters', () => {
  const files = claudeCallers();

  it('finds the services that call Claude, so this test is not vacuous', () => {
    // If the SDK call shape ever changes, this test would silently pass over
    // an empty file list and guard nothing.
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(BANNED)('never passes %s — it is a 400 on our models', (param) => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = code(fs.readFileSync(file, 'utf8'));
      // As an object property: `temperature: 0`. Not `tempC`, not prose.
      if (new RegExp(`(^|[\\s{,(])${param}\\s*:`).test(src)) {
        offenders.push(path.relative(path.join(__dirname, '..'), file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaves a note at each call site saying why there is none', () => {
    // The absence of a parameter teaches nobody anything. Someone tuning
    // output quality will reach for temperature first; the comment is what
    // stops them re-introducing a silent outage.
    const noted = files.filter((f) =>
      /temperature/i.test(fs.readFileSync(f, 'utf8')),
    );
    expect(noted.length).toBeGreaterThanOrEqual(3);
  });
});
