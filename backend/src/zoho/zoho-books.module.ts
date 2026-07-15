import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ZohoBooksService } from './zoho-books.service';

/**
 * Zoho Books accounting integration.
 *
 * Exports ZohoBooksService for injection into:
 *   - PaymentsModule (commission invoices, refund credit notes)
 *   - FeaturedModule (featured-slot fee invoices)
 *   - AdminModule (health monitor, sync status panel)
 */
@Module({
  imports: [PrismaModule],
  providers: [ZohoBooksService],
  exports: [ZohoBooksService],
})
export class ZohoBooksModule {}
