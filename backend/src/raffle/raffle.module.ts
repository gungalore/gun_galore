import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RaffleService } from './raffle.service';
import { RaffleController } from './raffle.controller';
import { RaffleAdminController } from './raffle-admin.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';

// GG PRO prize draw (Pattern B, mirrors DealsModule): JwtModule.register({})
// + AdminJwtGuard provided locally for the admin controller — a module with
// an AdminJwtGuard controller MUST wire both or the backend crash-loops at
// boot (tsc passes). Prisma/Settings/Cloudinary/Notifications all come from
// their @Global() modules.
@Module({
  imports: [JwtModule.register({})],
  controllers: [RaffleController, RaffleAdminController],
  providers: [RaffleService, AdminJwtGuard],
  exports: [RaffleService],
})
export class RaffleModule {}
