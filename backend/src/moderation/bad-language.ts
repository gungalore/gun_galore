// ────────────────────────────────────────────────────────────────────
// BAD LANGUAGE IS MASKED, NOT REJECTED.
//
// JEV can say "this text contains bad language" but a probability is not a
// span, so the words still have to be found before they can be censored. This
// is the deterministic half of that pair: a narrow, word-boundary list of the
// English and Afrikaans profanity the community actually uses. It runs on
// every outbound post and comment, so the stored text can stay intact for
// moderation and the member still sees the civil version.
//
// ⚠️ DO NOT WIDEN THIS TO SEXUAL TERMS. Sexual content is a BLOCK, not a
// mask (FeedModerationService). A masked sexual word would hide the very
// thing the block exists to catch.
// ────────────────────────────────────────────────────────────────────

/**
 * Longest first: `fucking` must match before `fuck`, or the suffix survives.
 * The list is deliberately conservative — a word boundary, no fuzzy spelling.
 * A determined evader still gets caught by the JEV classifier; this is for
 * the ordinary post, not an adversarial one.
 */
const WORDS = [
  'fucking',
  'fuckers',
  'fucker',
  'fucked',
  'fuck',
  'motherfucker',
  'motherfucking',
  'bullshit',
  'shitty',
  'shitting',
  'shit',
  'bastards',
  'bastard',
  'assholes',
  'asshole',
  'arseholes',
  'arsehole',
  'bitches',
  'bitching',
  'bitch',
  'dickhead',
  'dickheads',
  'cunts',
  'cunt',
  'twats',
  'twat',
  'wankers',
  'wanker',
  'whores',
  'whore',
  'sluts',
  'slut',
  'faggots',
  'faggot',
  'niggers',
  'nigger',
  'kaffirs',
  'kaffir',
  'poes',
  'doos',
  'kont',
  'kak',
  'fokken',
  'fok',
  'bliksem',
  'donder',
  'moer',
  'naaier',
  'naai',
  'piel',
] as const;

const PATTERN = new RegExp(`\\b(?:${WORDS.join('|')})\\b`, 'gi');

/**
 * Replace the body of each profane word with asterisks, keeping its first
 * letter and its length. Punctuation, case and the rest of the sentence are
 * untouched, so a quoted or capitalised word still reads naturally.
 */
export function maskBadLanguage(text: string): string {
  if (!text) return text;
  return text.replace(PATTERN, (word) =>
    word[0] + '*'.repeat(Math.max(1, word.length - 1)),
  );
}
