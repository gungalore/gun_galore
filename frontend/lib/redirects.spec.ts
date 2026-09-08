import { describe, expect, it } from 'vitest';
import nextConfig from '../next.config.mjs';

// ────────────────────────────────────────────────────────────────────
// THE RETIRED MOTIVATION ROUTES.
//
// ⚠️ MEMBERS CARRY THESE PATHS IN LINKS WE SENT THEM. Reminder emails, SMS
// action links and bookmarks all point at the two wizards deleted on
// 2026-09-08. A 404 on a link we sent is worse than a redirect that outlives
// its usefulness, so these are permanent and they are tested.
//
// ⚠️ THE CASE THAT MATTERS MOST IS THE ONE THAT ASSERTS AN ABSENCE:
// `/licence-centre` MUST NOT redirect. It is the Document Centre's own second
// door — `/documents` re-exports that page and notification-module.ts
// deep-links every `licence_centre_*` reminder to it — and redirecting it
// would send every licence-expiry reminder to a list of applications.
// ────────────────────────────────────────────────────────────────────

type Redirect = {
  source: string;
  destination: string;
  permanent: boolean;
};

async function redirects(): Promise<Redirect[]> {
  const cfg = nextConfig as unknown as {
    redirects?: () => Promise<Redirect[]>;
  };
  return (await cfg.redirects?.()) ?? [];
}

describe('the old motivation routes', () => {
  it('sends both list screens to the applications list', async () => {
    const rules = await redirects();
    for (const source of ['/motivations', '/licence-services/new']) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, `no redirect for ${source}`).toBeDefined();
      expect(rule!.destination).toBe('/licence-centre/applications');
      expect(rule!.permanent).toBe(true);
    }
  });

  it('sends both application screens to the sheet, keeping the id', async () => {
    const rules = await redirects();
    for (const source of ['/motivations/:id', '/licence-services/:id']) {
      const rule = rules.find((r) => r.source === source);
      expect(rule, `no redirect for ${source}`).toBeDefined();
      expect(rule!.destination).toBe('/licence-centre/:id');
      expect(rule!.permanent).toBe(true);
    }
  });

  it('⚠️ MATCHES /licence-services/new BEFORE THE DYNAMIC SEGMENT', async () => {
    // Otherwise somebody starting a new application lands on a sheet whose id
    // is the word "new".
    const rules = await redirects();
    const newIdx = rules.findIndex((r) => r.source === '/licence-services/new');
    const idIdx = rules.findIndex((r) => r.source === '/licence-services/:id');
    expect(newIdx).toBeGreaterThanOrEqual(0);
    expect(newIdx).toBeLessThan(idIdx);
  });
});

describe('⚠️ the Document Centre keeps both of its doors', () => {
  it('does not redirect /licence-centre', async () => {
    const rules = await redirects();
    expect(rules.find((r) => r.source === '/licence-centre')).toBeUndefined();
  });

  it('does not redirect /documents', async () => {
    const rules = await redirects();
    expect(rules.find((r) => r.source === '/documents')).toBeUndefined();
  });

  it('never redirects anything to a path that no longer exists', async () => {
    const rules = await redirects();
    for (const r of rules) {
      expect(r.destination.startsWith('/motivations')).toBe(false);
      expect(r.destination.startsWith('/licence-services')).toBe(false);
    }
  });
});
