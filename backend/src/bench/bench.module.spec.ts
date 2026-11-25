import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ContentAccessGuard } from '../auth/content-access.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { BenchModule } from './bench.module';
import { BenchService } from './bench.service';

// Compiles BenchModule the way the app does, standing in only for the GLOBAL
// providers (the guards themselves are built for real). BenchController mounts
// OptionalAuthGuard and ContentAccessGuard on its reads, and Nest resolves
// those inside the controller's OWN module — a missing provider here is a
// backend that crash-loops at boot while tsc and every unit test stay green.
// Same spec as listings.module and auctions.module, which mount the same pair.
@Global()
@Module({
  providers: [
    { provide: SessionService, useValue: {} },
    { provide: PrismaService, useValue: {} },
  ],
  exports: [SessionService, PrismaService],
})
class StubGlobalsModule {}

describe('BenchModule', () => {
  it('boots with its controllers and both public-read guards resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, BenchModule],
    }).compile();

    expect(mod.get(BenchService)).toBeInstanceOf(BenchService);
    expect(mod.get(OptionalAuthGuard)).toBeInstanceOf(OptionalAuthGuard);
    expect(mod.get(ContentAccessGuard)).toBeInstanceOf(ContentAccessGuard);
    await mod.close();
  });
});
