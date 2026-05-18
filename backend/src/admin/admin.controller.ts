import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { SuperadminGuard } from './guards/superadmin.guard';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { AdminAuthService } from './admin-auth.service';
import { AdminService } from './admin.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { ListingReviewDto } from './dto/listing-review.dto';
import { UpdateUserDto } from './dto/update-user.dto';

// ---------------------------------------------------------------
// Auth
// ---------------------------------------------------------------
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() dto: AdminLoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @UseGuards(AdminJwtGuard)
  me(@CurrentAdmin() admin: { sub: string; email: string; role: string }) {
    return this.authService.me(admin);
  }
}

// ---------------------------------------------------------------
// Stats
// ---------------------------------------------------------------
@Controller('admin')
@UseGuards(AdminJwtGuard)
export class AdminStatsController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  @UseGuards(SuperadminGuard)
  stats() {
    return this.adminService.stats();
  }
}

// ---------------------------------------------------------------
// Listings
// ---------------------------------------------------------------
@Controller('admin/listings')
@UseGuards(AdminJwtGuard)
export class AdminListingsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  getListings(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getListings(status, Number(page) || 1, Number(limit) || 20);
  }

  @Post(':id/review')
  @HttpCode(200)
  reviewListing(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: ListingReviewDto,
  ) {
    return this.adminService.reviewListing(id, admin.sub, dto);
  }
}

// ---------------------------------------------------------------
// Users
// ---------------------------------------------------------------
@Controller('admin/users')
@UseGuards(AdminJwtGuard)
export class AdminUsersController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  getUsers(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getUsers(search, Number(page) || 1, Number(limit) || 30);
  }

  @Patch(':id')
  updateUser(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, admin.sub, dto);
  }
}

// ---------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------
@Controller('admin/transactions')
@UseGuards(AdminJwtGuard)
export class AdminTransactionsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  getTransactions(
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.getTransactions(status, Number(page) || 1, Number(limit) || 20);
  }

  @Post(':id/release')
  @HttpCode(200)
  release(@Param('id') id: string, @CurrentAdmin() admin: { sub: string }) {
    return this.adminService.releaseTransaction(id, admin.sub);
  }

  @Post(':id/refund')
  @HttpCode(200)
  refund(
    @Param('id') id: string,
    @CurrentAdmin() admin: { sub: string },
    @Body('note') note?: string,
  ) {
    return this.adminService.refundTransaction(id, admin.sub, note);
  }
}
