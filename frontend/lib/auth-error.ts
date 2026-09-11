/**
 * Turn an auth API failure into a sentence a member can act on.
 *
 * ⚠️ THE REASON THIS EXISTS: every auth screen used to render `data.message`
 * verbatim, and the API's message is not always ours. Nest answers a tripped
 * rate limit with the literal string "ThrottlerException: Too Many Requests"
 * — which is what a member saw, in red, above a filled-in sign-up form, with
 * no indication of what to do or how long to wait. Framework vocabulary in a
 * member-facing form is a bug, not a message.
 *
 * Every `/api/auth/*` route is throttled (register 5/hour, login 10/min,
 * verify 10/10min, resend 3/10min), so EVERY auth screen can produce that
 * string. Use this on all of them.
 *
 * Our own validation messages are written for members and pass through
 * unchanged — the point is to filter framework leakage, not to flatten
 * everything into one unhelpful sentence.
 */

/** Messages that come from the framework rather than from us. */
function isFrameworkLeak(message: string): boolean {
  return (
    /exception/i.test(message) ||
    message === 'Internal server error' ||
    message === 'Bad Request' ||
    message === 'Unauthorized' ||
    message === 'Forbidden'
  );
}

/**
 * How long to wait, phrased for a human.
 *
 * `Retry-After` is seconds. Rounding UP matters: telling someone to wait "1
 * minute" when it is 90 seconds sends them back to a second refusal, which
 * reads as the site being broken rather than as them being early.
 */
function waitPhrase(retryAfter: string | null): string {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return 'in a few minutes';
  if (seconds <= 90) return 'in a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `in about ${minutes} minutes`;
  const hours = Math.ceil(minutes / 60);
  return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
}

export function authErrorMessage(
  res: { status: number; headers?: { get(name: string): string | null } },
  body: unknown,
  fallback: string,
): string {
  // Rate limiting first: the body carries the framework string, so reading
  // the body before the status is how the leak got out in the first place.
  if (res.status === 429) {
    const retryAfter = res.headers?.get('Retry-After') ?? null;
    return `Too many attempts. Try again ${waitPhrase(retryAfter)}.`;
  }

  if (res.status >= 500) {
    return 'Something went wrong on our end. Please try again shortly.';
  }

  const message = (body as { message?: string | string[] } | null)?.message;

  // class-validator hands back an array, one entry per failed rule, all
  // written by us. Show the first — the member fixes them one at a time
  // anyway, and a stack of red is worse than a single instruction.
  if (Array.isArray(message)) {
    const first = message.find((m) => typeof m === 'string' && m.trim());
    return first && !isFrameworkLeak(first) ? first : fallback;
  }

  if (typeof message === 'string' && message.trim() && !isFrameworkLeak(message)) {
    return message;
  }

  return fallback;
}
