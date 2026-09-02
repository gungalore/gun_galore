import { Module } from '@nestjs/common';
import { BenchService } from './bench.service';
import { BenchController } from './bench.controller';

/**
 * THE BENCH — the reverse load finder.
 *
 * PrismaService comes from the @Global() PrismaModule. ClerkGuard and
 * OptionalClerkGuard resolve from the auth module's own providers, as they do
 * for every other member-facing controller.
 */
@Module({
  controllers: [BenchController],
  providers: [BenchService],
  exports: [BenchService],
})
export class BenchModule {}
