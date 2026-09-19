import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { OzowModule } from '../payments/ozow.module';
import { DeskModule } from './desk.module';
import { DeskService } from './desk.service';
import { DeskWhatsappService } from './desk-whatsapp.service';

// ⚠️ THIS SPEC IS WHAT CATCHES THE CRASH-LOOP tsc AND EVERY UNIT SPEC STAY
// GREEN THROUGH. Per CLAUDE.md's rule on guards: DeskController,
// WardenController and DeskWhatsappController all take AdminJwtGuard, which
// injects JwtService + PrismaService + Reflector. Nest resolves a
// controller's @UseGuards classes inside the controller's OWN module, so a
// JwtModule registered globally elsewhere would not cover this one — the
// module has to bring JwtModule.register({}) itself, which it does. This
// compiles the module the way the app does, with only its GLOBAL dependency
// (PrismaService) stubbed, so a missing LOCAL wiring mistake fails here
// instead of on the box (the same failure class that took the site down for
// four minutes on 2026-09-07 over a different module).
describe('DeskModule', () => {
  it('boots with its controllers, guards and the WhatsApp reply service resolved', async () => {
    const mod = await Test.createTestingModule({
      // ⚠️ OzowModule ONLY BECAUSE THIS TEST MODULE GRAPH IS ISOLATED. It is
      // @Global in the real app (ozow.module.ts), which is what lets
      // ManualPaymentsService inject OzowService without ManualPaymentsModule
      // importing it — but a @Global module still has to be imported by
      // SOMETHING to be instantiated, and nothing else in this narrower graph
      // does. Not a DeskModule wiring gap; OzowService is dependency-free,
      // so importing it here costs nothing real.
      imports: [DeskModule, OzowModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(mod.get(DeskService)).toBeInstanceOf(DeskService);
    expect(mod.get(DeskWhatsappService)).toBeInstanceOf(DeskWhatsappService);
    await mod.close();
  });
});
