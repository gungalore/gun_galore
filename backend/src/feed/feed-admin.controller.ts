import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PostStatus } from '@prisma/client';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { CreateFeedAdDto } from './dto/create-feed-ad.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateFeedAdDto } from './dto/update-feed-ad.dto';
import { FeedAdsService } from './feed-ads.service';
import { FeedService } from './feed.service';

@Controller('admin/community')
@UseGuards(AdminJwtGuard)
export class FeedAdminController {
  constructor(
    private readonly feed: FeedService,
    private readonly ads: FeedAdsService,
  ) {}

  @Get('queue')
  queue(@Query('status') status?: string) {
    const parsed =
      status && (Object.values(PostStatus) as string[]).includes(status)
        ? (status as PostStatus)
        : PostStatus.PENDING_MODERATION;
    return this.feed.adminQueue(parsed);
  }

  @Get('reported')
  reported() {
    return this.feed.adminReported();
  }

  @Get('disputed')
  disputed() {
    return this.feed.adminDisputed();
  }

  @Post('posts/:id/review')
  review(
    @Param('id') id: string,
    @Body() body: { action: 'APPROVE' | 'REJECT'; reason?: string },
  ) {
    return this.feed.adminReview(id, body?.action ?? 'APPROVE', body?.reason);
  }

  @Post('groups')
  createGroup(@Body() dto: CreateGroupDto) {
    return this.feed.adminCreateGroup(dto);
  }

  // ── Featured ads ─────────────────────────────────────────────────

  @Get('ads')
  listAds() {
    return this.ads.adminList();
  }

  @Post('ads')
  createAd(@Body() dto: CreateFeedAdDto) {
    return this.ads.adminCreate(dto);
  }

  @Patch('ads/:id')
  updateAd(@Param('id') id: string, @Body() dto: UpdateFeedAdDto) {
    return this.ads.adminUpdate(id, dto);
  }

  @Delete('ads/:id')
  deleteAd(@Param('id') id: string) {
    return this.ads.adminRemove(id);
  }
}
