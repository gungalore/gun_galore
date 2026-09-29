import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { OzowService } from '../payments/ozow.service';
import { ManualPaymentsModule } from './manual-payments.module';
import { ManualPaymentsService } from './manual-payments.service';
import { OzowPayoutTestService } from './ozow-payout-test.service';

// ⚠️ THIS SPEC EXISTS BECAUSE A MISSING LOCAL GUARD DEPENDENCY CRASH-LOOPS THE
// BACKEND AT BOOT WHILE tsc AND EVERY UNIT SPEC STAY GREEN (2026-09-07). Nest
// resolves a controller's @UseGuards classes inside the controller's own
// module, so the AdminJwtGuard mounted by this module's two controllers must
// resolve here — with only the GLOBAL providers (PrismaService, OzowService)
// stood in for.
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: OzowService, useValue: {} },
  ],
  exports: [PrismaService, OzowService],
})
class StubGlobalsModule {}

describe('ManualPaymentsModule', () => {
  it('boots with its controllers and guards resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, ManualPaymentsModule],
    }).compile();

    expect(mod.get(ManualPaymentsService)).toBeInstanceOf(ManualPaymentsService);
    expect(mod.get(OzowPayoutTestService)).toBeInstanceOf(
      OzowPayoutTestService,
    );
    await mod.close();
  });
});
