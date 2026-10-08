import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LlmService } from '../common/llm/llm.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../auth/session.service';
import { ValuationModule } from './valuation.module';
import { ValuationService } from './valuation.service';

// Boots ValuationModule the way the app does, standing in only for the global
// providers. A missing local guard dependency fails here, not by crash-looping
// production (same guard as feed.module.spec.ts, 2026-09-07).
@Global()
@Module({
  providers: [
    { provide: PrismaService, useValue: {} },
    { provide: SessionService, useValue: {} },
    { provide: CloudinaryService, useValue: {} },
    { provide: LlmService, useValue: {} },
  ],
  exports: [PrismaService, SessionService, CloudinaryService, LlmService],
})
class StubGlobalsModule {}

describe('ValuationModule', () => {
  it('boots with its controller and guard resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, ValuationModule],
    }).compile();

    expect(mod.get(ValuationService)).toBeInstanceOf(ValuationService);
    await mod.close();
  });
});
