import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { SuppliersService } from './suppliers.service';
import {
  CreateSupplierDto,
  UpdateSupplierDto,
  SupplierActionDto,
} from './dto/supplier.dto';

/**
 * Admin-only Daily Deals suppliers CRUD (DD-F).
 *
 *   GET    /admin/suppliers            list (active first)
 *   GET    /admin/suppliers/:id        single supplier
 *   POST   /admin/suppliers            create
 *   PATCH  /admin/suppliers/:id        edit
 *   POST   /admin/suppliers/:id/deactivate   soft-delete (active=false)
 *
 * There is NO hard-delete and NO public read: supplier / cost / PO data is
 * strictly internal. Every mutation is audited in SuppliersService.
 */
@Controller('admin/suppliers')
@UseGuards(AdminJwtGuard)
@SkipThrottle()
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  list() {
    return this.suppliers.list();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.suppliers.getOne(id);
  }

  @Post()
  create(
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: CreateSupplierDto,
  ) {
    return this.suppliers.create(admin.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(admin.sub, id, dto);
  }

  @Post(':id/deactivate')
  deactivate(
    @CurrentAdmin() admin: { sub: string },
    @Param('id') id: string,
    @Body() dto: SupplierActionDto,
  ) {
    return this.suppliers.deactivate(admin.sub, id, dto?.reason);
  }
}
