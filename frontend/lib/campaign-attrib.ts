// Marketing-campaign signup attribution.
//
// The welcome banner already resolves a ?c=<key> arrival and counts it as a
// banner impression ("hits"). That answers "how many people opened the link",
// but not the question the operator is actually paying per-SMS for: did any of
// them JOIN? This module parks the campaign key for the length of the visit so
// the signup form can attach it to the new Clerk user.
//
// Why sessionStorage rather than passing it through the URL:
//   - the banner deliberately strips ?c= from the address bar immediately, so
//     it never survives into a shared/bookmarked link;
//   - OAuth signup cannot carry it any other way — Clerk's
//     authenticateWithRedirect takes no unsafeMetadata, so the value has to
//     survive a full round-trip to Google and back (same handoff the sign-up
//     consent capture uses).
//
// TTL'd because a tab left open for days must not attribute an unrelated
// signup to a campaign that ran a week ago.

const ATTRIB_KEY = 'gg-campaign-attrib';
const ATTRIB_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface StoredAttrib {
  key: string;
  exp: number;
}

/** Park a resolved campaign key for this visit. Called by the welcome banner
 *  once the backend has confirmed the key belongs to an ACTIVE campaign — an
 *  unrecognised ?c= value never gets stored. */
export function storeCampaignAttrib(key: string): void {
  try {
    const payload: StoredAttrib = { key, exp: Date.now() + ATTRIB_TTL_MS };
    sessionStorage.setItem(ATTRIB_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / storage disabled — attribution is best-effort */
  }
}

/** Read the parked key if one is present and unexpired. Returns undefined
 *  otherwise, so callers can spread it into metadata without a branch. */
export function readCampaignAttrib(): string | undefined {
  try {
    const raw = sessionStorage.getItem(ATTRIB_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<StoredAttrib>;
    if (!parsed?.key || typeof parsed.exp !== 'number') return undefined;
    if (Date.now() > parsed.exp) {
      sessionStorage.removeItem(ATTRIB_KEY);
      return undefined;
    }
    return parsed.key;
  } catch {
    return undefined;
  }
}

/** Drop the parked key once it has been attached to a signup, so a second
 *  account created in the same session isn't attributed to the same blast. */
export function clearCampaignAttrib(): void {
  try {
    sessionStorage.removeItem(ATTRIB_KEY);
  } catch {
    /* ignore */
  }
}
