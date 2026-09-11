/**
 * The member password rule, in one place.
 *
 * Sign-up, reset-password and any future change-password screen all state
 * this rule to the member AND check it as they type. Written out three times
 * it drifts, and the way it drifts is silent: the hint says one thing, the
 * live validation allows another, and the API — the only opinion that counts
 * — refuses on the last click of a sign-up with a message the form never
 * prepared anyone for.
 *
 * ⚠️ THE MIRROR OF THIS FILE IS `backend/src/auth/dto/auth.dto.ts`, and the
 * two must agree character-for-character. The backend cannot import from the
 * frontend, so this is a deliberate duplicate rather than a shared module.
 * `PASSWORD_MIN`, `DIGIT_RE` and `SPECIAL_RE` all have a twin there. Change
 * one, change both, and run `password-rule.spec.ts`.
 *
 * ⚠️ NOTHING HERE MAY BE USED ON A SIGN-IN FORM. Sign-in must fail on the
 * password being wrong, never on it being malformed — a member whose existing
 * password predates a rule change would otherwise be told their own correct
 * password is invalid.
 */

/**
 * ⚠️ SIX IS AN OPERATOR DECISION (2026-09-10) AND IS BELOW EVERY PUBLISHED
 * FLOOR. The lockout counter, the login throttle and bcrypt are what carry
 * the account now; see the backend twin for the full note. No copy anywhere
 * may describe this as a strong-password control.
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 200;

/** Twin: `PASSWORD_DIGIT_RE` in backend/src/auth/dto/auth.dto.ts. */
const DIGIT_RE = /[0-9]/;
/**
 * Twin: `PASSWORD_SPECIAL_RE`. Not a letter, not a digit, and NOT whitespace.
 *
 * ⚠️ The `\s` is load-bearing. Whitespace stays legal *inside* a password, it
 * just cannot be the character that satisfies the rule — otherwise a stray
 * trailing space qualifies invisibly and the member sets a password they can
 * never type again.
 */
const SPECIAL_RE = /[^A-Za-z0-9\s]/;

/** The one-line version, under the field. */
export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters, with a number and a special character.`;

/**
 * The long version, for the tooltip. Each entry is checked independently so
 * the member is told every requirement they have not met yet, not just the
 * first — being sent back three times in a row for one more rule each time is
 * how a sign-up gets abandoned.
 */
export const PASSWORD_RULES: ReadonlyArray<{
  readonly label: string;
  readonly ok: (password: string) => boolean;
}> = [
  {
    label: `${PASSWORD_MIN} characters or more`,
    ok: (p) => p.length >= PASSWORD_MIN,
  },
  { label: 'At least one number (0–9)', ok: (p) => DIGIT_RE.test(p) },
  {
    label: 'At least one special character (! ? # @ …)',
    ok: (p) => SPECIAL_RE.test(p),
  },
];

/**
 * The single message to show under the field, or null when the password is
 * acceptable. Deliberately names every unmet requirement in one sentence.
 *
 * An EMPTY password returns null: "you have not typed anything yet" is not an
 * error to shout at someone, and `required` already covers the empty submit.
 */
export function passwordProblem(password: string): string | null {
  if (password.length === 0) return null;
  if (password.length > PASSWORD_MAX) {
    return `Use ${PASSWORD_MAX} characters or fewer.`;
  }

  const missing: string[] = [];
  if (password.length < PASSWORD_MIN) missing.push(`${PASSWORD_MIN} characters`);
  if (!DIGIT_RE.test(password)) missing.push('a number');
  if (!SPECIAL_RE.test(password)) missing.push('a special character');
  if (missing.length === 0) return null;

  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`;
  return `Needs ${list}.`;
}

/** True when the password satisfies every rule. */
export function passwordOk(password: string): boolean {
  return password.length > 0 && passwordProblem(password) === null;
}
