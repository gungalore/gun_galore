// Local smoke test for the Value My Item model (Qwen Cloud, qwen3.8-flash).
//
//   cd backend
//   npm run build                                   # uses the compiled provider
//   node scripts/valuation-model-smoke.mjs search "Vortex Viper PST Gen II 5-25x50 South Africa price"
//   node scripts/valuation-model-smoke.mjs identify "C:\\path\\to\\photo.jpg"
//
// Reads QWEN_API_KEY (or DASHSCOPE_API_KEY) and optional QWEN_BASE_URL /
// VALUATION_MODEL from backend/.env. No database and no server needed; this
// only proves the model + gateway + schema wiring. For the full flow use the
// browser at /value.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(here, '..');

// Minimal .env loader (no dotenv dependency).
for (const line of readFileSync(join(backendRoot, '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
}

const require = createRequire(import.meta.url);
let QwenProvider,
  IDENTIFY_SCHEMA,
  identifySystemPrompt;
try {
  ({ QwenProvider } = require(join(backendRoot, 'dist/src/common/llm/qwen.provider.js')));
  ({ IDENTIFY_SCHEMA } = require(join(backendRoot, 'dist/src/valuation/schemas.js')));
  ({ identifySystemPrompt } = require(join(backendRoot, 'dist/src/valuation/prompts.js')));
} catch (err) {
  console.error('Could not load the compiled backend. Run `npm run build` first.\n', err.message);
  process.exit(1);
}

const provider = new QwenProvider();
if (!provider.isConfigured()) {
  console.error('No QWEN_API_KEY (or DASHSCOPE_API_KEY) in backend/.env');
  process.exit(1);
}

const [mode, arg] = process.argv.slice(2);
console.log(`provider=qwen model=${provider.defaultModel()} base=${process.env.QWEN_BASE_URL ?? '(default)'}`);

async function search(query) {
  const res = await provider.complete({
    system: 'You research South African marketplace listings. Cite the URLs you opened.',
    messages: [{ role: 'user', content: query }],
    maxTokens: 8192,
    temperature: 0,
    grounding: { web: true },
    thinking: { budgetTokens: 4096 },
    purpose: 'valuation.research',
    timeoutMs: 300_000,
  });
  console.log('\n--- answer ---\n' + res.text);
  console.log('\nsources:', (res.groundingSources ?? []).map((s) => s.uri).join(', ') || '(none)');
  console.log('queries:', JSON.stringify(res.webSearchQueries ?? []));
  console.log('usage:', JSON.stringify(res.usage));
}

async function identify(photoPath) {
  const buf = readFileSync(resolve(photoPath));
  const ext = (photoPath.split('.').pop() || 'jpg').toLowerCase();
  const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const res = await provider.complete({
    system: identifySystemPrompt(1),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', mimeType, data: buf.toString('base64') },
          { type: 'text', text: 'No description was provided.' },
        ],
      },
    ],
    maxTokens: 2048,
    temperature: 0.2,
    json: { schema: IDENTIFY_SCHEMA },
    thinking: { budgetTokens: 0 },
    purpose: 'valuation.identify',
    timeoutMs: 120_000,
  });
  console.log('\n--- identify JSON ---\n' + res.text);
  console.log('usage:', JSON.stringify(res.usage));
}

(async () => {
  if (mode === 'search' && arg) return search(arg);
  if (mode === 'identify' && arg) return identify(arg);
  console.log(
    '\nUsage:\n' +
      '  node scripts/valuation-model-smoke.mjs search "<query>"\n' +
      '  node scripts/valuation-model-smoke.mjs identify "<photo path>"',
  );
})().catch((err) => {
  console.error('ERROR', err.code || '', err.status || '', String(err.message).slice(0, 300));
  process.exit(1);
});
