// warden/src/exec/audit.ts
//
// THE AUDIT RECORD — the one artefact every execution produces, safe-list run
// and operator-approved command alike. Rule 7: "Every execution writes an audit
// record: the operation, its resolved arguments, the exit code, and the
// VERBATIM stdout/stderr, truncated with the truncation stated."
//
// "Verbatim" and "redacted" both have to be true at once, because rule 8 says a
// secret must never reach a proposal, a log line, a chat message or a prompt.
// ⚠️ LOAD-BEARING ORDERING: redactSecrets() runs BEFORE truncateOutput(), so a
// secret sitting across the truncation boundary can never be cut into a still
// -readable half. prepareOutput() is the only function that does both, and it
// is the only way output reaches a record — there is no path from a command's
// raw output to storage that skips it.

export interface TruncatedText {
  text: string;
  truncated: boolean;
  /** Size BEFORE truncation, so a reader can see how much was withheld rather
   *  than wondering whether they are looking at everything. */
  originalBytes: number;
}

export interface WardenAuditRecord {
  id: string;
  /** ISO-8601 UTC, when the command actually started. */
  at: string;
  /** ISO-8601 UTC, when it finished, was killed on timeout, or errored. */
  finishedAt: string;
  durationMs: number;

  /**
   * `unattended`: no human in the loop — only ever reachable for a SAFE_LIST
   * operation. `operator_approved`: reached through POST /proposals/:id/approve
   * after the compare-and-swap on the exact command shown.
   */
  trigger: 'unattended' | 'operator_approved';
  /** The admin who approved it. Null only for `unattended`. */
  operatorId: string | null;
  /** Every execution is tied to a proposal — an unattended safe-list run raises
   *  its own already-resolved proposal — so the thread and the audit trail can
   *  never disagree about what happened. */
  proposalId: string;

  operation: {
    kind: 'safe_list' | 'approved_command';
    /** Safe-list operation name. Null for `approved_command`: that path has no
     *  named operation, only a string a human read. */
    name: string | null;
    /** The RESOLVED, VALIDATED arguments — never the raw selection. Anything
     *  the caller sent that validate() did not accept is not here, which is
     *  what makes this row a truthful account of what ran. */
    args: Record<string, string | number | boolean> | null;
  };

  /**
   * The EXACT command that ran. For a safe-list op this is BuiltOperation
   * .describe, which describePlan() derives from the same plan run() executes,
   * so it cannot drift. For an approved command it is the literal string the
   * confirm dialog showed and `expectedCommand` echoed back. Written in full —
   * a reader must never have to resolve it from an id.
   */
  command: string;

  exitCode: number | null;
  timedOut: boolean;

  /** Redacted, then truncated. See the ordering note above. */
  stdout: TruncatedText;
  stderr: TruncatedText;

  /** NAMES of what fired — an env var key, or the pattern class
   *  (`postgres-url-password`, `bearer-token`) — never the value. Always
   *  present, empty when nothing fired: a reader must never have to wonder
   *  whether redaction ran at all. */
  redactions: string[];

  /**
   * Set only once Warden has actually re-measured the condition after the run
   * ("ran · re-checked"). Null until then — ⚠️ null and `{result:'unknown'}` are
   * deliberately different claims: "nobody has looked yet" is not the same as
   * "looked and could not tell", and collapsing them is the plausible-zero
   * failure this whole design exists to avoid.
   */
  recheck: { at: string; result: 'ok' | 'still-bad' | 'unknown'; note: string } | null;
}

// ── redaction ───────────────────────────────────────────────────────────────

/** Env var NAMES worth a blanket value sweep. This decides which env VALUES get
 *  checked for a literal hit in output; it does not by itself declare anything
 *  a secret. Shaped after the families this box actually holds (VERIFYNOW_*,
 *  PEACH_*, ZOHO_*, WARDEN_TOKEN) plus the usual *_SECRET/*_TOKEN/*_KEY family. */
const SENSITIVE_ENV_NAME = /(SECRET|TOKEN|PASSWORD|_KEY$|API_KEY|DATABASE_URL)/i;

/** Below this length a value is too short to blanket-match without eating
 *  ordinary words — `3001`, `true`, `production` all live in env vars. */
const MIN_REDACTABLE_VALUE = 8;

/**
 * Nets for secrets whose NAME this process does not hold. A value can arrive in
 * a third party's error body — a driver's connection failure, a dependency's
 * stack trace — under a name Warden never declared, so name-based sweeping
 * alone is not enough.
 *
 * ⚠️ Two lists on purpose. A /g regex with NO capture group, handed to a
 * replace() callback, calls that callback as (match, offset, string): reading
 * argument two as "the captured secret" then silently no-ops, because offset is
 * a number. One shared branch across both shapes is exactly how that bug gets
 * reintroduced. Keeping them apart makes it un-writable.
 */
const WHOLE_MATCH_NETS: ReadonlyArray<readonly [RegExp, string]> = [
  // Deliberately no leading \b: a key glued to surrounding text — a stack
  // trace, a URL, a JSON blob with no separator — is still a key, and a word
  // boundary would let exactly that case through.
  [/sk-ant-[A-Za-z0-9_-]{10,}/g, 'anthropic-api-key-shape'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, 'bearer-token'],
  // A signed JWT — an admin token or a Clerk session lands in an error body
  // looking exactly like this.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g, 'jwt-shape'],
  // `PGPASSWORD=…`, `RESEND_API_KEY=…` echoed by a script's `set -x` or an env
  // dump. The NAME must itself look sensitive, so `PAYMENTS_LIVE=true` and
  // `NODE_ENV=production` survive — they are diagnostic, not secret.
  [/\b[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|_KEY)=\S+/g, 'env-assignment'],
];

/** Capture-group nets: the match is context worth keeping, group 1 is the part
 *  to blank. A Postgres URL's user@host is useful evidence; only the password
 *  is a secret. */
const CAPTURED_NETS: ReadonlyArray<readonly [RegExp, string]> = [
  [/postgres(?:ql)?:\/\/[^:@\s/]+:([^@\s]+)@/gi, 'postgres-url-password'],
];

/**
 * Detection happens INSIDE replace(), never through a preceding `.test()`.
 * These nets are module-scope /g regexes, so they carry lastIndex between
 * calls: `test()` advances it and leaves it advanced, and any later read that
 * is not a replace() then starts matching from the middle of the next string.
 * (A `test()` immediately followed by a global `replace()` happens to survive,
 * because replace resets lastIndex — verified by mutation. Relying on that is
 * still the wrong habit, since it breaks the moment someone adds a second
 * `test()` or an `exec()`, so detection here never reads that state at all.)
 */
export function redactSecrets(text: string): { text: string; redactions: string[] } {
  let out = text;
  const hits: string[] = [];

  for (const [key, value] of Object.entries(process.env)) {
    if (!value || value.length < MIN_REDACTABLE_VALUE) continue;
    if (!SENSITIVE_ENV_NAME.test(key)) continue;
    if (!out.includes(value)) continue;
    out = out.split(value).join(`[REDACTED:${key}]`);
    hits.push(key);
  }

  for (const [re, label] of CAPTURED_NETS) {
    let fired = false;
    const next = out.replace(re, (match: string, captured: string) => {
      fired = true;
      return match.replace(captured, '[REDACTED]');
    });
    if (fired) {
      out = next;
      hits.push(label);
    }
  }

  for (const [re, label] of WHOLE_MATCH_NETS) {
    let fired = false;
    const next = out.replace(re, () => {
      fired = true;
      return '[REDACTED]';
    });
    if (fired) {
      out = next;
      hits.push(label);
    }
  }

  return { text: out, redactions: hits };
}

// ── truncation ──────────────────────────────────────────────────────────────

/** Generous enough for a real stack trace or a pg_dump summary, bounded so one
 *  runaway command cannot blow out the audit store or the chat thread. */
export const MAX_OUTPUT_BYTES = 20_000;

export function truncateOutput(text: string, maxBytes = MAX_OUTPUT_BYTES): TruncatedText {
  const originalBytes = Buffer.byteLength(text, 'utf8');
  if (originalBytes <= maxBytes) return { text, truncated: false, originalBytes };

  // Cutting a UTF-8 buffer mid-codepoint yields a U+FFFD replacement char. Drop
  // a trailing one rather than shipping a mojibake byte into a record the Desk
  // renders verbatim.
  let cut = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  if (cut.endsWith('�') && !text.slice(0, cut.length).endsWith('�')) cut = cut.slice(0, -1);

  return {
    text: `${cut}\n…[truncated ${originalBytes - maxBytes} more bytes]`,
    truncated: true,
    originalBytes,
  };
}

/** REDACT then TRUNCATE — the only way command output becomes a record. */
export function prepareOutput(raw: string, maxBytes = MAX_OUTPUT_BYTES): TruncatedText & { redactions: string[] } {
  const { text, redactions } = redactSecrets(raw);
  return { ...truncateOutput(text, maxBytes), redactions };
}
