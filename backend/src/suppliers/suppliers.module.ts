import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SuppliersService } from './suppliers.service';
import { SuppliersController } from './suppliers.controller';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AdminAuditService } from '../admin/admin-audit.service';

// Daily Deals suppliers (DD-F). Self-contained module (Pattern B, mirrors
// DealsModule): JwtModule for the AdminJwtGuard on the admin
// controller; AdminAuditService provided locally (it only needs the global
// PrismaService). PrismaService comes from its @Global() module.
//
// Exports SuppliersService so DealsService can validate the supplier link on
// deal create / update.
@Module({
  imports: [JwtModule.register({})],
  controllers: [SuppliersController],
  providers: [SuppliersService, AdminJwtGuard, AdminAuditService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
