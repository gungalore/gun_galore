'use client';

// ────────────────────────────────────────────────────────────────────
// SAVING A MEMBER'S ANSWERS, AND THE FIVE RULES THAT MUST NOT DIVERGE.
//
// Two screens now edit one application — the wizard at /motivations/[id] and
// the pack at /licence-services/[id]. Two copies of this logic would be two
// answers to "did that save?", and the failure mode is silent: a member keeps
// typing into a box that will be empty after they reload.
//
// ⚠️ THE MIGRATION IS DONE — BOTH SCREENS CALL THIS, so there is no longer a
// second copy of these rules to keep in step. The wizard's two extras (it
// re-reads the overlap verdict when a calibre changes, and it updates the
// detail row it holds) ride on `onSaved` and `onResponse`, which is what those
// callbacks are for. A change here reaches both screens; so does a mistake.
//
// The rules, every one of which was learned the hard way:
//
//   1. THE DRAFT IS WRITTEN BEFORE THE REQUEST, NOT AFTER. Whatever is typed
//      inside the debounce window exists nowhere else.
//
//   2. ⚠️ A 200 IS NOT A SAVE. The server returns `refused` — the registered
//      fields whose value it would not store — and saying "Saved" over that is
//      how an answer is lost without anybody being told: the box keeps the
//      text until the page reloads, then quietly comes back empty.
//
//   3. ⚠️ THE DRAFT IS CLEARED ONLY AFTER A CLEAN SAVE. Clearing on send would
//      throw the answers away precisely when the request failed. A refusal is
//      not clean, so a refused save keeps its draft too.
//
//   4. Nothing is sent until something is actually dirty. Mounting a screen is
//      not an edit, and a save on load would stamp MEMBER provenance over
//      every value the system filled in itself.
//
// The caller supplies what is ITS business through two callbacks, and the
// difference between them matters:
//
//   onResponse — EVERY 200, refused or not. For anything derived from the
//                server's own view of the application, like missingRequired:
//                a refusal is still a true answer about what is outstanding,
//                and throwing it away leaves a stale list on screen.
//
//   onSaved    — only a CLEAN save. For work that is only correct once the
//                answers actually landed, like the wizard re-reading the
//                overlap verdict after a calibre changed.
//
//   onAdopt    — the answers THE SERVER CHANGED while saving. See below.
//
// ⚠️ 5. THE SERVER WRITES ANSWERS OF ITS OWN, AND THIS HOOK USED TO ERASE
// THEM. `saveAnswers` re-derives on the way through: change `firearm_type` and
// it rewrites the competency block to the certificate that actually covers
// that firearm. Nothing told the client. The client holds the OLD value, posts
// the WHOLE answers map on the next keystroke, and the server sees the old
// certificate number as a change the MEMBER made — so it stamps it MEMBER,
// which is absorbing: MEMBER is never re-offered, never re-derived and never
// replaced. The wrong certificate is then locked onto a signed SAPS 271
// wearing a "You entered this" chip the member never earned.
//
// So a save now ADOPTS what came back. Two rules, both learned elsewhere in
// this codebase and both non-negotiable:
//
//   · MEMBER STILL WINS. A value from the response is applied only where the
//     member has not typed over it since the request left — see
//     `adoptServerAnswers`, which compares against the map that was actually
//     SENT, not against the map that is on screen when the reply lands.
//   · IT IS WRITTEN DEFENSIVELY. The field is optional on the response type,
//     because the backend change that adds it is in flight. Absent, nothing is
//     adopted and this behaves exactly as it did.
// ────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  motivationsApi,
  type ProvenanceMap,
  type SaveAnswersResult,
} from '@/lib/motivations-api';
import { AUTOSAVE_MS, clearDraft, writeDraft } from '@/lib/motivation-draft';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The save response, plus the two fields the server is growing.
 *
 * ⚠️ WIDENED HERE RATHER THAN IN THE API MODULE, ON PURPOSE.
 * `lib/motivations-api.ts` is another file's territory in this same review and
 * its `SaveAnswersResult` carries neither of these yet. Declaring the extra
 * shape at the consumer keeps this hook correct against the server as it is
 * AND as it is becoming, without editing a type three other screens read.
 * Both fields are OPTIONAL and must stay optional until the server always
 * sends them: absent, nothing is adopted and this behaves exactly as before.
 * When the API type grows them, delete this and read them there.
 */
export interface SavedAnswersResult extends SaveAnswersResult {
  /**
   * Answers the SERVER changed while saving — a re-derivation, not an echo.
   *
   * ⚠️ THE FIELD IS `derived`, AND THE NAME IS LOAD-BEARING. This was declared
   * here as a top-level `answers` / `provenance` pair while the server sent
   * `derived: { values, provenance }`. Both halves compiled, both were
   * optional, and they never met: the adoption below could not fire, so the
   * competency this hook exists to adopt was overwritten by the next
   * keystroke and stamped MEMBER, which is absorbing. Optional fields on two
   * sides of a wire agree with each other only by being read.
   */
  derived?: {
    values?: Record<string, string>;
    provenance?: ProvenanceMap;
  };
}

// ⚠️ THE MERGE RULE LIVES IN lib/, AND IS RE-EXPORTED HERE. The runner's
// `include` is `lib/**/*.spec.ts` and `components/**/*.spec.tsx`, so a spec
// written beside this file would pass and never once be collected — and this
// is a rule whose two failure directions are both silent (too eager deletes
// somebody's keystrokes, too timid leaves the wrong competency certificate on
// a form they sign). Both screens import it from here along with the hook.
export { adoptServerAnswers } from '@/lib/adopt-server-answers';

export interface AutosaveResult {
  /** What to show beside the form. */
  state: SaveState;
  /**
   * Registered fields the server would not store, by key.
   *
   * ⚠️ NOT AN EMPTY ARRAY MEANS SOMETHING IS WRONG WITH US, NOT WITH THEM.
   * The wizard's own banner says so: "This is a fault on our side, not
   * something you typed wrong."
   */
  refused: string[];
  /** Call after any edit. Nothing is sent until this has been called. */
  markDirty: () => void;
  /** True while there are unsent changes — for an unload warning. */
  isDirty: () => boolean;
}

export function useMotivationAutosave({
  id,
  token,
  answers,
  ready,
  onResponse,
  onSaved,
  onAdopt,
}: {
  id: string;
  token: () => Promise<string | null>;
  answers: Record<string, string>;
  /**
   * Whether the screen has finished loading. Guards rule 4: without it the
   * first render's empty `answers` object races the load and can save nothing
   * over everything.
   */
  ready: boolean;
  /** Every 200, refused or not. See the header. */
  onResponse?: (res: SaveAnswersResult) => void;
  /** Only a clean save. See the header. */
  onSaved?: (res: SaveAnswersResult) => void | Promise<void>;
  /**
   * Answers the server rewrote while saving, and where they now come from.
   *
   * ⚠️ CALLED BEFORE THE REFUSAL BRANCH, like `onResponse` and for the same
   * reason: a re-derivation the server performed is a fact about the
   * application whether or not every other value was stored, and dropping it
   * leaves the client holding a value it will post straight back and have
   * stamped MEMBER. Merge it with `adoptServerAnswers`, which is handed the
   * map that was sent so the member's own typing always wins.
   */
  onAdopt?: (
    adopted: Record<string, string>,
    sent: Record<string, string>,
    provenance?: ProvenanceMap,
  ) => void;
}): AutosaveResult {
  const [state, setState] = useState<SaveState>('idle');
  const [refused, setRefused] = useState<string[]>([]);
  const dirty = useRef(false);

  // Held in a ref so a caller that redefines it every render — which is the
  // normal case for an inline arrow — does not restart the debounce timer on
  // every keystroke and thereby prevent the save from ever firing.
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const responded = useRef(onResponse);
  responded.current = onResponse;
  const adopting = useRef(onAdopt);
  adopting.current = onAdopt;

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);
  const isDirty = useCallback(() => dirty.current, []);

  useEffect(() => {
    if (!dirty.current || !ready) return;

    writeDraft(id, answers);
    setState('saving');

    const t = setTimeout(async () => {
      // The exact map this request carries. `adoptServerAnswers` compares
      // against THIS rather than against whatever is on screen when the reply
      // lands, so anything typed during the round trip survives.
      const sent = answers;
      try {
        const res: SavedAnswersResult = await motivationsApi.saveAnswers(
          token,
          id,
          sent,
        );

        // ⚠️ BEFORE THE REFUSAL BRANCH, DELIBERATELY. What the server says is
        // still outstanding is true whether or not it stored every value, and
        // dropping it on a refusal leaves a stale list in front of somebody.
        responded.current?.(res);

        // Rule 5. Absent on the server as it stands today, in which case this
        // does nothing at all.
        const derivedValues = res.derived?.values;
        if (derivedValues && Object.keys(derivedValues).length) {
          adopting.current?.(derivedValues, sent, res.derived?.provenance);
        }

        // Rule 2. Reported by name, and the draft below is NOT cleared.
        if (res.refused?.length) {
          setRefused(res.refused);
          setState('error');
          return;
        }
        setRefused([]);

        await saved.current?.(res);

        // Rule 3.
        clearDraft(id);
        dirty.current = false;
        setState('saved');
      } catch {
        // The draft survives. Whatever they typed is still on this device.
        setState('error');
      }
    }, AUTOSAVE_MS);

    return () => clearTimeout(t);
  }, [answers, id, ready, token]);

  return { state, refused, markDirty, isDirty };
}
