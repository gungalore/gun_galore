import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ComplaintsService } from './complaints.service';
import { ComplaintsController } from './complaints.controller';
import { ComplaintsAdminController } from './complaints-admin.controller';
import { ReferenceNumberService } from '../common/reference-number.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';

// Formal complaints register. PrismaService, NotificationsService and
// CloudinaryService come from @Global() modules; ReferenceNumberService is
// provided locally (it only needs the global PrismaService). JwtModule +
// AdminJwtGuard are needed locally because the admin controller is
// @UseGuards(AdminJwtGuard) — same pattern as SupportModule. No import of
// TransactionsModule (the HELD→DISPUTED CAS is done inline) so there is no
// circular dependency.
@Module({
  imports: [JwtModule.register({})],
  controllers: [ComplaintsController, ComplaintsAdminController],
  providers: [ComplaintsService, ReferenceNumberService, AdminJwtGuard],
})
export class ComplaintsModule {}
