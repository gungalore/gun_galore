import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseFilePipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedPreferencesDto } from './dto/feed-preferences.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { FeedSearchDto } from './dto/feed-search.dto';
import { ReportContentDto } from './dto/report-content.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { FEED_MAX_VIDEO_BYTES } from './feed.types';
import { FeedService } from './feed.service';

/**
 * Member-facing community API. Every method is session-guarded: the public
 * join gate is a FRONTEND concern (a server-side auth check that renders the
 * gate), so the API itself is members-only and leaks nothing signed-out.
 */
@Controller('community')
@UseGuards(AuthGuard)
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  // ── Reads ────────────────────────────────────────────────────────

  @Get('feed')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  list(@CurrentUser() userId: string, @Query() q: FeedQueryDto) {
    return this.feed.listFeed(userId, q);
  }

  // The member's own control centre (every post, any status). Declared before
  // the generic `posts/:id` route purely for readability; the paths don't clash.
  @Get('me/posts')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  myPosts(@CurrentUser() userId: string, @Query() q: FeedQueryDto) {
    return this.feed.listMyPosts(userId, q);
  }

  @Get('me/summary')
  mySummary(@CurrentUser() userId: string) {
    return this.feed.mySummary(userId);
  }

  @Get('search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  search(@CurrentUser() userId: string, @Query() q: FeedSearchDto) {
    return this.feed.searchFeed(userId, q);
  }

  @Get('preferences')
  preferences(@CurrentUser() userId: string) {
    return this.feed.getPreferences(userId);
  }

  @Get('config')
  config(@CurrentUser() userId: string) {
    return this.feed.getConfig(userId);
  }

  @Get('groups')
  groups(@CurrentUser() userId: string) {
    return this.feed.listGroups(userId);
  }

  @Get('groups/:slug')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  group(
    @CurrentUser() userId: string,
    @Param('slug') slug: string,
    @Query() q: FeedQueryDto,
  ) {
    return this.feed.getGroup(userId, slug, q);
  }

  @Post('groups/:id/join')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  joinGroup(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.joinGroup(userId, id);
  }

  @Delete('groups/:id/join')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  leaveGroup(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.leaveGroup(userId, id);
  }

  @Get('leaderboard')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  leaderboard() {
    return this.feed.getLeaderboard();
  }

  @Post('ads/:id/click')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  adClick(@Param('id') id: string) {
    return this.feed.recordAdClick(id);
  }

  // Seller features one of their own listings in the feed.
  @Get('listings/:id/feature')
  featureStatus(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.featureStatus(userId, id);
  }

  @Post('listings/:id/feature')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  featureListing(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.featureListing(userId, id);
  }

  @Delete('listings/:id/feature')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  unfeatureListing(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.unfeatureListing(userId, id);
  }

  @Get('users/:username')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  profile(@CurrentUser() userId: string, @Param('username') username: string) {
    return this.feed.getProfile(userId, username);
  }

  @Get('posts/:id')
  post(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.getPost(userId, id);
  }

  // ── Writes ───────────────────────────────────────────────────────

  @Post('posts')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createPost(@CurrentUser() userId: string, @Body() dto: CreatePostDto) {
    return this.feed.createPost(userId, dto);
  }

  @Post('posts/:id/submit')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  submitPost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.submitPost(userId, id);
  }

  @Patch('posts/:id')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updatePost(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.feed.updatePost(userId, id, dto);
  }

  @Delete('posts/:id')
  deletePost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.deletePost(userId, id);
  }

  @Post('posts/:id/images')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  uploadImage(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.feed.uploadImage(userId, id, file);
  }

  @Delete('posts/:id/images/:imageId')
  removeImage(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.feed.removeImage(userId, id, imageId);
  }

  @Post('posts/:id/video')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('video', { storage: memoryStorage() }))
  uploadVideo(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: FEED_MAX_VIDEO_BYTES }),
          new FileTypeValidator({ fileType: /video\/(mp4|quicktime|webm)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.feed.uploadVideo(userId, id, file);
  }

  @Delete('posts/:id/video')
  removeVideo(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.removeVideo(userId, id);
  }

  @Post('posts/:id/comments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  addComment(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.feed.addComment(userId, id, dto.body, dto.parentId);
  }

  @Post('posts/:id/like')
  likePost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.likePost(userId, id);
  }

  @Delete('posts/:id/like')
  unlikePost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.unlikePost(userId, id);
  }

  @Post('comments/:id/like')
  likeComment(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.likeComment(userId, id);
  }

  @Delete('comments/:id/like')
  unlikeComment(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.unlikeComment(userId, id);
  }

  @Post('users/:id/follow')
  follow(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.follow(userId, id);
  }

  @Delete('users/:id/follow')
  unfollow(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.unfollow(userId, id);
  }

  @Put('preferences')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  setPreferences(
    @CurrentUser() userId: string,
    @Body() dto: FeedPreferencesDto,
  ) {
    return this.feed.setPreferences(userId, dto);
  }

  @Post('posts/:id/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reportPost(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: ReportContentDto,
  ) {
    return this.feed.reportPost(userId, id, dto.reason, dto.note);
  }

  @Post('posts/:id/dispute')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  disputePost(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: ReportContentDto,
  ) {
    return this.feed.disputePost(userId, id, dto.note);
  }

  @Post('comments/:id/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  reportComment(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: ReportContentDto,
  ) {
    return this.feed.reportComment(userId, id, dto.reason, dto.note);
  }
}
