import { Test } from '@nestjs/testing';
import { LlmModule } from './llm.module';
import { LlmService } from './llm.service';
import { PrismaService } from '../../prisma/prisma.service';

// ⚠️ THIS TEST EXISTS BECAUSE THE FAILURE IT CATCHES IS A BOOT CRASH, and a
// boot crash takes the whole API down rather than one feature.
//
// LlmService's constructor takes two OPTIONAL provider parameters so the unit
// tests can drive fakes. A parameter typed as an interface emits `Object` as
// its design:paramtypes metadata, so without `@Optional() @Inject(token)`
// Nest would try to resolve a provider called Object, fail, and refuse to
// start the container — and nothing in tsc, the build, or any other spec
// would have said a word about it.
describe('LlmModule', () => {
  it('resolves LlmService — the optional provider tokens must not break DI', async () => {
    const mod = await Test.createTestingModule({ imports: [LlmModule] })
      .overrideProvider(PrismaService)
      .useValue({ aiUsage: { create: jest.fn() } })
      .compile();

    const svc = mod.get(LlmService);
    expect(svc).toBeInstanceOf(LlmService);
    expect(svc.provider).toBe('gemini');
    await mod.close();
  });
});
