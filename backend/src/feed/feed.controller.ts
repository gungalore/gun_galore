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
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { ReactionKind } from '@prisma/client';
import { Response } from 'express';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { ContentAccessGuard } from '../auth/content-access.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedPreferencesDto } from './dto/feed-preferences.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { FeedSearchDto } from './dto/feed-search.dto';
import { ReportContentDto } from './dto/report-content.dto';
import { SetRouteGpxSharedDto } from './dto/set-route-gpx-shared.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { FEED_MAX_ROUTE_BYTES, FEED_MAX_VIDEO_BYTES } from './feed.types';
import { FeedService } from './feed.service';

/**
 * Community API. READS are content: a declared 18+ visitor sees the same
 * published posts as a member (`OptionalAuthGuard` + `ContentAccessGuard`, the
 * same pair every content controller mounts). WRITES and private data — the
 * member's own posts, preferences, follows, reports, reactions, feature
 * toggles — are session-guarded individually, because a declaration is NOT a
 * session and must never be treated as one.
 *
 * ⚠️ A read method here must carry OptionalAuthGuard, and a write method must
 * carry AuthGuard. Dropping the AuthGuard from a write would let a signed-out
 * visitor like, comment or post.
 */
@Controller('community')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  // ── Reads ────────────────────────────────────────────────────────

  @Get('feed')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  list(@CurrentUser() userId: string | undefined, @Query() q: FeedQueryDto) {
    return this.feed.listFeed(userId, q);
  }

  // The member's own control centre (every post, any status). Declared before
  // the generic `posts/:id` route purely for readability; the paths don't clash.
  @Get('me/posts')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  myPosts(@CurrentUser() userId: string, @Query() q: FeedQueryDto) {
    return this.feed.listMyPosts(userId, q);
  }

  @Get('me/summary')
  @UseGuards(AuthGuard)
  mySummary(@CurrentUser() userId: string) {
    return this.feed.mySummary(userId);
  }

  // The member's own follower/following lists, newest first, cursor-paged.
  @Get('me/followers')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  myFollowers(@CurrentUser() userId: string, @Query('before') before?: string) {
    return this.feed.listFollowers(userId, before);
  }

  @Get('me/following')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  myFollowing(@CurrentUser() userId: string, @Query('before') before?: string) {
    return this.feed.listFollowing(userId, before);
  }

  @Get('search')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  search(@CurrentUser() userId: string | undefined, @Query() q: FeedSearchDto) {
    return this.feed.searchFeed(userId, q);
  }

  // Like/comment counts for a comma-separated set of post ids, polled by the
  // feed so other members' likes/comments appear without a full refresh.
  @Get('counts')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  counts(@CurrentUser() userId: string | undefined, @Query('ids') ids?: string) {
    return this.feed.postCounts(userId, (ids ?? '').split(','));
  }

  @Get('preferences')
  @UseGuards(AuthGuard)
  preferences(@CurrentUser() userId: string) {
    return this.feed.getPreferences(userId);
  }

  @Get('config')
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  config(@CurrentUser() userId: string | undefined) {
    return this.feed.getConfig(userId);
  }

  @Get('leaderboard')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  leaderboard() {
    return this.feed.getLeaderboard();
  }

  // A click-through is a visitor action, not a member one: ads are served on
  // the guest feed too, and the click only increments a counter.
  @Post('ads/:id/click')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  adClick(@Param('id') id: string) {
    return this.feed.recordAdClick(id);
  }

  // Seller features one of their own listings in the feed.
  @Get('listings/:id/feature')
  @UseGuards(AuthGuard)
  featureStatus(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.featureStatus(userId, id);
  }

  @Post('listings/:id/feature')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  featureListing(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.featureListing(userId, id);
  }

  @Delete('listings/:id/feature')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  unfeatureListing(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.unfeatureListing(userId, id);
  }

  @Get('users/:username')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  profile(
    @CurrentUser() userId: string | undefined,
    @Param('username') username: string,
  ) {
    return this.feed.getProfile(userId, username);
  }

  @Get('posts/:id')
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  post(@CurrentUser() userId: string | undefined, @Param('id') id: string) {
    return this.feed.getPost(userId, id);
  }

  // Full GPX route points. Summary-only on the feed; this is the route page.
  @Get('posts/:id/route')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  route(@CurrentUser() userId: string | undefined, @Param('id') id: string) {
    return this.feed.getRoute(userId, id);
  }

  // The regenerated, metadata-free .gpx. 403 when the author disabled sharing.
  @Get('posts/:id/route.gpx')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  async routeGpx(
    @CurrentUser() userId: string | undefined,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { body, filename } = await this.feed.downloadRouteGpx(userId, id);
    res.set({
      'Content-Type': 'application/gpx+xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      // A member's route is personal data; never put it in a shared cache.
      'Cache-Control': 'private, no-store',
    });
    return body;
  }

  // Who liked (or disliked) a post. A content read: any declared visitor (or
  // member) may see it — username + privacy-gated avatar only (operator
  // 2026-10-10). `kind` selects the reaction; default LIKE.
  @Get('posts/:id/likes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  postLikes(
    @CurrentUser() userId: string | undefined,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('kind') kind?: string,
  ) {
    return this.feed.listPostLikes(
      userId,
      id,
      before,
      kind === 'dislike' ? ReactionKind.DISLIKE : ReactionKind.LIKE,
    );
  }

  @Get('posts/:id/dislikes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  postDislikes(
    @CurrentUser() userId: string | undefined,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.feed.listPostLikes(userId, id, before, ReactionKind.DISLIKE);
  }

  // Who liked (or disliked) a comment.
  @Get('comments/:id/likes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  commentLikes(
    @CurrentUser() userId: string | undefined,
    @Param('id') id: string,
    @Query('before') before?: string,
    @Query('kind') kind?: string,
  ) {
    return this.feed.listCommentLikes(
      userId,
      id,
      before,
      kind === 'dislike' ? ReactionKind.DISLIKE : ReactionKind.LIKE,
    );
  }

  @Get('comments/:id/dislikes')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(OptionalAuthGuard, ContentAccessGuard)
  commentDislikes(
    @CurrentUser() userId: string | undefined,
    @Param('id') id: string,
    @Query('before') before?: string,
  ) {
    return this.feed.listCommentLikes(
      userId,
      id,
      before,
      ReactionKind.DISLIKE,
    );
  }

  // ── Writes ───────────────────────────────────────────────────────

  @Post('posts')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  createPost(@CurrentUser() userId: string, @Body() dto: CreatePostDto) {
    return this.feed.createPost(userId, dto);
  }

  @Post('posts/:id/submit')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  submitPost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.submitPost(userId, id);
  }

  @Patch('posts/:id')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  updatePost(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    return this.feed.updatePost(userId, id, dto);
  }

  @Delete('posts/:id')
  @UseGuards(AuthGuard)
  deletePost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.deletePost(userId, id);
  }

  @Post('posts/:id/images')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  removeImage(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('imageId') imageId: string,
  ) {
    return this.feed.removeImage(userId, id, imageId);
  }

  @Post('posts/:id/video')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard)
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
  @UseGuards(AuthGuard)
  removeVideo(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.removeVideo(userId, id);
  }

  // ── GPX route (Hiking and the other route-capable types) ──────────

  @Post('posts/:id/route')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('route', { storage: memoryStorage() }))
  uploadRoute(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          // ⚠️ SIZE ONLY — the MIME type is NOT trusted. Browsers and phones
          // routinely mislabel .gpx uploads; the parser validates the content
          // itself, so no FileTypeValidator is used here.
          new MaxFileSizeValidator({ maxSize: FEED_MAX_ROUTE_BYTES }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() body: { gpxShared?: string },
  ) {
    // Multipart fields arrive as strings; only the literal "false" opts out.
    return this.feed.uploadRoute(userId, id, file, body?.gpxShared !== 'false');
  }

  @Patch('posts/:id/route')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  setRouteGpxShared(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: SetRouteGpxSharedDto,
  ) {
    return this.feed.setRouteGpxShared(userId, id, dto.gpxShared);
  }

  @Delete('posts/:id/route')
  @UseGuards(AuthGuard)
  removeRoute(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.removeRoute(userId, id);
  }

  @Post('posts/:id/comments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  addComment(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.feed.addComment(userId, id, dto.body, dto.parentId);
  }

  @Post('posts/:id/like')
  @UseGuards(AuthGuard)
  likePost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.likePost(userId, id);
  }

  @Delete('posts/:id/like')
  @UseGuards(AuthGuard)
  unlikePost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.unlikePost(userId, id);
  }

  @Post('posts/:id/dislike')
  @UseGuards(AuthGuard)
  dislikePost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.dislikePost(userId, id);
  }

  @Delete('posts/:id/dislike')
  @UseGuards(AuthGuard)
  undislikePost(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.undislikePost(userId, id);
  }

  @Post('comments/:id/like')
  @UseGuards(AuthGuard)
  likeComment(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.likeComment(userId, id);
  }

  @Delete('comments/:id/like')
  @UseGuards(AuthGuard)
  unlikeComment(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.unlikeComment(userId, id);
  }

  @Post('comments/:id/dislike')
  @UseGuards(AuthGuard)
  dislikeComment(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.dislikeComment(userId, id);
  }

  @Delete('comments/:id/dislike')
  @UseGuards(AuthGuard)
  undislikeComment(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.undislikeComment(userId, id);
  }

  @Post('users/:id/follow')
  @UseGuards(AuthGuard)
  follow(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.follow(userId, id);
  }

  @Delete('users/:id/follow')
  @UseGuards(AuthGuard)
  unfollow(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.unfollow(userId, id);
  }

  // Remove someone from the member's own followers (`:id` is the follower).
  @Delete('me/followers/:id')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  removeFollower(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.feed.removeFollower(userId, id);
  }

  @Put('preferences')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  setPreferences(
    @CurrentUser() userId: string,
    @Body() dto: FeedPreferencesDto,
  ) {
    return this.feed.setPreferences(userId, dto);
  }

  @Post('posts/:id/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  reportPost(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: ReportContentDto,
  ) {
    return this.feed.reportPost(userId, id, dto.reason, dto.note);
  }

  @Post('posts/:id/dispute')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  disputePost(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: ReportContentDto,
  ) {
    return this.feed.disputePost(userId, id, dto.note);
  }

  @Post('comments/:id/report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(AuthGuard)
  reportComment(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: ReportContentDto,
  ) {
    return this.feed.reportComment(userId, id, dto.reason, dto.note);
  }
}
