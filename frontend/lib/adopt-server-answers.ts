// ────────────────────────────────────────────────────────────────────
// THE CLIENT ADOPTS WHAT THE SERVER WROTE, AND THE MEMBER STILL WINS.
//
// `PATCH /motivations/:id/answers` does not only store what it is sent — it
// RE-DERIVES. Change `firearm_type` and the server rewrites the competency
// block to the certificate that actually covers that firearm, the same way
// changing an address rewrites the police station.
//
// ⚠️ THE CLIENT USED TO ERASE THAT, AND THE ERASURE WAS PERMANENT. Nothing on
// the response told the browser anything had changed, so it went on holding the
// OLD certificate number and posted the whole answers map on the next
// keystroke. The server then read the stale value as a change the MEMBER had
// made and stamped it MEMBER — which is absorbing: MEMBER is never re-offered,
// never re-derived and never replaced. From that moment the wrong certificate
// number is locked onto a SAPS 271 that gets signed (it fills
// g_competency_number and ticks g_competency_for_handgun/rifle/shotgun),
// wearing a "You entered this" chip nobody earned.
//
// ⚠️ AND THE OPPOSITE MISTAKE IS EXACTLY AS SILENT. A save takes a round trip
// and the member keeps typing through it. Merging the response over whatever is
// on screen when it lands deletes every character typed in that window.
//
// ⚠️ SO THE COMPARISON IS AGAINST WHAT WAS SENT, NEVER AGAINST WHAT IS ON
// SCREEN. We overwrite our own stale copy and never theirs.
//
// ⚠️ PURE, AND IN lib/ RATHER THAN BESIDE THE HOOK, BECAUSE IT IS A RULE — and
// because it is the part that fails invisibly in both directions. The runner's
// `include` is `lib/**/*.spec.ts` and `components/**/*.spec.tsx`, so a spec
// next to the hook in hooks/ would be written, would pass, and would never once
// be collected.
// ────────────────────────────────────────────────────────────────────

/**
 * Merge the answers the server re-derived into the ones on screen.
 *
 * @param current what the screen holds right now
 * @param sent    the exact map the save request carried
 * @param fromServer the answers the server says it changed
 */
export function adoptServerAnswers(
  current: Record<string, string>,
  sent: Record<string, string>,
  fromServer: Record<string, string>,
): Record<string, string> {
  let changed = false;
  const next = { ...current };
  for (const [key, value] of Object.entries(fromServer)) {
    const wasSent = sent[key] ?? '';
    const now = next[key] ?? '';
    // The member has typed since the request left: theirs stands.
    if (now !== wasSent) continue;
    if (now === value) continue;
    next[key] = value;
    changed = true;
  }
  // ⚠️ THE SAME OBJECT WHEN NOTHING MOVED. A fresh identity on every save would
  // re-run every useMemo and useEffect keyed on `answers`, on a timer, on
  // screens that re-derive the visible fields and the whole section grouping
  // from it.
  return changed ? next : current;
}
