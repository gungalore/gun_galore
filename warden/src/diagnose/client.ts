// warden/src/diagnose/client.ts
//
// The one place this daemon talks to Anthropic.
//
// 🚨 THE API KEY IS READ FROM ENV, HELD IN THE CLIENT, AND NEVER LOGGED,
// NEVER RETURNED, NEVER PUT IN A MESSAGE, A PROPOSAL OR A PROMPT. Rule 8.
// describeModelConfig() below reports PRESENCE AND SHAPE ONLY, and the error
// path runs every message through redactSecrets() before it can reach a log
// line or a chat message — a 401 body or a dependency's stack trace is
// exactly the kind of third-party text that can echo a credential back under
// a name this process never declared.
//
// The model comes from env with a sane default. It is deliberately not
// pinned in a comment as if it were a contract: the default moves when the
// repo's other Claude callers move (they all follow the same
// ANTHROPIC_MODEL_* override pattern), and an operator can point this one
// elsewhere for a sweep without a deploy.
//
// ⚠️ NEVER AWAIT THIS INSIDE GET /chat. The backend cuts a read at 8s and a
// write at 25s, and POST /proposals/:id/approve has already spent part of its
// 25s on its own GET. A diagnosis turn belongs to the background sweep loop,
// which writes its result to the store; GET /chat only ever reads what is
// already there. The one turn that may legitimately await a model call is
// POST /chat, and that is why DEFAULT_TIMEOUT_MS is well under the 25s budget
// rather than generous.

import Anthropic from '@anthropic-ai/sdk';
import { redactSecrets } from '../exec/index.js';
import { buildSystemPrompt, buildUserPrompt } from './prompt.js';
import type { DiagnosisInput } from './types.js';

const MODEL =
  process.env.ANTHROPIC_MODEL_WARDEN ??
  process.env.ANTHROPIC_MODEL_JUDGE ??
  'claude-sonnet-4-6';

/** Under the backend's 25s write budget with room for the two-hop approve
 *  path — a sweep that wants longer passes its own value. */
const DEFAULT_TIMEOUT_MS = Number(process.env.WARDEN_MODEL_TIMEOUT_MS ?? 20_000);

/** A diagnosis is a handful of short items. A bigger ceiling buys nothing and
 *  lets one bad turn cost real money. */
const MAX_TOKENS = 4_096;

export type ModelReply = { ok: true; text: string; model: string } | { ok: false; reason: string };

/**
 * What diagnose() actually depends on: one function, facts in, text out.
 * Injected rather than imported so the diagnosis logic can be tested against
 * a scripted model with no key, no network and no SDK in the test process —
 * the interesting failures (a hostile fact, a malformed reply) are all
 * reachable through this seam.
 */
export type ModelCaller = (input: DiagnosisInput) => Promise<ModelReply>;

/**
 * Presence and shape of the credential, for the env check and the boot log.
 * NEVER the value, never a prefix of it, never its first characters — a
 * prefix is still a piece of a secret.
 */
export function describeModelConfig(env: NodeJS.ProcessEnv = process.env): {
  configured: boolean;
  looksLikeAnthropicKey: boolean;
  model: string;
} {
  const key = env.ANTHROPIC_API_KEY ?? '';
  return {
    configured: key.length > 0,
    looksLikeAnthropicKey: /^sk-ant-\S{20,}$/.test(key),
    model: env.ANTHROPIC_MODEL_WARDEN ?? env.ANTHROPIC_MODEL_JUDGE ?? MODEL,
  };
}

/**
 * Make an error safe to log or to put in a 'note' message. Anthropic's own
 * errors do not carry the key, but a proxy's 407 body, a DNS failure naming a
 * URL with credentials in it, or a wrapped fetch error might — and this is
 * the one path in the diagnosis layer where third-party text reaches a log
 * line, so it is redacted rather than trusted.
 */
export function safeErrorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactSecrets(raw).text.slice(0, 500);
}

/**
 * The production caller. Returns null when ANTHROPIC_API_KEY is unset — the
 * daemon then raises a red gate saying so (see diagnose.ts) rather than
 * silently producing no findings, which is indistinguishable from a healthy
 * box and is the exact "fail soft looks like fine" trap
 * backend/src/common/claude-request-params.spec.ts was written about.
 */
export function createAnthropicCaller(opts?: { timeoutMs?: number }): ModelCaller | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const client = new Anthropic({
    apiKey,
    timeout: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: 1,
  });

  return async (input: DiagnosisInput): Promise<ModelReply> => {
    try {
      // ⚠️ NO SAMPLING PARAMETERS. temperature/top_p/top_k were removed from
      // the API on the models this repo runs, and sending one returns a 400
      // that every caller here swallows — which on 2026-08-19 left four
      // features silently doing nothing for two days. See
      // backend/src/common/claude-request-params.spec.ts; diagnose.test.ts
      // greps this directory for the same three names.
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: buildUserPrompt(input) }],
      });
      const first = res.content.find((b) => b.type === 'text');
      const text = first && 'text' in first ? first.text : '';
      if (!text.trim()) return { ok: false, reason: 'the model returned an empty reply' };
      return { ok: true, text, model: MODEL };
    } catch (err) {
      return { ok: false, reason: safeErrorText(err) };
    }
  };
}
