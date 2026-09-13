import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappModule } from './whatsapp.module';
import { WhatsappService } from './whatsapp.service';

// Per CLAUDE.md's rule on guards, every module that mounts a guarded
// controller must resolve that guard's own dependencies — a global module
// registered elsewhere does not help, because Nest resolves a controller's
// @UseGuards classes inside the controller's OWN module. This controller
// (WhatsappWebhookController) takes NO guard — it is deliberately public,
// HMAC-verified instead — so that specific failure mode does not apply
// here. This boot spec exists anyway, per the plan, because it is what
// catches a crash-loop that tsc and every unit spec stay green through:
// compiling the module the way the app does, with only its GLOBAL
// dependencies (PrismaService) stubbed, surfaces a missing LOCAL wiring
// mistake here instead of on the box.
describe('WhatsappModule', () => {
  it('boots with its controller and service resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [WhatsappModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    expect(mod.get(WhatsappService)).toBeInstanceOf(WhatsappService);
    await mod.close();
  });
});
