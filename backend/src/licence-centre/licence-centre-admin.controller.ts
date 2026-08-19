import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { LicenceCentreService } from './licence-centre.service';

// Counts and health ONLY. An admin never sees a member's document or a
// decrypted detail off one — the vault is the member's, and an admin surface
// that can read it is a surface that will be asked to.

@Controller('admin/licence-centre')
@UseGuards(AdminJwtGuard)
export class LicenceCentreAdminController {
  constructor(private readonly svc: LicenceCentreService) {}

  @Get()
  health() {
    return this.svc.adminHealth();
  }
}
