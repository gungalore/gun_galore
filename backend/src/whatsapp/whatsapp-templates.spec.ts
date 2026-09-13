import { WHATSAPP_TEMPLATES } from './whatsapp-templates';

// A fixture listing title deliberately fed in under every disallowed key
// name, to prove render() can never surface it even if a call site
// mistakenly passed one.
const FIXTURE_TITLE = 'Tikka T3x CTR .308 Winchester Rifle';
const DISALLOWED_VAR_NAMES = ['title', 'listingTitle', 'item', 'name'];

const FULL_VARS: Record<string, string> = {
  ref: 'MO4F2A9C',
  waybill: 'WB123456789',
  pin: '4821',
  txId: 'cktxid1234567890',
  title: FIXTURE_TITLE,
  listingTitle: FIXTURE_TITLE,
  item: FIXTURE_TITLE,
  name: FIXTURE_TITLE,
};

describe('WHATSAPP_TEMPLATES — the hard rule', () => {
  const defs = Object.values(WHATSAPP_TEMPLATES);

  it('has at least one template registered', () => {
    expect(defs.length).toBeGreaterThan(0);
  });

  it.each(defs.map((d) => [d.key, d] as const))(
    '%s: requiredVars never names a title/item/name field',
    (_key, def) => {
      for (const v of [...def.requiredVars, ...def.linkVars]) {
        expect(DISALLOWED_VAR_NAMES).not.toContain(v);
      }
    },
  );

  it.each(defs.map((d) => [d.key, d] as const))(
    '%s: render() output never contains the fixture listing title, even when fed every disallowed key',
    (_key, def) => {
      const output = def.render(FULL_VARS);
      expect(output).not.toContain(FIXTURE_TITLE);
    },
  );

  it.each(defs.map((d) => [d.key, d] as const))(
    '%s: linkCode() output never contains the fixture listing title',
    (_key, def) => {
      const code = def.linkCode(FULL_VARS);
      expect(code).not.toContain(FIXTURE_TITLE);
    },
  );

  it('every metaName is unique', () => {
    const names = defs.map((d) => d.metaName);
    expect(new Set(names).size).toBe(names.length);
  });

  it('every metaName is snake_case (lowercase letters, digits, underscores only)', () => {
    for (const def of defs) {
      expect(def.metaName).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('every metaName matches its registry key', () => {
    for (const def of defs) {
      expect(def.metaName).toBe(def.key);
    }
  });

  it('every def declares lang "en" (never en_ZA — extra approval overhead for nothing)', () => {
    for (const def of defs) {
      expect(def.lang).toBe('en');
    }
  });

  it('no body starts or ends with a variable (Meta grammar rule)', () => {
    // A template with placeholders is rendered here with visibly distinct
    // sentinel values, then we check the sentinels never sit at either edge
    // of the trimmed string.
    for (const def of defs) {
      if (def.requiredVars.length === 0) continue;
      const sentineled = Object.fromEntries(
        def.requiredVars.map((k, i) => [k, `<<VAR${i}>>`]),
      );
      const output = def.render({ ...FULL_VARS, ...sentineled }).trim();
      expect(output.startsWith('<<VAR')).toBe(false);
      expect(output.endsWith('>>')).toBe(false);
    }
  });

  it('rendered bodies are non-empty and end with sentence punctuation', () => {
    for (const def of defs) {
      const output = def.render(FULL_VARS).trim();
      expect(output.length).toBeGreaterThan(0);
      expect(/[.!?]$/.test(output)).toBe(true);
    }
  });

  it('order_confirmed_buyer and shipment_dispatched_buyer (the proving pair) are registered', () => {
    expect(WHATSAPP_TEMPLATES.order_confirmed_buyer).toBeDefined();
    expect(WHATSAPP_TEMPLATES.shipment_dispatched_buyer).toBeDefined();
  });

  it('welcome_complete_profile links to the static "p" code, not a per-instance one', () => {
    expect(WHATSAPP_TEMPLATES.welcome_complete_profile.linkCode(FULL_VARS)).toBe(
      'p',
    );
  });

  it('shipment_booked_seller_locker carries ref, waybill and pin in that order', () => {
    expect(WHATSAPP_TEMPLATES.shipment_booked_seller_locker.requiredVars).toEqual(
      ['ref', 'waybill', 'pin'],
    );
  });

  // ⚠️ THE GUARD IN sendTemplate ONLY WORKS IF linkVars IS HONEST. It refuses
  // a send when a declared variable is missing; a template whose linkCode
  // reaches for `txId` without declaring it would sail past that check and
  // build the dead suffix `tundefined` in a message nobody can recall.
  it.each(Object.entries(WHATSAPP_TEMPLATES))(
    '%s: every variable linkCode actually reads is declared in linkVars',
    (_key, def) => {
      const suffix = def.linkCode(
        Object.fromEntries(def.linkVars.map((k) => [k, 'SENTINEL'])),
      );
      expect(suffix).not.toContain('undefined');
      expect(suffix.length).toBeGreaterThan(0);
    },
  );
});
