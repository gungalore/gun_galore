#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────
// Does the live key actually answer? Run this BEFORE deploying.
//
//   cd backend && node scripts/llm-ping.mjs
//
// ⚠️ STANDALONE ON PURPOSE. It does not import LlmService, PrismaService or
// anything else from src/. That is the point: it has to be runnable on the
// box with nothing built, no database reachable and no Nest container, so
// that "is the key good?" can be answered without first answering "does the
// app boot?". It reads backend/.env directly and calls @google/genai.
//
// It costs a fraction of a cent. It does NOT write a ledger row — the ledger
// belongs to the app, and a deploy check should not leave traces in it.
// ────────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env');

/**
 * Minimal .env reader — no dotenv dependency, because this script must run
 * from a bare checkout. Handles `KEY=value`, `export KEY=value`, comments,
 * blank lines and surrounding quotes. Does NOT do multi-line values; nothing
 * in this file's AI block needs them.
 */
function readEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

const fileEnv = readEnvFile(envPath);
// ⚠️ The real process env WINS, so an operator can override for one run:
//   GEMINI_API_KEY=... node scripts/llm-ping.mjs
const env = { ...fileEnv, ...process.env };

const apiKey = env.GEMINI_API_KEY;
const model = env.LLM_MODEL || 'gemini-3.5-flash-lite';

if (env.LLM_PROVIDER === 'anthropic') {
  console.log(
    'NOTE: LLM_PROVIDER=anthropic — the app is on the rollback rail.\n' +
      '      This script only tests Gemini. It is still worth running before\n' +
      '      switching back, to confirm the key you are switching TO works.',
  );
}

if (!apiKey) {
  console.error(`FAIL  GEMINI_API_KEY is not set (looked in ${envPath} and the shell).`);
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });
const startedAt = Date.now();

try {
  const res = await ai.models.generateContent({
    model,
    contents: [
      { role: 'user', parts: [{ text: 'reply with the single word ok' }] },
    ],
    // No thinkingConfig on purpose: 2.5 takes thinkingBudget and every 3.x
    // model 400s on it (probed 2026-09-07). Flash-Lite of either generation
    // thinks nothing on a two-word prompt anyway, so the latency printed is
    // the round trip.
    config: { maxOutputTokens: 16 },
  });
  const latencyMs = Date.now() - startedAt;

  const text = (res.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
    .trim();
  const u = res.usageMetadata ?? {};
  const finish = res.candidates?.[0]?.finishReason ?? '(none)';

  console.log('OK');
  console.log(`  model      ${res.modelVersion ?? model}`);
  console.log(`  latency    ${latencyMs}ms`);
  console.log(`  reply      ${JSON.stringify(text)}`);
  console.log(`  finish     ${finish}`);
  console.log(
    `  usage      in=${u.promptTokenCount ?? 0} out=${u.candidatesTokenCount ?? u.responseTokenCount ?? 0} cached=${u.cachedContentTokenCount ?? 0} thoughts=${u.thoughtsTokenCount ?? 0} total=${u.totalTokenCount ?? 0}`,
  );

  // An empty reply with a 200 is the failure mode worth naming: the key and
  // the model are fine and a safety filter ate the answer. Silent otherwise.
  if (!text) {
    console.log(
      '\n  ⚠️  The call succeeded but returned NO TEXT. Check finishReason above —\n' +
        '      SAFETY / PROHIBITED_CONTENT means the filter blocked it.',
    );
  }
  process.exit(0);
} catch (err) {
  console.error(`FAIL  after ${Date.now() - startedAt}ms`);
  console.error(`  model    ${model}`);
  console.error(`  error    ${err?.message ?? String(err)}`);
  if (err?.status) console.error(`  status   ${err.status}`);
  process.exit(1);
}
