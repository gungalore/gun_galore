import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { LegalService } from './legal.service';

@Controller('legal')
@UseGuards(AuthGuard)
export class LegalController {
  constructor(private readonly legal: LegalService) {}

  @Get('sources')
  sources() {
    return this.legal.sources();
  }

  @Get('search')
  search(
    @Query('q') q = '',
    @Query('source') source?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Number(limit);
    return this.legal.search(q, {
      source,
      limit: Number.isFinite(parsed) ? parsed : undefined,
    });
  }

  @Get('section/:source/:section')
  section(
    @Param('source') source: string,
    @Param('section') section: string,
  ) {
    return this.legal.section(source, section);
  }
}
