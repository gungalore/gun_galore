import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BallisticsService } from './ballistics.service';
import { BallisticsBulletLookupService } from './ballistics-bullet-lookup.service';
import { BallisticsPurchaseService } from './ballistics-purchase.service';
import { BallisticsProfilesService } from './ballistics-profiles.service';
import { BallisticsController } from './ballistics.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ZohoBooksModule } from '../zoho/zoho-books.module';
import { AdminAuditService } from '../admin/admin-audit.service';

/**
 * Ballistic Calculator module.
 *
 * Exports `BallisticsService` so AskGgModule can keep wiring it into
 * Claude tool-use for the chat assistant. Exports
 * `BallisticsPurchaseService` so the Peach webhook handler in
 * PaymentsModule can route ballistics-prefixed transactions back here
 * to grant the license.
 *
 * JwtModule import mirrors AskGgModule — registers the admin JWT
 * secret so admin-side refund routes (when wired) work without
 * circular AdminModule import.
 */
@Module({
  imports: [
    PrismaModule,
    PaymentsModule,        // PeachService
    NotificationsModule,   // NotificationsService
    ZohoBooksModule,       // ZohoBooksService
    JwtModule.register({
      secret: process.env.JWT_ADMIN_SECRET || 'dev-admin-secret-change-in-prod',
    }),
  ],
  controllers: [BallisticsController],
  providers: [
    BallisticsService,
    BallisticsBulletLookupService,
    BallisticsPurchaseService,
    BallisticsProfilesService,
    AdminAuditService,
  ],
  exports: [BallisticsService, BallisticsPurchaseService],
})
export class BallisticsModule {}
