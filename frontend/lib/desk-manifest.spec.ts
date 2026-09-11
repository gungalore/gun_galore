// Node environment: this spec reads source text off disk and mounts nothing.
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { deskManifest } from '@/app/admin/desk-manifest';

/**
 * THE DESK'S MANIFEST — every shortcut must lead to a board that exists.
 *
 * 🚨 THIS SPEC IS WRITTEN AGAINST A DEFECT THAT WAS LIVE WHEN IT WAS WRITTEN.
 * The shipped shortcut list named `/admin/desk/ledger` and `/admin/desk/site`,
 * both of which had become `route.ts` redirects, and `/admin/desk/pulse`,
 * whose page had been deleted. Nothing caught any of it: a manifest is JSON,
 * `next build` never resolves the URLs inside one, and the failure only shows
 * up on a phone, in a launcher menu, on a long-press an operator does once.
 *
 * ⚠️ IT CHECKS FOR A `page.tsx`, NOT JUST FOR A DIRECTORY. That distinction is
 * the whole bug: `app/admin/desk/ledger/` still exists and still resolves —
 * it is a 307. A shortcut is a cold start, so a redirect costs a launch
 * showing a blank frame on the way somewhere the operator did not ask for.
 * That is exactly why `start_url` is /admin/desk and not /admin, and this
 * spec extends the same rule to the rest of the list.
 *
 * ⚠️ IT DOES NOT IMPORT DESK_TABS, deliberately. That list lives in a
 * 'use client' module owned by another track and is moving; pinning this file
 * to its SHAPE would fail whenever they reorder a tab. Pinning it to the
 * routes that actually exist stays true through any reordering and catches
 * the deletion, which is the failure that actually happened.
 */
const ROOT = path.resolve(__dirname, '..');

/** Does `url` resolve to a real App Router page under app/? */
function hasPage(url: string): boolean {
  const rel = url.replace(/^\//, '');
  return ['page.tsx', 'page.ts', 'page.jsx'].some((f) =>
    fs.existsSync(path.join(ROOT, 'app', rel, f)),
  );
}

describe('the Desk manifest', () => {
  const m = deskManifest();

  it('never shares an id with the shop, at any point', () => {
    // 🚨 THE ID, NOT THE URL, IS WHAT A BROWSER USES TO DECIDE IT ALREADY HAS
    // AN APP. Two manifests sharing `id: '/'` are one app wearing two names,
    // and installing the second silently UPDATES the first — replacing the
    // shop on the operator's home screen with the Desk.
    expect(m.id).toBe('/admin/desk');
    expect(m.id).not.toBe('/');
  });

  it('launches into a board rather than the redirect above it', () => {
    // /admin only redirects, so starting there shows a blank frame for one hop
    // on every cold start.
    expect(m.start_url).toBe('/admin/desk');
    expect(hasPage('/admin/desk')).toBe(true);
  });

  it('keeps the installed window on the Desk', () => {
    // Outside its scope a standalone app hands the link to the browser, so a
    // scope of '/' means tapping anything that leaves /admin quietly drops the
    // operator into a normal tab with no way back into the app frame.
    expect(m.scope).toBe('/admin');
    for (const s of m.shortcuts ?? []) {
      expect(s.url.startsWith('/admin'), s.url).toBe(true);
    }
  });

  it('parses at all — a passing check over an empty list proves nothing', () => {
    expect((m.shortcuts ?? []).length).toBe(4);
  });

  it('points every shortcut at a page, not a redirect and not a deleted route', () => {
    for (const s of m.shortcuts ?? []) {
      expect(hasPage(s.url), `${s.url} has no page.tsx`).toBe(true);
    }
  });

  it('declares the two fields that let an installed Desk be recognised in a tab', () => {
    // Without these, getInstalledRelatedApps() has nothing to match and always
    // answers empty — so an installed Desk browsed in an ordinary tab reads as
    // NOT installed and the Health board goes on offering an install.
    expect(m.prefer_related_applications).toBe(false);
    const related = m.related_applications ?? [];
    expect(related.length).toBe(1);
    // ⚠️ AND IT MUST BE THE DESK'S OWN MANIFEST. It has to match the manifest
    // of the page being viewed or the match never happens; the shop's copy of
    // this field was hardcoded to the retired domain and survived the rebrand.
    expect(related[0].url.endsWith('/admin/manifest.webmanifest')).toBe(true);
    expect(related[0].url).not.toContain('gungalore');
  });

  it('launches dark, because the app it launches is dark', () => {
    // The shop launches cream. Sharing that here is a white flash before a
    // near-black app, on every start, on the one screen an operator sees most.
    expect(m.background_color).toBe(m.theme_color);
    expect(m.background_color).toBe('#101312');
  });
});
