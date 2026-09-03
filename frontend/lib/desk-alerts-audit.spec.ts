import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUDIT_PAGE_SIZE,
  AUDIT_RESOURCE_TYPES,
  bulkResolveAlerts,
  fetchAlertTypeFacets,
  fetchAlerts,
  fetchAudit,
  resolveAlert,
} from './desk-site';

// ────────────────────────────────────────────────────────────────────
// THE INBOX THAT SHOWED EIGHT, AND THE RECORD THAT STOPPED AT FIFTY.
//
// 🚨 The audit drawer read the newest fifty and stopped, so "who released
// that payout in July" was unanswerable on the one surface built to answer
// it. `offset` was accepted by the server the entire time and never sent;
// `resourceType` was a declared parameter of fetchAudit that no caller ever
// passed. A record you can only see the last fifty rows of is not the record.
//
// The alerts card had the matching problem in the other direction: it asked
// for fifty, rendered eight, and offered no filter, no paging and no bulk
// clear — while its own footer pointed the operator at a legacy page that
// has since been deleted.
// ────────────────────────────────────────────────────────────────────

function stub(payload: unknown = []) {
  const spy = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(payload),
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}
const urlOf = (spy: ReturnType<typeof stub>) => String(spy.mock.calls[0][0]);

afterEach(() => vi.unstubAllGlobals());

describe('the alerts query', () => {
  it('asks only for unresolved, and for a full page', async () => {
    const spy = stub();
    await fetchAlerts();
    expect(urlOf(spy)).toContain('resolved=false');
    expect(urlOf(spy)).toContain('limit=50');
  });

  it('passes the type filter through', async () => {
    const spy = stub();
    await fetchAlerts({ type: 'PAYOUT_FAILED' });
    expect(urlOf(spy)).toContain('type=PAYOUT_FAILED');
  });

  it('pages forward on a CURSOR, not an offset', async () => {
    // The server pages from the id of the last row already rendered, so a row
    // resolved mid-scroll cannot shift the window and hide the row after it.
    const spy = stub();
    await fetchAlerts({ cursor: 'alr_9' });
    expect(urlOf(spy)).toContain('cursor=alr_9');
    expect(urlOf(spy)).not.toContain('offset=');
  });

  it('🚨 sends urgent ONLY when narrowing, never as urgent=false', async () => {
    // The controller treats an absent/empty urgent as "do not filter" and an
    // explicit false as "show me the NON-urgent ones". A cleared toggle that
    // sent urgent=false would silently hide every urgent alert — the exact
    // rows the inbox exists for.
    const off = stub();
    await fetchAlerts({ urgent: false });
    expect(urlOf(off)).not.toContain('urgent');
    vi.unstubAllGlobals();

    const on = stub();
    await fetchAlerts({ urgent: true });
    expect(urlOf(on)).toContain('urgent=true');
  });

  it('tolerates a bare array AND an envelope', async () => {
    // ⚠️ THE ENDPOINT RETURNS A BARE ARRAY. This type once claimed an envelope
    // and read `.rows` off it, so the card rendered "0 unresolved · Nothing
    // unresolved" however many were waiting — a quiet all-clear on the one
    // surface whose whole job is to say otherwise.
    stub([{ id: 'a1' }]);
    expect(await fetchAlerts()).toHaveLength(1);
    vi.unstubAllGlobals();
    stub({ rows: [{ id: 'a1' }, { id: 'a2' }] });
    expect(await fetchAlerts()).toHaveLength(2);
    vi.unstubAllGlobals();
    stub({ nonsense: true });
    expect(await fetchAlerts()).toEqual([]);
  });
});

describe('resolving alerts', () => {
  it('sends a reason on the single path', async () => {
    const spy = stub({});
    await resolveAlert('alr_1', 'handled by hand');
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/alerts\/alr_1\/resolve$/);
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      reason: 'handled by hand',
    });
  });

  it('sends an empty reason rather than no body', async () => {
    const spy = stub({});
    await resolveAlert('alr_1');
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({ reason: '' });
  });

  it('bulk-resolve posts the ids to the literal path', async () => {
    const spy = stub({ resolved: 2, skipped: 0, failed: 0 });
    await bulkResolveAlerts(['a', 'b'], 'cron sweep');
    // ⚠️ 'bulk-resolve' MUST NOT be read as an alert id — the backend declares
    // it above POST :id/resolve for exactly that reason.
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/alerts\/bulk-resolve$/);
    expect(JSON.parse(String(spy.mock.calls[0][1]?.body))).toEqual({
      alertIds: ['a', 'b'],
      reason: 'cron sweep',
    });
  });

  it('the facets endpoint is the literal /types path', async () => {
    const spy = stub([]);
    await fetchAlertTypeFacets();
    expect(String(spy.mock.calls[0][0])).toMatch(/\/admin\/alerts\/types$/);
  });
});

describe('the audit query', () => {
  it('sends the offset it was given', async () => {
    const spy = stub({ rows: [], total: 0, limit: 50, offset: 100 });
    await fetchAudit({ offset: 100 });
    expect(urlOf(spy)).toContain('offset=100');
  });

  it('omits offset zero rather than sending a noise param', async () => {
    const spy = stub({ rows: [], total: 0, limit: 50, offset: 0 });
    await fetchAudit({ offset: 0 });
    expect(urlOf(spy)).not.toContain('offset=');
  });

  it('passes resourceType — the parameter nothing used to send', async () => {
    const spy = stub({ rows: [], total: 0, limit: 50, offset: 0 });
    await fetchAudit({ resourceType: 'Transaction' });
    expect(urlOf(spy)).toContain('resourceType=Transaction');
  });
});

describe('🚨 the audit filter chips name types that are actually written', () => {
  it('offers no chip for a resourceType no writer emits', () => {
    // The first draft of this list was guessed and included Complaint and
    // AdminUser. Neither is ever written, so both chips would have returned an
    // empty log and read as "nothing has ever happened to a complaint" — a
    // filter that lies by returning nothing is worse than a missing filter.
    expect(AUDIT_RESOURCE_TYPES).not.toContain('Complaint');
    expect(AUDIT_RESOURCE_TYPES).not.toContain('AdminUser');
  });

  it('covers the families a money or member question starts from', () => {
    for (const t of ['Transaction', 'User', 'Listing', 'Dealer']) {
      expect(AUDIT_RESOURCE_TYPES).toContain(t);
    }
  });

  it('omits the removed features, whose rows are frozen history', () => {
    // Load Lab and Ask Boet are gone. Their audit rows remain and are still
    // returned under "Everything"; a chip for them would spend a filter slot
    // on something nobody can do any more.
    for (const dead of ['ReloadingManual', 'ManualLoad', 'AskGgKbEntry', 'AskGgGuideOverride']) {
      expect(AUDIT_RESOURCE_TYPES).not.toContain(dead);
    }
  });

  it('pages in a size the drawer and the query agree on', () => {
    expect(AUDIT_PAGE_SIZE).toBe(50);
  });
});
