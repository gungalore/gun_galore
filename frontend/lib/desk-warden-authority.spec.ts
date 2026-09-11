import { describe, it, expect } from 'vitest';
import {
  proposalAuthority,
  reversibilityLine,
  wardenAbsent,
  wardenAbsenceWord,
  wardenChatFrom,
  type WardenProposal,
} from './desk-site';

/**
 * THE AGENT SURFACE — what the money-grade confirm is allowed to CLAIM, and
 * which silence the approval queue is looking at.
 *
 * 🚨 THE TWO DEFECTS PINNED HERE BOTH SHIPPED AS CONFIDENT SENTENCES.
 *
 * ONE: the approve dialog told the operator, for EVERY proposal, "It runs
 * inside Warden's own safe list — this browser and this API never hold the
 * shell." The second half is always true. The first is true only of a proposal
 * the daemon backed with a validated safe-list pick; for a model-drafted
 * free-form command — the `approved_command` path the run log on that same
 * page renders by name — it is false in the one direction that matters, and
 * the frontend could not tell because the daemon's projectProposal() dropped
 * the fact before the wire.
 *
 * TWO: the approval queue said "Nothing is waiting on you, because nothing is
 * watching the box" whenever `present` was false — covering both "no daemon is
 * configured" (true) and "a daemon is configured and did not answer" (a claim
 * about a list nothing ever read).
 *
 * ⚠️ EVERY ASSERTION BELOW WAS WATCHED GO RED. The named bug was put back in
 * lib/desk-site.ts, `npx vitest run lib/desk-warden-authority.spec.ts` was run,
 * the named case failed, and the file was restored.
 *
 * ⚠️ AND THIS FILE IS UNDER lib/ FOR A REASON. Vitest's include list is specs
 * under lib/ and .spec.tsx under components/ — NOTHING under app/. The
 * decisions these cover therefore live in lib/desk-site.ts rather than beside
 * the dialog that renders them, because a spec written beside the dialog would
 * report nothing, fail nothing and pass `npm run build` by not existing.
 */

function proposal(over: Partial<WardenProposal> = {}): WardenProposal {
  return {
    id: 'prop40',
    kind: 'proposal',
    status: 'pending',
    headline: 'Restart the backend',
    diagnosis: 'It is wedged.',
    command: 'pm2 reload alloutdoor-backend --update-env',
    operationName: 'restartProcess',
    reversible: true,
    gateKey: null,
    raisedAt: '2026-09-03T07:05:00.000Z',
    ...over,
  };
}

describe('proposalAuthority — what approving this actually grants', () => {
  it('names the safe-list operation, and says the daemon re-validates it at approve time', () => {
    const a = proposalAuthority(proposal());
    expect(a.kind).toBe('safe_list');
    // The NAME is the half an operator can check against the daemon's menu.
    expect(a.label).toBe('restartProcess');
    expect(a.sentence).toContain('restartProcess');
    expect(a.sentence).toMatch(/re-validates/i);
  });

  it('says OUT LOUD that a free-form command is not on the safe list', () => {
    // The failure this guards: the operator reads "runs inside Warden's own
    // safe list" over a string the model wrote, and approves an unbounded
    // command on the production box believing an enum stood behind it.
    const a = proposalAuthority(proposal({ operationName: null }));
    expect(a.kind).toBe('free_form');
    expect(a.sentence).toMatch(/NOT a safe-list operation/);
    expect(a.sentence).toMatch(/broadest authority/i);
    // And it must not accidentally reassure in the same breath.
    expect(a.sentence).not.toMatch(/runs inside Warden’s own safe list/);
  });

  it('a proposal with no operation name at all reads as free-form, never as safe-list', () => {
    // A daemon or an API that predates the field. The skew is real: deploy.sh
    // ships warden as a separate, explicitly non-fatal third stage, so a
    // daemon older than the backend beside it is a window, not a hypothetical.
    // Over-warning costs a moment's thought; the other default vouches for a
    // command nothing validated.
    const a = proposalAuthority({
      kind: 'proposal',
      command: 'pm2 flush',
      operationName: undefined as unknown as string | null,
    });
    expect(a.kind).toBe('free_form');
  });

  it('a red gate and a commandless proposal grant nothing, and say so', () => {
    expect(proposalAuthority(proposal({ kind: 'red_gate', command: null })).kind).toBe(
      'nothing_to_run',
    );
    expect(proposalAuthority(proposal({ command: null })).kind).toBe('nothing_to_run');
    expect(proposalAuthority(proposal({ command: '' })).kind).toBe('nothing_to_run');
  });

  it('a red gate is never described as a safe-list operation, even if one is attached', () => {
    // A red gate cannot be approved at all — WardenService refuses it by kind.
    // An authority sentence naming an operation on one would be describing a
    // grant that does not exist.
    const a = proposalAuthority(proposal({ kind: 'red_gate', command: null, operationName: 'restartProcess' }));
    expect(a.kind).toBe('nothing_to_run');
    expect(a.label).not.toBe('restartProcess');
  });
});

describe('reversibilityLine', () => {
  it('states irreversibility in words, not only in a colour', () => {
    // ⚠️ Phase 11 took the daemon's irreversible operation count from 2 to 5,
    // and the sharp pair — cancelLongQuery against terminateIdleInTransaction
    // — differs by pg_cancel_backend vs pg_terminate_backend inside a
    // 354-character statement. Nobody should have to spot that in a <Pre>.
    expect(reversibilityLine(false)).toMatch(/NOT reversible/);
    expect(reversibilityLine(true)).toMatch(/^Reversible/);
  });
});

describe('wardenChatFrom — which silence this is', () => {
  it('reads an explicit not_deployed as not_deployed', () => {
    const chat = wardenChatFrom({ present: false, absence: 'not_deployed', proposals: [] });
    expect(chat.present).toBe(false);
    expect(chat.absence).toBe('not_deployed');
  });

  it('an absent daemon that DID NOT ANSWER is unreachable, not not_deployed', () => {
    // The failure this guards: the approval queue prints "nothing is waiting
    // on you" over a list nothing ever fetched.
    expect(wardenChatFrom({ present: false, absence: 'unreachable' }).absence).toBe('unreachable');
  });

  it('an unreadable or missing absence falls to unreachable — unknown is never the all-clear', () => {
    // An older API with no such field. It read nothing either way, so the
    // honest answer is "this is not a reading of the daemon".
    expect(wardenChatFrom({ present: false }).absence).toBe('unreachable');
    expect(wardenChatFrom({ present: false, absence: 'nope' as never }).absence).toBe('unreachable');
    expect(wardenChatFrom(null).absence).toBe('unreachable');
  });

  it('a present daemon carries no absence at all', () => {
    expect(wardenChatFrom({ present: true, proposals: [] }).absence).toBeNull();
  });

  it('wardenAbsent defaults to unreachable, because it is called from a catch block', () => {
    // The fetch threw, so this browser read nothing. Calling that "not
    // deployed" turns a failed read into an all-clear.
    expect(wardenAbsent('it threw').absence).toBe('unreachable');
    expect(wardenAbsent('no env vars', 'not_deployed').absence).toBe('not_deployed');
  });

  it('coerces the two authority fields to their SAFE readings on arrival', () => {
    const chat = wardenChatFrom({
      present: true,
      proposals: [
        proposal({ id: 'p_named' }),
        { ...proposal({ id: 'p_old' }), operationName: undefined, reversible: undefined } as never,
        { ...proposal({ id: 'p_junk' }), operationName: 42, reversible: 'true' } as never,
      ],
    });
    const byId = Object.fromEntries(chat.proposals.map((p) => [p.id, p]));
    expect(byId.p_named.operationName).toBe('restartProcess');
    expect(byId.p_named.reversible).toBe(true);
    // null → the louder confirm; false → "not reversible".
    expect(byId.p_old.operationName).toBeNull();
    expect(byId.p_old.reversible).toBe(false);
    expect(byId.p_junk.operationName).toBeNull();
    expect(byId.p_junk.reversible).toBe(false);
  });
});

describe('what an absent Warden is called', () => {
  /**
   * 🚨 SIX PLACES ON ONE SCREEN DISAGREED. `absence` was threaded into the
   * approval queue and nowhere else, so the queue said "whether anything is
   * waiting is unknown" while the status tag an inch above it — and the page
   * subtitle, and both button labels — still branched on `present` alone and
   * said "Warden not deployed". The confident one was the wrong one: a daemon
   * that did not answer is still out there, possibly with a proposal waiting,
   * and telling somebody it is not deployed is how they stop looking.
   */
  it('never calls an unreachable daemon "not deployed"', () => {
    expect(wardenAbsenceWord(false, 'unreachable')).not.toMatch(/not deployed/i);
    expect(wardenAbsenceWord(false, 'not_deployed')).toMatch(/not deployed/i);
  });

  it('falls to UNREACHABLE when it does not know which absence', () => {
    // ⚠️ Same rule as wardenChatFrom's default. "Not deployed" is the
    // confident claim and a field we could not read is not grounds for one.
    expect(wardenAbsenceWord(false, null)).toBe(wardenAbsenceWord(false, 'unreachable'));
  });

  it('says nothing at all when Warden is present', () => {
    expect(wardenAbsenceWord(true, null)).toBe('');
  });
});
