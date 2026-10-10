import { ContactDetailFilterService } from './contact-detail-filter.service';

// Pure regex auto-strip for the W4 conversation channel. No DB / model: the
// service is constructed with inert deps and only `redact` is exercised.
function make() {
  return new ContactDetailFilterService(
    {} as never,
    { isConfigured: () => false } as never,
  );
}

describe('ContactDetailFilterService.redact', () => {
  it('strips a phone number and reports the category', () => {
    const r = make().redact('call me on 082 123 4567');
    expect(r.text).toContain('[removed]');
    expect(r.text).not.toContain('082');
    expect(r.categories).toContain('phone');
  });

  it('strips an email and a URL', () => {
    const r = make().redact('mail me at bob@example.com or see myshop.co.za');
    expect(r.text).not.toContain('bob@example.com');
    expect(r.text).not.toContain('myshop.co.za');
    expect(r.categories).toEqual(expect.arrayContaining(['email', 'url']));
  });

  it('keeps allowlisted brand domains (a product reference is not contact)', () => {
    const r = make().redact('it is a vortexoptics.com scope');
    expect(r.text).toContain('vortexoptics.com');
    expect(r.categories).not.toContain('url');
  });

  it('leaves a clean message untouched', () => {
    const r = make().redact('Is the scope still available? R5000 is fine.');
    expect(r.text).toBe('Is the scope still available? R5000 is fine.');
    expect(r.categories).toEqual([]);
  });
});
