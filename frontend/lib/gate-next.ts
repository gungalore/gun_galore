/**
 * The gate's `next` target — a relative, same-origin path only.
 *
 * The gate is reached by middleware with the visitor's original pathname in
 * `?next=`. It must never become an open redirect: only a value that starts
 * with a single `/` is allowed, so `//evil.example` and absolute URLs fall
 * back to the homepage. The same helper is used by the Enter control, the
 * sign-up link and the sign-in link so all three agree.
 */
export function safeGateNext(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return '/';
  // A protocol-relative (`//host`) or absolute (`https://…`) URL is an open
  // redirect. Backslashes are normalised to slashes by some browsers, so `/\`
  // must be refused too. Control characters never belong in a path.
  if (
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(raw) ||
    raw.length > 2000
  ) {
    return '/';
  }
  return raw;
}
