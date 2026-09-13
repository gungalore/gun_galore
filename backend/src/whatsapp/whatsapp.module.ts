import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { WhatsappService } from './whatsapp.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

// Meta WhatsApp Cloud API client — the fourth notification rail (email,
// SMS, in-app/web-push, WhatsApp). Mirrors SmsModule's shape.
//
// PrismaModule and SmsModule are both @Global already, so nothing outside
// this module strictly needs the imports below to resolve WhatsappService
// at runtime. They are imported explicitly anyway, same reasoning as
// news.module.ts importing PrismaModule/LlmModule despite both being
// global: whatsapp.module.spec.ts compiles THIS module alone, and a
// dependency that only resolves because some other module happened to load
// first is exactly the class of bug that boot spec exists to catch.
//
// WhatsappWebhookController takes no guard — it is deliberately public and
// unauthenticated (Meta calls it directly, HMAC-verified instead) — so the
// "every module with a guarded controller must resolve the guard's own
// dependencies" rule in CLAUDE.md does not apply here. The boot spec is
// still written, per the plan, because it is what catches a crash-loop that
// tsc and unit tests stay green through.
@Module({
  imports: [PrismaModule, SmsModule],
  controllers: [WhatsappWebhookController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
