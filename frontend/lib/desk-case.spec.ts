import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CASE_STATES,
  caseRef,
  describeComplaintDecision,
  describeSupportReply,
  describeSupportResolve,
  fetchCase,
  stateTone,
  type CaseDossier,
} from './desk-case';

/**
 * The Case module's two dangerous jobs, tested because being wrong at either
 * costs somebody something real:
 *
 *   · WHAT THE DOSSIER CARRIES. Both endpoints hand back the member's email
 *     address. If it ever reaches a CaseDossier it reaches the drawer, and
 *     from there a shared screen. The mapper dropping it is a rule, so it gets
 *     a test rather than a comment.
 *
 *   · WHAT THE CONFIRM PROMISES. describe*() is the only place that knows
 *     which transitions actually deliver the operator's words. An operator
 *     told "they'll read this" who is wrong has not answered a complaint they
 *     believe they have answered — and on a payout-holding case, that is a
 *     seller not being paid while everyone thinks the matter is closed.
 */

const REGISTER_ROW = {
  id: 'cmpl_1',
  referenceNumber: 'CO000123',
  role: 'BUYER',
  category: 'NOT_ARRIVED',
  subject: 'Rifle never arrived',
  body: 'Waybill says delivered but nothing came.',
  status: 'OPEN',
  assignedAdminId: null,
  outcome: null,
  drovePayoutHold: true,
  createdAt: '2026-09-01T08:00:00.000Z',
  resolvedAt: null,
  // The wire really does carry this. Nothing may map it through.
  user: { username: 'boetdiesel', email: 'someone@example.test' },
  photos: [{ id: 'p1', url: 'https://res.example.test/a.jpg' }],
  transaction: {
    id: 'tx_9',
    paymentStatus: 'DISPUTED',
    listing: { title: 'CZ 457', referenceNumber: 'LS0042' },
  },
};

// Typed with fetch's own signature so `spy.mock.calls[0][0]` is the URL rather
// than an index into an empty tuple — which is what a bare `vi.fn(async () =>
// …)` infers, and it fails the typecheck rather than the test.
function stubFetch(payload: unknown) {
  const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCase — complaints', () => {
  it('⚠️ reads the whole register, because there is no GET /admin/complaints/:id', async () => {
    const spy = stubFetch([{ ...REGISTER_ROW, id: 'other' }, REGISTER_ROW]);
    const dossier = await fetchCase('complaint', 'cmpl_1');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/complaints$/);
    expect(dossier.reference).toBe('CO000123');
  });

  it('finds the case by its CO number too, so a pasted reference opens it', async () => {
    stubFetch([REGISTER_ROW]);
    await expect(fetchCase('complaint', 'CO000123')).resolves.toMatchObject({ id: 'cmpl_1' });
  });

  it('⚠️ NEVER carries the email through — usernames only past this boundary', async () => {
    stubFetch([REGISTER_ROW]);
    const dossier = await fetchCase('complaint', 'cmpl_1');

    expect(dossier.raisedBy).toBe('boetdiesel');
    expect(JSON.stringify(dossier)).not.toContain('someone@example.test');
  });

  it('reports the payout as still frozen while the order is DISPUTED', async () => {
    stubFetch([REGISTER_ROW]);
    const dossier = await fetchCase('complaint', 'cmpl_1');
    expect(dossier.hold).toMatchObject({ drovePayoutHold: true, stillFrozen: true });
  });

  it('stops claiming a freeze once the order has moved on', async () => {
    stubFetch([
      { ...REGISTER_ROW, transaction: { ...REGISTER_ROW.transaction, paymentStatus: 'RELEASED' } },
    ]);
    const dossier = await fetchCase('complaint', 'cmpl_1');
    // The complaint DID hold it once — that history stays true — but nothing
    // is frozen now, and a red tag on a released order is a false alarm.
    expect(dossier.hold).toMatchObject({ drovePayoutHold: true, stillFrozen: false });
  });

  it('⚠️ marks an outcome saved on the way to AWAITING_USER as NOT reaching the member', async () => {
    stubFetch([{ ...REGISTER_ROW, status: 'AWAITING_USER', outcome: 'Asked for the waybill.' }]);
    const dossier = await fetchCase('complaint', 'cmpl_1');
    const ours = dossier.messages.find((m) => m.from === 'operator');
    expect(ours?.reachedMember).toBe(false);
  });

  it('marks a resolved outcome as delivered, because the email carries it verbatim', async () => {
    stubFetch([{ ...REGISTER_ROW, status: 'RESOLVED', outcome: 'Refunded in full.' }]);
    const dossier = await fetchCase('complaint', 'cmpl_1');
    expect(dossier.messages.find((m) => m.from === 'operator')?.reachedMember).toBe(true);
  });

  it('fails loudly when the id is not in the register rather than rendering an empty case', async () => {
    stubFetch([REGISTER_ROW]);
    await expect(fetchCase('complaint', 'gone')).rejects.toThrow(/No case gone/);
  });
});

describe('fetchCase — support', () => {
  const TICKET = {
    id: 'tk_abc123def',
    subject: 'Where is my refund',
    category: 'payment',
    status: 'OPEN',
    transactionId: 'tx_44445555',
    createdAt: '2026-09-02T06:00:00.000Z',
    updatedAt: '2026-09-02T07:00:00.000Z',
    resolvedAt: null,
    user: { id: 'u1', username: 'skietrob', email: 'rob@example.test' },
    replies: [
      { id: 'r1', body: 'Still waiting.', fromAdmin: false, createdAt: '2026-09-02T06:00:00.000Z' },
      { id: 'r2', body: 'Looking into it.', fromAdmin: true, createdAt: '2026-09-02T07:00:00.000Z' },
    ],
  };

  it('uses the real detail route the support controller exposes', async () => {
    const spy = stubFetch(TICKET);
    await fetchCase('support', 'tk_abc123def');
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/support\/tk_abc123def$/);
  });

  it('treats the first reply as the member opening the ticket — no synthetic head row', async () => {
    stubFetch(TICKET);
    const dossier = await fetchCase('support', 'tk_abc123def');
    expect(dossier.messages).toHaveLength(2);
    expect(dossier.messages[0]).toMatchObject({ from: 'member', body: 'Still waiting.' });
    expect(dossier.messages[1]).toMatchObject({ from: 'operator' });
  });

  it('never claims a ticket is holding money — support has no money primitive', async () => {
    stubFetch(TICKET);
    await expect(fetchCase('support', 'tk_abc123def')).resolves.toMatchObject({ hold: null });
  });

  it('drops the email here too', async () => {
    stubFetch(TICKET);
    const dossier = await fetchCase('support', 'tk_abc123def');
    expect(JSON.stringify(dossier)).not.toContain('rob@example.test');
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * What the confirm is allowed to promise
 * ──────────────────────────────────────────────────────────────────────── */

const FROZEN: CaseDossier = {
  kind: 'complaint',
  id: 'cmpl_1',
  reference: 'CO000123',
  subject: 'Rifle never arrived',
  state: 'OPEN',
  category: 'NOT_ARRIVED',
  role: 'BUYER',
  raisedBy: 'boetdiesel',
  openedAt: '2026-09-01T08:00:00.000Z',
  updatedAt: null,
  resolvedAt: null,
  messages: [],
  photos: [],
  order: { id: 'tx_9', title: 'CZ 457', reference: 'LS0042', paymentStatus: 'DISPUTED' },
  hold: { drovePayoutHold: true, paymentStatus: 'DISPUTED', stillFrozen: true },
  outcome: null,
  assignedAdminId: null,
};

const PLAIN: CaseDossier = {
  ...FROZEN,
  category: 'ACCOUNT',
  hold: { drovePayoutHold: false, paymentStatus: null, stillFrozen: false },
  order: null,
};

describe('describeComplaintDecision', () => {
  it('says nothing goes out when a case is merely taken', () => {
    const d = describeComplaintDecision(PLAIN, 'UNDER_REVIEW', '');
    expect(d.channels).toMatch(/Nothing is sent/);
    expect(d.verbatim).toBeNull();
  });

  it('⚠️ warns that the awaiting-user template does NOT carry the note', () => {
    const d = describeComplaintDecision(PLAIN, 'AWAITING_USER', 'Send me the waybill photo.');
    // The operator typed a sentence; the member gets a fixed template. If the
    // confirm implied otherwise they would stop chasing an answered case.
    expect(d.verbatim).toBeNull();
    expect(d.caveat).toMatch(/NOT sent/);
  });

  it('promises the outcome word for word on a resolve', () => {
    const d = describeComplaintDecision(PLAIN, 'RESOLVED', 'Refunded in full on 3 Sep.');
    expect(d.verbatim).toBe('Refunded in full on 3 Sep.');
    expect(d.channels).toMatch(/word for word/);
  });

  it('⚠️ says closing the case does not release the frozen order', () => {
    const d = describeComplaintDecision(FROZEN, 'RESOLVED', 'Upheld.');
    expect(d.caveat).toMatch(/stays DISPUTED/);
    expect(d.caveat).toMatch(/does not release or refund/);
  });

  it('mentions the SMS only for a case that froze money — that is the only one with a phone', () => {
    expect(describeComplaintDecision(FROZEN, 'RESOLVED', 'Upheld.').channels).toMatch(/SMS/);
    expect(describeComplaintDecision(PLAIN, 'RESOLVED', 'Upheld.').channels).not.toMatch(/SMS/);
  });

  it('⚠️ hedges the SMS rather than promising one — a member with no number gets none', () => {
    // complaintStatusChanged is handed a phone only for a held payout, and
    // sends only `if (d.phone && …)`. "An SMS is sent" would be a guess.
    expect(describeComplaintDecision(FROZEN, 'RESOLVED', 'Upheld.').channels).toMatch(
      /if we have their number/,
    );
  });

  it('⚠️ promises a push ONLY when the case froze money', () => {
    // persist() pushes on `!dismissible || forcePush`; a verdict is written
    // dismissible with forcePush set for a held payout alone. Claiming a push
    // on an ordinary resolve is how an operator concludes it was seen.
    expect(describeComplaintDecision(FROZEN, 'RESOLVED', 'Upheld.').channels).toMatch(/push/);
    expect(describeComplaintDecision(PLAIN, 'RESOLVED', 'Upheld.').channels).toMatch(/No push/);
  });

  it('⚠️ says NOTHING is sent when the case is re-saved in the state it is already in', () => {
    // adminUpdate gates the entire notification on `status !== complaint.status`.
    // Rewording a verdict on an already-resolved case is silent, and a confirm
    // promising an email here is the exact lie this module exists to prevent.
    const d = describeComplaintDecision(
      { ...FROZEN, state: 'RESOLVED' },
      'RESOLVED',
      'Reworded: refund paid 3 Sep.',
    );
    expect(d.channels).toMatch(/Nothing is sent/);
    expect(d.verbatim).toBeNull();
    expect(d.caveat).toMatch(/NOT delivered/);
  });

  it('still records the note as saved when a re-save carries one, and as nothing when it does not', () => {
    const settled: CaseDossier = { ...PLAIN, state: 'AWAITING_USER' };
    expect(describeComplaintDecision(settled, 'AWAITING_USER', '').caveat).toBeUndefined();
    expect(describeComplaintDecision(settled, 'AWAITING_USER', 'more').caveat).toMatch(/replace/);
  });

  it('⚠️ says the case changes hands when somebody already owns it', () => {
    // `assignedAdminId: dto.assignedAdminId ?? adminId` is unconditional, so a
    // decision on someone else's case takes it off them.
    expect(describeComplaintDecision(PLAIN, 'RESOLVED', 'x').then).toMatch(/assigned to you/);
    expect(
      describeComplaintDecision({ ...PLAIN, assignedAdminId: 'adm_7' }, 'RESOLVED', 'x').then,
    ).toMatch(/from whoever owns it now/);
  });

  it('names the member by username, and falls back to a phrase rather than a blank', () => {
    expect(describeComplaintDecision(PLAIN, 'RESOLVED', 'x').to).toBe('boetdiesel');
    expect(describeComplaintDecision({ ...PLAIN, raisedBy: null }, 'RESOLVED', 'x').to).toMatch(
      /member/,
    );
  });
});

describe('describeSupportReply / describeSupportResolve', () => {
  const TICKET: CaseDossier = { ...PLAIN, kind: 'support', reference: '#ABC123' };

  it('shows the reply verbatim and says no email is sent', () => {
    const d = describeSupportReply(TICKET, '  We refunded you this morning.  ');
    expect(d.verbatim).toBe('We refunded you this morning.');
    expect(d.channels).toMatch(/No email/);
    expect(d.then).toMatch(/Awaiting user/);
  });

  it('⚠️ warns that resolving does not send an unsent draft', () => {
    expect(describeSupportResolve(TICKET, 'half a sentence').caveat).toMatch(/NOT delivered/);
    expect(describeSupportResolve(TICKET, '   ').caveat).toBeUndefined();
  });
});

describe('presentation', () => {
  it('⚠️ keeps bad for the frozen payout — an open case is work, not a fault', () => {
    expect(stateTone('OPEN')).toBe('warn');
    expect(stateTone('RESOLVED')).toBe('ok');
    expect(['warn', 'info', 'neutral', 'ok']).toContain(stateTone('UNDER_REVIEW'));
  });

  it('gives support a visibly unofficial reference rather than inventing a case number', () => {
    expect(caseRef('support', 'tk_abc123def')).toBe('#123DEF');
    expect(caseRef('complaint', 'CO000123')).toBe('CO000123');
  });

  it('⚠️ never offers UNDER_REVIEW on support — SupportTicketStatus has no such member', () => {
    expect(CASE_STATES.support).not.toContain('UNDER_REVIEW');
    expect(CASE_STATES.complaint).toContain('UNDER_REVIEW');
  });
});
