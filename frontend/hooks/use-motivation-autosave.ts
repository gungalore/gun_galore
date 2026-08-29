'use client';

// ────────────────────────────────────────────────────────────────────
// SAVING A MEMBER'S ANSWERS, AND THE FOUR RULES THAT MUST NOT DIVERGE.
//
// Two screens now edit one application — the wizard at /motivations/[id] and
// the pack at /licence-services/[id]. Two copies of this logic would be two
// answers to "did that save?", and the failure mode is silent: a member keeps
// typing into a box that will be empty after they reload.
//
// ⚠️ THE WIZARD HAS NOT BEEN MIGRATED ONTO THIS YET, SO THE DUPLICATION IS
// REAL TODAY. Its own copy is the effect around `dirty.current` in
// app/motivations/[id]/page.tsx, and it carries two extras this does not: it
// re-reads the overlap verdict when a calibre changes, and it updates the
// detail row it holds. The migration is mechanical — both fit `onSaved` — and
// was deliberately not done in the same change as building this, because the
// wizard is the screen members actually use and Clerk's domain lock means an
// end-to-end save cannot be exercised on a dev machine. Migrate it behind
// somebody who can watch a real save land. Until then: if you change a rule
// here, change it there.
//
// The rules, all four of which were learned the hard way:
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
// ────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { motivationsApi, type SaveAnswersResult } from '@/lib/motivations-api';
import { AUTOSAVE_MS, clearDraft, writeDraft } from '@/lib/motivation-draft';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

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

  const markDirty = useCallback(() => {
    dirty.current = true;
  }, []);
  const isDirty = useCallback(() => dirty.current, []);

  useEffect(() => {
    if (!dirty.current || !ready) return;

    writeDraft(id, answers);
    setState('saving');

    const t = setTimeout(async () => {
      try {
        const res = await motivationsApi.saveAnswers(token, id, answers);

        // ⚠️ BEFORE THE REFUSAL BRANCH, DELIBERATELY. What the server says is
        // still outstanding is true whether or not it stored every value, and
        // dropping it on a refusal leaves a stale list in front of somebody.
        responded.current?.(res);

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
