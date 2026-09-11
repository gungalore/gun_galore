'use client';

/**
 * THE DESK — one poll for the chrome.
 *
 * 🚨 THE TABS COULD NOT CARRY A COUNT, AND THAT IS WHAT THIS FIXES. Every
 * board fetched for itself and the shell knew nothing, so an operator standing
 * on Health had no way of learning that three things had landed on Now: the
 * only way to find out was to press the tab. The counts are the reason this
 * exists — they are not decoration on a navigation bar.
 *
 * 🚨 IT MOUNTS IN app/admin/desk/layout.tsx AND IT CANNOT MOUNT IN THE SHELL.
 * Every board renders its OWN <DeskShell> (page.tsx:811, people:358,
 * agent:244, health:138), so under the App Router the whole shell subtree
 * unmounts and remounts on every tab press — a timer started there would
 * restart, and re-fetch, on every navigation, which is the opposite of one
 * poll. The layout is the only node under /admin/desk that survives a tab
 * press. It is also a SERVER component (it exports `metadata` and `viewport`),
 * which is why this is a separate 'use client' file imported into it rather
 * than a pragma added to the layout.
 *
 * ⚠️ IT FEEDS THE CHROME AND NOTHING ELSE. No board reads its rows from here.
 * A board that stopped fetching because the shell had a number would blank the
 * moment this poll failed — the coupling the Agent/Health split was made to
 * avoid, where one dead daemon took the alerts inbox down with it. The cost is
 * stated rather than hidden: while an operator stands on Now, /admin/desk is
 * read twice a minute, once by this and once by the board. That is the price
 * of the two being independent, and it is a read of a feed the box already
 * serves in one query.
 *
 * ⚠️ HEALTH KEEPS ITS OWN 60s PROBE SWEEP (app/admin/desk/health/services.tsx).
 * It is a different question on a different endpoint — a bounded probe of
 * third parties and queue depths — and it is mounted only while the operator
 * is on Health. Folding it in here would fire third-party probes from every
 * board. So the narrow claim: ONE poll for the whole app's STATUS; Health
 * keeps its own probes while it is on screen.
 *
 * ⚠️ NO PROVIDER IS A LEGAL STATE. app/admin/desk-kit renders <TopTabs> in a
 * fixture outside this tree, so the default context is "nothing read" rather
 * than a throw — a kit page that cannot render is a kit page nobody checks the
 * artboard against.
 */
import * as React from 'react';
import {
  NOTHING_READ,
  gatesReading,
  mergeCounts,
  readDeskStatus,
  statusDot,
  type DeskStatusCounts,
} from '../../lib/desk-status';

/** How often the chrome re-reads. The pile's own timer uses the same figure. */
const STATUS_POLL_MS = 60_000;

export interface DeskStatus {
  /**
   * The four figures, each one the last that arm managed to read. They are
   * held across a failed sweep on purpose — see mergeCounts.
   */
  counts: DeskStatusCounts;
  /**
   * The header dot, from the LAST SWEEP'S gate read and not from `counts`.
   * undefined before the first sweep lands; the `unknown` tone the moment a
   * sweep asks for the gates and does not get them back.
   *
   * 🚨 THERE WAS A `stale: boolean` BESIDE THIS AND IT WAS RENDERED NOWHERE.
   * It was the field the old arrangement pointed at when asked how an operator
   * learns a sweep failed — a claim about a UI that did not exist, on a
   * provider whose dot was meanwhile printing "Healthy" through the outage it
   * was supposed to describe. The gates now answer for themselves here; the
   * other two arms are counts, and a stale count is deliberately left unmarked
   * (mergeCounts says why). If a marker for those is wanted it belongs on the
   * badge in components/desk/tabs.tsx, fed by StatusSweep.failed, and it
   * should be added there rather than reintroduced here unread.
   */
  dot: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; word: string } | undefined;
  refresh: () => void;
}

const NO_READING: DeskStatus = {
  counts: NOTHING_READ,
  dot: undefined,
  refresh: () => undefined,
};

const StatusContext = React.createContext<DeskStatus>(NO_READING);

/** What the chrome knows. Safe to call outside the provider — see the header. */
export function useDeskStatus(): DeskStatus {
  return React.useContext(StatusContext);
}

export function DeskStatusProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = React.useState<DeskStatusCounts>(NOTHING_READ);

  /**
   * The gate reading THIS sweep produced. Three states, and the initial one is
   * load-bearing: `undefined` is "no sweep has asked yet" and draws no dot at
   * all, which is the only honest thing to show before a measurement exists.
   *
   * ⚠️ IT IS REPLACED EVERY SWEEP, NEVER MERGED, AND THAT IS THE DIFFERENCE
   * BETWEEN THIS AND `counts`. A gates read that FAILS writes `null` over the
   * last good number, so the dot turns to "Not read" on the first failed sweep
   * rather than staying green for as long as the endpoint keeps refusing.
   *
   * 🚨 A READ THAT HANGS IS NOT A READ THAT FAILS, AND THIS DOES NOT COVER IT.
   * lib/desk-auth.ts's deskFetch carries no AbortController and no timeout, so
   * a socket that accepts and never answers leaves `inFlight` true, every later
   * tick returns at the guard, and the whole chrome — this value and the four
   * counts alike — freezes at whatever it last showed, green included. That is
   * narrower than what was here before, where an endpoint that merely REFUSED
   * did it too; closing it means a deadline on deskFetch, which is a different
   * file and a different track.
   *
   * Not the only unearned green left, either, and the other one is not
   * frontend-shaped: a gates endpoint answering 200 with an empty or wrong
   * array reads as a measured zero here and nothing on this side can tell.
   */
  const [gates, setGates] = React.useState<number | null | undefined>(undefined);

  /**
   * ⚠️ AN IN-FLIGHT GUARD, COPIED FROM THE HEALTH SWEEP AND NOT FROM THE PILE.
   * app/admin/desk/page.tsx's interval has none, so a feed slower than 60
   * seconds stacks requests on top of each other. health/services.tsx does,
   * and this poll runs on every board rather than one, so it is the one to
   * copy.
   */
  const inFlight = React.useRef(false);

  const sweep = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const read = await readDeskStatus();
      // ⚠️ MERGE, DO NOT REPLACE. An arm that did not answer is absent from
      // `read.counts` and keeps whatever it was showing; dropping to silence
      // on a failed refresh reads as an all-clear, which is the one wrong
      // answer.
      setCounts((prev) => mergeCounts(prev, read.counts));
      // ⚠️ AND THE VERDICT DOES THE OPPOSITE — replaced, from this sweep only.
      // The two lines disagreeing about the gates is the point: the badge may
      // keep the last count it was told, the dot may not keep the last health
      // it was told. See statusDot.
      setGates(gatesReading(read));
    } finally {
      inFlight.current = false;
    }
  }, []);

  React.useEffect(() => {
    void sweep();
    const id = setInterval(() => void sweep(), STATUS_POLL_MS);
    /**
     * ⚠️ THE FOCUS RE-READ IS A SEPARATE BEHAVIOUR FROM THE INTERVAL AND IS
     * THE EASIEST THING TO LOSE IN A CONSOLIDATION. It comes from the pile's
     * own loader, whose comment is the reason: an operator who has been in
     * their email for ten minutes should not act on a stale count.
     */
    const onFocus = () => void sweep();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [sweep]);

  const value = React.useMemo<DeskStatus>(
    () => ({
      counts,
      // ⚠️ `gates`, NOT `counts.redGates`. The merged count is the right input
      // for the Health tab's badge and the wrong input for a health verdict.
      dot: statusDot(gates),
      refresh: () => void sweep(),
    }),
    [counts, gates, sweep],
  );

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}
