import { JwtService } from '@nestjs/jwt';
import { SessionService } from './session.service';
import { CATALOGUE_AUDIENCE, CATALOGUE_PURPOSE } from './catalogue-access';

// The 18+ declaration is a JWT that shares the member secret but must never be
// usable as a session, and a session must never be usable as a declaration.
// These tests are the separation.
describe('SessionService — catalogue declaration token', () => {
  const SECRET = 'catalogue-declaration-spec-secret-0123456789abcdef';
  const originalEnv = process.env;
  let service: SessionService;

  beforeEach(() => {
    process.env = { ...originalEnv, JWT_MEMBER_SECRET: SECRET };
    service = new SessionService({} as never, new JwtService({}));
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('mints a token that verifies as a declaration', async () => {
    const { token, expiresAt } = await service.mintCatalogueDeclaration();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    await expect(service.verifyCatalogueDeclaration(token)).resolves.toBe(true);
  });

  it('rejects a member-shaped token as a declaration', async () => {
    const memberLike = await new JwtService({}).signAsync(
      { sub: 'user_1', sid: 'session_1' },
      { secret: SECRET, expiresIn: '15m' },
    );
    await expect(
      service.verifyCatalogueDeclaration(memberLike),
    ).resolves.toBe(false);
  });

  it('rejects a token with the right audience but the wrong purpose', async () => {
    const wrongPurpose = await new JwtService({}).signAsync(
      { purpose: 'something-else', v: 1 },
      { secret: SECRET, audience: CATALOGUE_AUDIENCE, expiresIn: '30d' },
    );
    await expect(
      service.verifyCatalogueDeclaration(wrongPurpose),
    ).resolves.toBe(false);
  });

  it('rejects a tampered token', async () => {
    const { token } = await service.mintCatalogueDeclaration();
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    await expect(
      service.verifyCatalogueDeclaration(tampered),
    ).resolves.toBe(false);
  });

  it('does not include a subject (a declaration must never authenticate)', async () => {
    const { token } = await service.mintCatalogueDeclaration();
    const payload = new JwtService({}).decode<Record<string, unknown>>(token);
    expect(payload).toMatchObject({ purpose: CATALOGUE_PURPOSE, v: 1 });
    expect(payload?.sub).toBeUndefined();
    expect(payload?.sid).toBeUndefined();
  });
});
