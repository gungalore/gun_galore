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
  acceptToken: 'safe-action-token',
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

  it('carries no shipping templates — Bob Go sends shipping directly', () => {
    const keys = Object.keys(WHATSAPP_TEMPLATES);
    expect(
      keys.some((k) => /shipment|shipping|dispatch|delivery|parcel/.test(k)),
    ).toBe(false);
  });

  it('registers the sales-driving templates and the three motivation outcomes', () => {
    for (const key of [
      'offer_received_seller',
      'offer_accepted_buyer',
      'offer_countered_buyer',
      'bid_outbid_buyer',
      'auction_won_buyer',
      'motivation_ready_applicant',
      'motivation_needs_info_applicant',
      'motivation_failed_applicant',
    ]) {
      expect(WHATSAPP_TEMPLATES[key]).toBeDefined();
    }
  });

  it('welcome_complete_profile links to the static "p" code, not a per-instance one', () => {
    expect(
      WHATSAPP_TEMPLATES.welcome_complete_profile.linkCode(FULL_VARS),
    ).toBe('p');
  });

  // ⚠️ REGRESSION: the live Meta template for welcome is /t/{{1}}, so the
  // button parameter MUST be sent. Only the five fully-static sales buttons
  // omit it. Getting this backwards is a silent 132001 + SMS fallback.
  it('sends a URL-button parameter only for static-code exceptions', () => {
    for (const key of [
      'offer_received_seller',
      'offer_accepted_buyer',
      'offer_countered_buyer',
      'bid_outbid_buyer',
      'auction_won_buyer',
    ]) {
      expect(WHATSAPP_TEMPLATES[key].buttonParam).toBe(false);
    }
    expect(WHATSAPP_TEMPLATES.welcome_complete_profile.buttonParam).not.toBe(
      false,
    );
    for (const key of [
      'motivation_ready_applicant',
      'motivation_needs_info_applicant',
      'motivation_failed_applicant',
      'dealer_collection_ready_buyer',
    ]) {
      expect(WHATSAPP_TEMPLATES[key].buttonParam).not.toBe(false);
    }
  });

  it('motivation templates link through the m<id> short code', () => {
    const id = 'clhq3v9m0000abc123defg';
    for (const key of [
      'motivation_ready_applicant',
      'motivation_needs_info_applicant',
      'motivation_failed_applicant',
    ]) {
      expect(WHATSAPP_TEMPLATES[key].linkCode({ motivationId: id })).toBe(
        `m${id}`,
      );
    }
  });

  // ⚠️ THE GUARD IN sendTemplate ONLY WORKS IF linkVars IS HONEST. It refuses
  // a send when a declared variable is missing; a template whose linkCode
  // reaches for `txId` without declaring it would sail past that check and
  // build the dead suffix `tundefined` in a message nobody can recall.
  it.each(Object.entries(WHATSAPP_TEMPLATES))(
    '%s: every variable linkCode actually reads is declared in linkVars',
    (_key, def) => {
      // A quick-reply template has no URL button — linkCode/linkVars are unused.
      if (def.buttonType === 'quick_reply') {
        expect(def.linkVars.length).toBe(0);
        return;
      }
      const suffix = def.linkCode(
        Object.fromEntries(def.linkVars.map((k) => [k, 'SENTINEL'])),
      );
      expect(suffix).not.toContain('undefined');
      expect(suffix.length).toBeGreaterThan(0);
    },
  );
});
