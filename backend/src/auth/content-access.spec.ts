import { NotFoundException } from '@nestjs/common';
import { ContentAccessGuard } from './content-access.guard';

function executionContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe('ContentAccessGuard — the 18+ gate, server-side', () => {
  const guard = new ContentAccessGuard();

  it('allows a signed-in member', () => {
    expect(guard.canActivate(executionContext({ userId: 'user_1' }))).toBe(true);
  });

  it('allows a declared 18+ visitor (no session)', () => {
    expect(
      guard.canActivate(executionContext({ catalogueDeclared: true })),
    ).toBe(true);
  });

  it('404s a caller with neither a session nor a declaration', () => {
    expect(() => guard.canActivate(executionContext({}))).toThrow(
      NotFoundException,
    );
    expect(() =>
      guard.canActivate(executionContext({ catalogueDeclared: false })),
    ).toThrow(NotFoundException);
  });

  // No user-agent, header or query-parameter branch may ever appear here:
  // a crawler gets exactly what an un-declared human gets.
});
