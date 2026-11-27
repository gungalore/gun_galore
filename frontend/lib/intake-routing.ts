import type { IntakeStage } from './motivations-api';

// ────────────────────────────────────────────────────────────────────
// WHERE A REFRESHED SCREEN SENDS SOMEBODY.
//
// ⚠️ THE "ANOTHER SCREEN" BUG. Both the start screen and the interview used to
// decide this inline, and both sent a REVIEW-stage application to the pack. A
// member who reloaded mid-interview, or came back from a notification, landed on
// the pack screen instead of the card they were answering. The rule is: a
// finished application (`completed === true`) goes on to the review screen; an
// unfinished one stays in the interview until the member finishes it themselves.
//
// ⚠️ PURE AND TESTED BECAUSE IT IS TWO PAGES' WHOLE ROUTING. A duplicated
// condition here is a duplicate bug; keeping it in one function means the two
// screens cannot disagree about where "back" goes.
// ────────────────────────────────────────────────────────────────────

/**
 * The interview page's redirect, or null when it should render.
 *
 * MODE/DOCUMENTS are pre-interview states — the member still has to choose a
 * product or pick documents, which happens on the start screen.
 */
export function interviewRedirectFor(
  id: string,
  stage: IntakeStage,
  completed: boolean | undefined,
): string | null {
  if (stage === 'MODE' || stage === 'DOCUMENTS') {
    return `/licence-centre/${id}/start`;
  }
  if (stage === 'REVIEW' && completed === true) {
    return `/licence-centre/${id}`;
  }
  return null;
}

/**
 * The start page's redirect, or null when it should render.
 *
 * ⚠️ A REVIEW-STAGE APPLICATION WITH `completed` FALSY GOES BACK TO THE
 * INTERVIEW, NOT THE PACK. That is the mid-interview resume case: there is still
 * something to ask, and the completion card is where the member says they are
 * done.
 */
export function startRedirectFor(
  id: string,
  stage: IntakeStage,
  completed: boolean | undefined,
): string | null {
  if (stage === 'INTERVIEW') return `/licence-centre/${id}/interview`;
  if (stage === 'REVIEW') {
    return completed === true
      ? `/licence-centre/${id}`
      : `/licence-centre/${id}/interview`;
  }
  return null;
}
