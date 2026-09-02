import * as fs from 'node:fs';
import * as path from 'node:path';

// THE TWO FLAG REGISTRIES MUST AGREE, AND NOTHING ENFORCED THAT UNTIL NOW.
//
// A flag lives in two places by design: settings.service.ts FLAGS carries the
// runtime accessor (key, default, parser) and admin-settings.service.ts FLAGS
// carries the editor metadata (label, hint, group, input type). The comment in
// admin-settings.service.ts says they are "kept in sync manually".
//
// They are not. A key registered ONLY in the runtime registry is invisible in
// /admin/settings AND rejected by PATCH with "Unknown setting key" — so the
// operator cannot change it at all, and the only way to move it is a SQL
// UPDATE against the Setting table. Twelve keys are in that state today,
// including pro_draw_enabled and subscription_pro_price_cents.
//
// This spec does two things:
//   1. Fails if a NEW key drifts. That is the regression guard.
//   2. Pins the twelve that are already drifted, so the debt is written down
//      and visible rather than folklore. Fixing one means deleting it from the
//      list below — the test will tell you to.
//
// Read as source text rather than importing the modules: admin-settings.service
// pulls in Nest + Prisma, and this assertion is about what is WRITTEN in the
// two files, not about runtime behaviour.

const BACKEND_SRC = path.join(__dirname, '..');

function keysIn(relPath: string): Set<string> {
  const src = fs.readFileSync(path.join(BACKEND_SRC, relPath), 'utf8');
  return new Set([...src.matchAll(/key:\s*'([a-z0-9_]+)'/g)].map((m) => m[1]));
}

/**
 * Keys that exist in the runtime registry but NOT in the admin one, as at
 * 2026-08-18. Every one of these is un-editable through the admin UI.
 *
 * This list is a record of debt, not a licence to add more. If you fix one,
 * remove it here. If you add a flag, add it to BOTH registries and this list
 * stays untouched.
 */
const KNOWN_ADMIN_INVISIBLE = [
  'ask_gg_free_msg_cap_per_30d',
  'ask_gg_free_photo_cap_per_30d',
  'ask_gg_member_msg_cap_per_hour',
  'ask_gg_pro_msg_cap_per_hour',
  'ask_gg_support_msg_cap_per_day',
  'dealer_auto_register_enabled',
  'pro_draw_enabled',
  'raffle_floor_cents',
  'raffle_frequency',
  'raffle_pool_percent',
  'subscription_pro_price_cents',
].sort();

describe('settings flag registries', () => {
  const runtime = keysIn('settings/settings.service.ts');
  const admin = keysIn('admin/admin-settings.service.ts');

  it('finds flags in both files (guards against the regex silently breaking)', () => {
    expect(runtime.size).toBeGreaterThan(10);
    expect(admin.size).toBeGreaterThan(10);
  });

  it('has no NEW admin-invisible flags beyond the recorded debt', () => {
    const invisible = [...runtime].filter((k) => !admin.has(k)).sort();
    expect(invisible).toEqual(KNOWN_ADMIN_INVISIBLE);
  });

  it('has no admin flags that nothing reads at runtime', () => {
    // The reverse drift: an editor for a key no code consults. The operator
    // changes it, saves, and nothing happens — worse than an error.
    // Currently zero, and it should stay that way.
    const orphaned = [...admin].filter((k) => !runtime.has(k)).sort();
    expect(orphaned).toEqual([]);
  });

  it('registers every motivation flag in BOTH registries', () => {
    const mine = (s: Set<string>) =>
      [...s].filter((k) => k.startsWith('motivation_')).sort();
    expect(mine(runtime)).toEqual(mine(admin));
    expect(mine(runtime)).toEqual([
      'motivation_beta_free_cap',
      'motivation_buyer_price_cents',
      'motivation_max_gate_cycles',
      'motivation_price_cents',
      'motivation_retention_days',
      'motivation_writer_enabled',
    ]);
  });

  it('quotes the SAME document cap in both registries', () => {
    // ⚠️ THE TWO DEFAULTS ARE READ BY DIFFERENT PEOPLE FOR THE SAME NUMBER.
    // With no Setting row written, the runtime default is what actually caps
    // uploads and the admin default is what /admin/settings PRINTS as the
    // current value. Raising one and not the other shows the operator a
    // ceiling that is not the ceiling — and the number moved from 25 to 60
    // when the Centre started holding the whole application folder.
    const runtimeSrc = fs.readFileSync(
      path.join(BACKEND_SRC, 'settings/settings.service.ts'),
      'utf8',
    );
    const adminSrc = fs.readFileSync(
      path.join(BACKEND_SRC, 'admin/admin-settings.service.ts'),
      'utf8',
    );
    const entry = (src: string) => {
      const from = src.indexOf("key: 'licence_centre_max_credentials'");
      expect(from).toBeGreaterThan(-1);
      return src.slice(from, src.indexOf('},', from));
    };
    expect(entry(runtimeSrc)).toContain('default: 60');
    expect(entry(adminSrc)).toContain("default: '60'");
    // And nothing left over from the old ceiling in the hint the operator reads.
    expect(entry(adminSrc)).not.toContain('25');
  });

  it('marks the motivation master switch as a danger flag', () => {
    // danger:true forces the typed-key gate and a 15-char audit reason.
    // Flipping this ships a legal-adjacent document to the public and starts
    // spending Anthropic money, so it must never be a stray checkbox click.
    const src = fs.readFileSync(
      path.join(BACKEND_SRC, 'admin/admin-settings.service.ts'),
      'utf8',
    );
    const block = src.slice(src.indexOf("key: 'motivation_writer_enabled'"));
    const entry = block.slice(0, block.indexOf('},'));
    expect(entry).toContain('danger: true');
  });
});
