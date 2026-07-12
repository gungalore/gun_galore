import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { WantedService } from './wanted.service';
import { CreateWantedDto } from './dto/create-wanted.dto';
import { RespondWantedDto } from './dto/respond-wanted.dto';

/**
 * /wanted routes — demand-capture "looking for…" board.
 *
 *   GET  /wanted                      — public browse (category/province/page)
 *   GET  /wanted/mine                 — my ads (auth)
 *   GET  /wanted/:id                  — public detail (no response contents)
 *   GET  /wanted/:id/responses        — owner-only response list (auth)
 *   GET  /wanted/:id/my-response      — caller's respond-state (auth)
 *   POST /wanted                      — create (auth, contact-filtered)
 *   POST /wanted/:id/respond          — respond w/ own listing / message (auth)
 *   POST /wanted/:id/close            — owner closes (auth)
 *
 * NOTE route order: /mine before /:id so "mine" never resolves as an id.
 */
@Controller('wanted')
export class WantedController {
  constructor(private readonly wanted: WantedService) {}

  @Get()
  browse(
    @Query('categoryId') categoryId?: string,
    @Query('province') province?: string,
    @Query('page') page?: string,
  ) {
    return this.wanted.browse({
      categoryId,
      province,
      page: page ? Number(page) : 1,
    });
  }

  @Get('mine')
  @UseGuards(ClerkGuard)
  mine(@CurrentUser() clerkId: string) {
    return this.wanted.mine(clerkId);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.wanted.detail(id);
  }

  @Get(':id/responses')
  @UseGuards(ClerkGuard)
  responses(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.wanted.responsesFor(clerkId, id);
  }

  @Get(':id/my-response')
  @UseGuards(ClerkGuard)
  myResponse(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.wanted.myResponseState(clerkId, id);
  }

  @Post()
  @UseGuards(ClerkGuard)
  create(@CurrentUser() clerkId: string, @Body() dto: CreateWantedDto) {
    return this.wanted.create(clerkId, dto);
  }

  @Post(':id/respond')
  @UseGuards(ClerkGuard)
  respond(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() dto: RespondWantedDto,
  ) {
    return this.wanted.respond(clerkId, id, dto);
  }

  @Post(':id/close')
  @UseGuards(ClerkGuard)
  close(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.wanted.close(clerkId, id);
  }
}
