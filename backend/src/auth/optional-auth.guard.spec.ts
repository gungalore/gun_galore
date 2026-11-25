import { OptionalAuthGuard } from './optional-auth.guard';
import type { SessionService } from './session.service';

function request(init: Record<string, unknown>) {
  return {
    headers: {},
    cookies: {},
    ...init,
  } as never;
}

function sessions(over: Partial<Record<keyof SessionService, jest.Mock>> = {}) {
  return {
    verify: jest.fn().mockResolvedValue({ sub: 'user_1', sid: 'session_1' }),
    verifyCatalogueDeclaration: jest.fn().mockResolvedValue(true),
    ...over,
  } as never;
}

describe('OptionalAuthGuard — session and 18+ declaration', () => {
  it('stamps userId from a member token and never reads the declaration', async () => {
    const req = request({ headers: { authorization: 'Bearer member-token' } });
    const svc = sessions();
    const guard = new OptionalAuthGuard(svc);

    await expect(guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as never)).resolves.toBe(true);
    expect((req as { userId?: string }).userId).toBe('user_1');
    expect((req as { catalogueDeclared?: boolean }).catalogueDeclared).toBeUndefined();
    expect((svc as unknown as { verifyCatalogueDeclaration: jest.Mock }).verifyCatalogueDeclaration).not.toHaveBeenCalled();
  });

  it('stamps catalogueDeclared for a valid ao_cat cookie with no session', async () => {
    const req = request({ headers: {}, cookies: { ao_cat: 'declaration' } });
    const svc = sessions();
    const guard = new OptionalAuthGuard(svc);

    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as never);

    expect((req as { userId?: string }).userId).toBeUndefined();
    expect((req as { catalogueDeclared?: boolean }).catalogueDeclared).toBe(true);
  });

  it('treats a tampered/expired declaration as undeclared (never rejects)', async () => {
    const req = request({ cookies: { ao_cat: 'tampered' } });
    const svc = sessions({
      verifyCatalogueDeclaration: jest.fn().mockResolvedValue(false),
    });
    const guard = new OptionalAuthGuard(svc);

    await expect(
      guard.canActivate({
        switchToHttp: () => ({ getRequest: () => req }),
      } as never),
    ).resolves.toBe(true);
    expect((req as { catalogueDeclared?: boolean }).catalogueDeclared).toBe(
      false,
    );
  });

  it('falls back to the declaration when the member token is stale', async () => {
    const req = request({
      headers: { authorization: 'Bearer stale-token' },
      cookies: { ao_cat: 'declaration' },
    });
    const svc = sessions({
      verify: jest.fn().mockRejectedValue(new Error('expired')),
      verifyCatalogueDeclaration: jest.fn().mockResolvedValue(true),
    });
    const guard = new OptionalAuthGuard(svc);

    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as never);

    expect((req as { userId?: string }).userId).toBeUndefined();
    expect((req as { catalogueDeclared?: boolean }).catalogueDeclared).toBe(true);
  });
});
