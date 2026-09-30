import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  FeedAwardReason,
  GraphicTier,
  Post,
  PostImage,
  PostStatus,
  PostType,
  Prisma,
} from '@prisma/client';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { optimizedVideoUrl } from '../common/image-url';
import { ContactDetailFilterService } from '../moderation/contact-detail-filter.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService, FLAGS } from '../settings/settings.service';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedPreferencesDto } from './dto/feed-preferences.dto';
import { FeedQueryDto } from './dto/feed-query.dto';
import { FeedSearchDto } from './dto/feed-search.dto';
import { UpdatePostDto } from './dto/update-post.dto';
import { FeedModerationService } from './feed-moderation.service';
import { FeedAwardsService, levelFor } from './feed-awards.service';
import { FeedAdsService } from './feed-ads.service';
import {
  authorName,
  FEED_MAX_IMAGES,
  FEED_PAGE_DEFAULT,
  FEED_PAGE_MAX,
  isOfficialEmail,
  looksLikeSerial,
  normaliseMuteList,
  normaliseTags,
  sanitisePostDetails,
  PUBLIC_AUTHOR_SELECT,
  POST_TYPE_LABELS,
  POST_TYPES,
  PublicAuthor,
} from './feed.types';

interface ViewerRow {
  id: string;
  email: string;
  isBanned: boolean;
  accountClosedAt: Date | null;
  feedMutedPostTypes: string[];
  feedMutedAuthorIds: string[];
  feedMutedTags: string[];
  feedShowAvatar: boolean;
  avatarUrl: string | null;
  username: string;
}

type PostWithRelations = Post & {
  author: PublicAuthor;
  images: PostImage[];
  video: {
    id: string;
    url: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
  } | null;
  listing: {
    id: string;
    title: string;
    price: number | null;
    listingType: string;
    status: string;
  } | null;
  likes: { id: string }[];
};

@Injectable()
export class FeedService {
  private readonly logger = new Logger(FeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
    private readonly contactFilter: ContactDetailFilterService,
    private readonly moderation: FeedModerationService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly awards: FeedAwardsService,
    private readonly ads: FeedAdsService,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // Guards / helpers
  // ─────────────────────────────────────────────────────────────────

  /** Every feed route is inert while the flag is off (dark deploy). */
  private async assertEnabled(): Promise<void> {
    const enabled = await this.settings.get(FLAGS.feedEnabled);
    if (!enabled) throw new NotFoundException();
  }

  private async viewer(userId: string): Promise<ViewerRow> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        isBanned: true,
        accountClosedAt: true,
        feedMutedPostTypes: true,
        feedMutedAuthorIds: true,
        feedMutedTags: true,
        feedShowAvatar: true,
        avatarUrl: true,
        username: true,
      },
    });
    if (!u) throw new NotFoundException();
    return u as ViewerRow;
  }

  private postInclude(userId: string) {
    return {
      author: { select: PUBLIC_AUTHOR_SELECT },
      images: { orderBy: { order: 'asc' as const } },
      listing: {
        select: {
          id: true,
          title: true,
          price: true,
          listingType: true,
          status: true,
        },
      },
      likes: { where: { userId }, select: { id: true } },
      video: {
        select: {
          id: true,
          url: true,
          thumbnailUrl: true,
          durationSeconds: true,
        },
      },
    };
  }

  /** Exclude content the viewer has muted. Feed + search only, never the shop. */
  private filterWhere(
    v: ViewerRow,
    includeFiltered: boolean,
  ): Prisma.PostWhereInput {
    if (includeFiltered) return {};
    const conditions: Prisma.PostWhereInput[] = [];
    if (v.feedMutedPostTypes.length) {
      conditions.push({ type: { in: v.feedMutedPostTypes as PostType[] } });
    }
    if (v.feedMutedAuthorIds.length) {
      conditions.push({ authorId: { in: v.feedMutedAuthorIds } });
    }
    if (v.feedMutedTags.length) {
      conditions.push({ tags: { hasSome: v.feedMutedTags } });
    }
    if (!conditions.length) return {};
    // Prisma's NOT array is NOT(a) AND NOT(b) — exactly "exclude any match".
    return { NOT: conditions };
  }

  /** Filter on the optional per-category detail fields (feed + search). */
  private detailWhere(q: FeedQueryDto): Prisma.PostWhereInput {
    const conditions: Prisma.PostWhereInput[] = [];
    const species = (q.species ?? [])
      .map((s) => s.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter(Boolean);
    if (species.length) conditions.push({ species: { hasSome: species } });
    if (q.calibre?.trim()) {
      conditions.push({ calibre: { equals: q.calibre.trim(), mode: 'insensitive' } });
    }
    if (q.minRating) conditions.push({ gearRating: { gte: q.minRating } });
    return conditions.length ? { AND: conditions } : {};
  }

  private isMuted(post: Post, v: ViewerRow): boolean {
    return (
      v.feedMutedPostTypes.includes(post.type) ||
      v.feedMutedAuthorIds.includes(post.authorId) ||
      post.tags.some((t) => v.feedMutedTags.includes(t))
    );
  }

  private shapePost(post: PostWithRelations, v: ViewerRow, includeFiltered: boolean) {
    const inFlight =
      post.status === PostStatus.PENDING_MODERATION && !post.moderatedAt;
    const inReview =
      post.status === PostStatus.PENDING_MODERATION && !!post.moderatedAt;
    const blocked = post.status === PostStatus.REJECTED;
    return {
      id: post.id,
      type: post.type,
      title: post.title,
      body: post.body,
      tags: post.tags,
      location: post.location,
      locationPlaceId: post.locationPlaceId,
      // Optional per-category details (see feed.types.ts). Always present so
      // the client has a stable shape; null/empty when the author set none.
      flair: post.flair ?? [],
      species: post.species ?? [],
      occurredAt: post.occurredAt,
      calibre: post.calibre,
      firearmType: post.firearmType,
      firearmModel: post.firearmModel,
      bulletWeightGr: post.bulletWeightGr,
      powderChargeGr: post.powderChargeGr,
      testResult: post.testResult,
      waterType: post.waterType,
      sizeCm: post.sizeCm,
      shotDistanceM: post.shotDistanceM,
      siteType: post.siteType,
      tripDays: post.tripDays,
      gearCategory: post.gearCategory,
      gearRating: post.gearRating,
      gearCondition: post.gearCondition,
      context: post.context,
      graphicTier: post.graphicTier,
      isOfficial: post.isOfficial,
      likeCount: post.likeCount,
      commentCount: post.commentCount,
      createdAt: post.createdAt,
      editedAt: post.editedAt,
      // Viewer-facing moderation state. Only ever surfaced on the author's own
      // posts (others are filtered out before shaping).
      moderationState: blocked
        ? 'BLOCKED'
        : inFlight
          ? 'PROCESSING'
          : inReview
            ? 'IN_REVIEW'
            : 'PUBLISHED',
      moderationReason: post.moderationReason,
      canDispute: blocked && !post.disputedAt,
      disputed: !!post.disputedAt,
      author: {
        id: post.authorId,
        username: authorName(post.author),
        // Withheld when the member turned their profile picture off (default
        // is on). The UI falls back to the username initial.
        avatarUrl:
          post.author?.feedShowAvatar === false
            ? null
            : (post.author?.avatarUrl ?? null),
        sellerTier: post.author?.sellerTier ?? null,
        isVerifiedExpert: post.author?.isVerifiedExpert ?? false,
      },
      images: post.images.map((i) => ({ id: i.id, url: i.url, order: i.order })),
      video: post.video
        ? {
            ...post.video,
            // Compressed delivery for playback (audio kept); the original stays
            // in Cloudinary.
            playbackUrl: optimizedVideoUrl(post.video.url, 720),
          }
        : null,
      listing: post.listing,
      liked: post.likes.length > 0,
      ...(includeFiltered ? { muted: this.isMuted(post, v) } : {}),
    };
  }

  // ─────────────────────────────────────────────────────────────────
  // Reads
  // ─────────────────────────────────────────────────────────────────

  async listFeed(userId: string, q: FeedQueryDto) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    const limit = Math.min(q.limit ?? FEED_PAGE_DEFAULT, FEED_PAGE_MAX);
    const posts = (await this.prisma.post.findMany({
      where: {
        ...(q.type ? { type: q.type } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
        ...this.filterWhere(v, !!q.includeFiltered),
        ...this.detailWhere(q),
        // Published posts for everyone, plus the viewer's OWN posts still in
        // moderation or rejected so the author sees "Processing"/"Blocked".
        OR: [
          { status: PostStatus.PUBLISHED },
          {
            authorId: userId,
            status: {
              in: [PostStatus.PENDING_MODERATION, PostStatus.REJECTED],
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: this.postInclude(userId),
    })) as PostWithRelations[];

    return {
      posts: posts.map((p) => this.shapePost(p, v, !!q.includeFiltered)),
      nextBefore:
        posts.length === limit && posts.length > 0
          ? posts[posts.length - 1].createdAt.toISOString()
          : null,
      includeFiltered: !!q.includeFiltered,
      // Featured ads ride the FIRST page only (they are a placement, not a
      // paginated resource). Empty on "load more" and when the flag is off.
      ads: q.before ? [] : await this.ads.activeAds(3),
    };
  }

  /**
   * The member's own control centre: EVERY post they authored, whatever its
   * status, newest first. Deliberately NOT filtered by their own mute list —
   * you must be able to manage what you muted. Same cursor contract as the feed.
   */
  async listMyPosts(userId: string, q: FeedQueryDto) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    const limit = Math.min(q.limit ?? FEED_PAGE_DEFAULT, FEED_PAGE_MAX);
    const posts = (await this.prisma.post.findMany({
      where: {
        authorId: userId,
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: this.postInclude(userId),
    })) as PostWithRelations[];

    return {
      posts: posts.map((p) => this.shapePost(p, v, false)),
      nextBefore:
        posts.length === limit && posts.length > 0
          ? posts[posts.length - 1].createdAt.toISOString()
          : null,
    };
  }

  /** Lightweight numbers for the control panel's header + stat row. */
  async mySummary(userId: string) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    const [social, followerCount, followingCount, pendingCount] =
      await Promise.all([
        this.prisma.userSocialStats.findUnique({
          where: { userId },
          select: { points: true, postCount: true, commentCount: true },
        }),
        this.prisma.follow.count({ where: { followingId: userId } }),
        this.prisma.follow.count({ where: { followerId: userId } }),
        // Anything not live yet (processing / in review / blocked) — the panel
        // nudges the author to look when this is non-zero.
        this.prisma.post.count({
          where: { authorId: userId, status: { not: PostStatus.PUBLISHED } },
        }),
      ]);
    const points = social?.points ?? 0;
    return {
      username: v.username,
      // Own picture, withheld only if the member turned it off themselves.
      avatarUrl: v.feedShowAvatar ? v.avatarUrl : null,
      postCount: social?.postCount ?? 0,
      commentCount: social?.commentCount ?? 0,
      followerCount,
      followingCount,
      points,
      level: levelFor(points).name,
      pendingCount,
    };
  }

  async searchFeed(userId: string, q: FeedSearchDto) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    const limit = Math.min(q.limit ?? FEED_PAGE_DEFAULT, FEED_PAGE_MAX);
    const needle = q.q.trim();
    const lowerNeedle = needle.toLowerCase();
    const tagNeedles = Array.from(
      new Set([
        lowerNeedle,
        lowerNeedle.replace(/^#+/, '').replace(/\s+/g, '-'),
      ]),
    );
    const matchingTypes = POST_TYPES.filter(
      (type) =>
        type.toLowerCase().includes(lowerNeedle) ||
        POST_TYPE_LABELS[type].toLowerCase().includes(lowerNeedle),
    );
    const posts = (await this.prisma.post.findMany({
      where: {
        status: PostStatus.PUBLISHED,
        ...(q.type ? { type: q.type } : {}),
        ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
        ...this.filterWhere(v, !!q.includeFiltered),
        ...this.detailWhere(q),
        OR: [
          { title: { contains: needle, mode: 'insensitive' } },
          { body: { contains: needle, mode: 'insensitive' } },
          { tags: { hasSome: tagNeedles } },
          { species: { hasSome: tagNeedles } },
          { flair: { hasSome: tagNeedles } },
          { calibre: { contains: needle, mode: 'insensitive' } },
          { author: { username: { contains: needle, mode: 'insensitive' } } },
          { category: { name: { contains: needle, mode: 'insensitive' } } },
          { location: { contains: needle, mode: 'insensitive' } },
          { listing: { title: { contains: needle, mode: 'insensitive' } } },
          ...(matchingTypes.length ? [{ type: { in: matchingTypes } }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: this.postInclude(userId),
    })) as PostWithRelations[];

    return {
      posts: posts.map((p) => this.shapePost(p, v, !!q.includeFiltered)),
      nextBefore:
        posts.length === limit && posts.length > 0
          ? posts[posts.length - 1].createdAt.toISOString()
          : null,
      includeFiltered: !!q.includeFiltered,
    };
  }

  async getPost(userId: string, postId: string) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    const post = (await this.prisma.post.findUnique({
      where: { id: postId },
      include: this.postInclude(userId),
    })) as PostWithRelations | null;
    // 404, never 403 — do not confirm the existence of a non-published post.
    // The author may always see their own (to watch processing / dispute).
    if (!post || (post.status !== PostStatus.PUBLISHED && post.authorId !== userId)) {
      throw new NotFoundException();
    }
    const comments = await this.listComments(postId, userId);
    return { post: this.shapePost(post, v, false), comments };
  }

  private async listComments(postId: string, userId: string) {
    const comments = await this.prisma.comment.findMany({
      where: { postId, status: PostStatus.PUBLISHED },
      orderBy: { createdAt: 'asc' },
      take: 500,
      include: {
        author: { select: PUBLIC_AUTHOR_SELECT },
        likes: { where: { userId }, select: { id: true } },
      },
    });
    return comments.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      body: c.body,
      likeCount: c.likeCount,
      createdAt: c.createdAt,
      liked: c.likes.length > 0,
      author: {
        id: c.authorId,
        username: authorName(c.author),
        avatarUrl: c.author?.avatarUrl ?? null,
      },
    }));
  }

  async getProfile(userId: string, username: string) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    const profile = await this.prisma.user.findUnique({
      where: { usernameLower: username.toLowerCase() },
      select: {
        id: true,
        username: true,
        avatarUrl: true,
        sellerTier: true,
        isVerifiedExpert: true,
        feedShowAvatar: true,
        createdAt: true,
      },
    });
    if (!profile) throw new NotFoundException();

    const [following, followerCount, followingCount, social] = await Promise.all([
      this.prisma.follow.findUnique({
        where: {
          followerId_followingId: { followerId: userId, followingId: profile.id },
        },
        select: { id: true },
      }),
      this.prisma.follow.count({ where: { followingId: profile.id } }),
      this.prisma.follow.count({ where: { followerId: profile.id } }),
      this.prisma.userSocialStats.findUnique({
        where: { userId: profile.id },
        select: { points: true, postCount: true, commentCount: true },
      }),
    ]);

    const posts = (await this.prisma.post.findMany({
      where: {
        authorId: profile.id,
        status: PostStatus.PUBLISHED,
        ...this.filterWhere(v, false),
      },
      orderBy: { createdAt: 'desc' },
      take: FEED_PAGE_DEFAULT,
      include: this.postInclude(userId),
    })) as PostWithRelations[];

    const socialPoints = social?.points ?? 0;
    return {
      profile: {
        id: profile.id,
        username: profile.username,
        // Withheld when the member turned their picture off (default on).
        avatarUrl: profile.feedShowAvatar ? profile.avatarUrl : null,
        sellerTier: profile.sellerTier,
        isVerifiedExpert: profile.isVerifiedExpert,
        memberSince: profile.createdAt,
      },
      isFollowing: !!following,
      followerCount,
      followingCount,
      points: socialPoints,
      level: levelFor(socialPoints).name,
      postCount: social?.postCount ?? 0,
      commentCount: social?.commentCount ?? 0,
      posts: posts.map((p) => this.shapePost(p, v, false)),
    };
  }

  async getPreferences(userId: string) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    return {
      feedMutedPostTypes: v.feedMutedPostTypes,
      feedMutedAuthorIds: v.feedMutedAuthorIds,
      feedMutedTags: v.feedMutedTags,
      feedShowAvatar: v.feedShowAvatar,
    };
  }

  /**
   * Member-facing client config. Read per request so an operator can change
   * the graphic-blur policy in Settings without a deploy.
   */
  async getConfig(userId: string) {
    await this.assertEnabled();
    await this.viewer(userId);
    return {
      graphicBlurForced: await this.settings.get(FLAGS.feedGraphicBlurForced),
      gateEnabled: await this.settings.get(FLAGS.feedGateEnabled),
      adsEnabled: await this.settings.get(FLAGS.feedAdsEnabled),
    };
  }

  async setPreferences(userId: string, dto: FeedPreferencesDto) {
    await this.assertEnabled();
    await this.viewer(userId);
    const data: Prisma.UserUpdateInput = {};
    if (dto.feedMutedPostTypes !== undefined) {
      data.feedMutedPostTypes = normaliseMuteList(dto.feedMutedPostTypes);
    }
    if (dto.feedMutedAuthorIds !== undefined) {
      data.feedMutedAuthorIds = normaliseMuteList(dto.feedMutedAuthorIds);
    }
    if (dto.feedMutedTags !== undefined) {
      data.feedMutedTags = normaliseMuteList(dto.feedMutedTags);
    }
    if (dto.feedShowAvatar !== undefined) {
      data.feedShowAvatar = dto.feedShowAvatar;
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        feedMutedPostTypes: true,
        feedMutedAuthorIds: true,
        feedMutedTags: true,
        feedShowAvatar: true,
      },
    });
    return updated;
  }

  // ─────────────────────────────────────────────────────────────────
  // Writes
  // ─────────────────────────────────────────────────────────────────

  async createPost(userId: string, dto: CreatePostDto) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    if (v.isBanned || v.accountClosedAt) {
      throw new ForbiddenException('Your account cannot post right now.');
    }

    const official = isOfficialEmail(v.email);
    const details = sanitisePostDetails(dto as unknown as Record<string, unknown>, dto.type);
    if (details.firearmModel && looksLikeSerial(details.firearmModel)) {
      throw new BadRequestException('Please leave out serial numbers — model name only.');
    }
    const text = [dto.title, dto.body].filter(Boolean).join('\n');
    await this.assertTextAllowed(text, 'feed-post', userId, official);

    const verdict = await this.moderation.moderate({
      text,
      imageUrls: [],
      authorIsOfficial: official,
      postType: dto.type,
    });

    // ⚠️ NEVER PUBLISH AT CREATE. The member may still attach photos, and those
    // must be moderated too. The post rests in PENDING_MODERATION until
    // submitPost() runs the full (text + images) verdict.
    const status =
      verdict.decision === 'REJECT'
        ? PostStatus.REJECTED
        : PostStatus.PENDING_MODERATION;

    const post = (await this.prisma.post.create({
      data: {
        authorId: userId,
        type: dto.type,
        title: dto.title?.trim() || null,
        body: dto.body,
        tags: normaliseTags(dto.tags),
        ...details,
        listingId: dto.listingId ?? null,
        categoryId: dto.categoryId ?? null,
        location: dto.location ?? null,
        locationPlaceId: dto.locationPlaceId ?? null,
        status,
        graphicTier: verdict.graphicTier,
        isOfficial: official,
        moderationReason: verdict.reasons.join('; ') || null,
      },
      include: this.postInclude(userId),
    })) as PostWithRelations;

    return {
      post: this.shapePost(post, v, false),
      moderation: {
        decision:
          status === PostStatus.REJECTED ? 'REJECTED' : 'PENDING_REVIEW',
        reasons: verdict.reasons,
      },
    };
  }

  /** Finalize a pending post once its images are attached. */
  async submitPost(userId: string, postId: string) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { images: true, video: true },
    });
    if (!post || post.authorId !== userId) throw new NotFoundException();
    if (post.status === PostStatus.REJECTED) {
      throw new BadRequestException('This post was rejected.');
    }

    // ⚠️ BACKGROUND MODERATION. Queue the post and return at once — the member
    // is told it will appear on their feed automatically. runModeration() does
    // the work; a cron sweep re-picks anything stranded by a restart.
    await this.prisma.post.update({
      where: { id: postId },
      data: {
        status: PostStatus.PENDING_MODERATION,
        moderatedAt: null,
        publishedAt: null,
      },
    });
    void this.runModeration(postId).catch((e: Error) =>
      this.logger.error(`background moderation failed for ${postId}: ${e.message}`),
    );

    const fresh = (await this.prisma.post.findUnique({
      where: { id: postId },
      include: this.postInclude(userId),
    })) as PostWithRelations;

    return {
      post: this.shapePost(fresh, v, false),
      moderation: { decision: 'PROCESSING', reasons: [] as string[] },
    };
  }

  /**
   * The moderation pass itself. Idempotent: it skips a post already ruled on
   * (`moderatedAt` set), awards points only on a genuine new publish, and
   * notifies the author only on a real transition. Called fire-and-forget from
   * submitPost and from the sweep cron in TasksService.
   */
  async runModeration(postId: string): Promise<void> {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { images: true, video: true },
    });
    if (!post) return;
    if (post.moderatedAt) return;

    const text = [post.title, post.body].filter(Boolean).join('\n');
    const verdict = await this.moderation.moderate({
      text,
      imageUrls: post.images.map((i) => i.url),
      video: post.video
        ? { url: post.video.url, thumbnailUrl: post.video.thumbnailUrl }
        : null,
      authorIsOfficial: post.isOfficial,
      postType: post.type,
    });

    const status =
      verdict.decision === 'PUBLISH'
        ? PostStatus.PUBLISHED
        : verdict.decision === 'REJECT'
          ? PostStatus.REJECTED
          : PostStatus.PENDING_MODERATION;
    const becamePublished = status === PostStatus.PUBLISHED && !post.publishedAt;

    await this.prisma.post.update({
      where: { id: postId },
      data: {
        status,
        graphicTier: verdict.graphicTier,
        moderationReason: verdict.reasons.join('; ') || null,
        moderatedAt: new Date(),
        publishedAt: becamePublished ? new Date() : post.publishedAt,
      },
    });

    if (becamePublished) {
      await this.bumpSocial(post.authorId, { postCount: 1 });
      await this.awards.award(post.authorId, FeedAwardReason.POST, postId);
      await this.notifications.postPublished({
        recipientId: post.authorId,
        postId,
        title: post.title ?? undefined,
      });
    } else if (status === PostStatus.REJECTED) {
      await this.notifications.postRejected({
        recipientId: post.authorId,
        postId,
        reason: verdict.reasons.join('; ') || undefined,
      });
    }
  }

  async updatePost(userId: string, postId: string, dto: UpdatePostDto) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.authorId !== userId) throw new NotFoundException();

    const details = sanitisePostDetails(dto as unknown as Record<string, unknown>, post.type);
    if (details.firearmModel && looksLikeSerial(details.firearmModel)) {
      throw new BadRequestException('Please leave out serial numbers — model name only.');
    }

    const title = dto.title !== undefined ? dto.title.trim() || null : post.title;
    const body = dto.body ?? post.body;
    const text = [title, body].filter(Boolean).join('\n');
    // The hard keyword block stays synchronous — it is cheap and the UI shows
    // the 400 inline. The judgement call (is this still allowed?) is queued.
    await this.assertTextAllowed(text, 'feed-post-edit', userId, post.isOfficial);

    // ⚠️ BACKGROUND RE-MODERATION, same contract as submitPost. An edit can
    // change what a post means, so it is re-reviewed before it is trusted
    // again. Until the verdict lands the post is hidden from everyone but its
    // author (fail-closed) and the author sees "Processing".
    await this.prisma.post.update({
      where: { id: postId },
      data: {
        title,
        body,
        ...(dto.tags !== undefined ? { tags: normaliseTags(dto.tags) } : {}),
        ...details,
        status: PostStatus.PENDING_MODERATION,
        moderatedAt: null,
        editedAt: new Date(),
      },
    });
    void this.runModeration(postId).catch((e: Error) =>
      this.logger.error(
        `background re-moderation failed for ${postId}: ${e.message}`,
      ),
    );

    const fresh = (await this.prisma.post.findUnique({
      where: { id: postId },
      include: this.postInclude(userId),
    })) as PostWithRelations;

    return { post: this.shapePost(fresh, v, false) };
  }

  async deletePost(userId: string, postId: string) {
    await this.assertEnabled();
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { images: true, video: true },
    });
    if (!post || post.authorId !== userId) throw new NotFoundException();
    await this.cloudinary.deleteImages(post.images.map((i) => i.publicId));
    if (post.video) await this.cloudinary.deleteVideo(post.video.publicId);
    await this.prisma.post.delete({ where: { id: postId } });
    return { deleted: true };
  }

  async uploadImage(userId: string, postId: string, file: Express.Multer.File) {
    await this.assertEnabled();
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { images: true },
    });
    if (!post || post.authorId !== userId) throw new NotFoundException();
    if (post.status === PostStatus.REJECTED) {
      throw new BadRequestException('This post was rejected.');
    }
    if (post.images.length >= FEED_MAX_IMAGES) {
      throw new BadRequestException(
        `A post can carry at most ${FEED_MAX_IMAGES} photos.`,
      );
    }
    const { url, publicId } = await this.cloudinary.uploadImage(
      file.buffer,
      'feed',
    );
    const image = await this.prisma.postImage.create({
      data: {
        postId,
        url,
        publicId,
        order: post.images.length,
        isPrimary: post.images.length === 0,
      },
    });
    return { image: { id: image.id, url: image.url, order: image.order } };
  }

  async removeImage(userId: string, postId: string, imageId: string) {
    await this.assertEnabled();
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.authorId !== userId) throw new NotFoundException();
    const image = await this.prisma.postImage.findUnique({
      where: { id: imageId },
    });
    if (!image || image.postId !== postId) throw new NotFoundException();
    await this.cloudinary.deleteImage(image.publicId);
    await this.prisma.postImage.delete({ where: { id: imageId } });
    return { deleted: true };
  }

  /** One video per post. Re-uploading replaces the existing video. */
  async uploadVideo(userId: string, postId: string, file: Express.Multer.File) {
    await this.assertEnabled();
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { video: true },
    });
    if (!post || post.authorId !== userId) throw new NotFoundException();
    if (post.status === PostStatus.REJECTED) {
      throw new BadRequestException('This post was rejected.');
    }
    if (post.video) {
      await this.cloudinary.deleteVideo(post.video.publicId);
      await this.prisma.postVideo.delete({ where: { postId } });
    }
    const up = await this.cloudinary.uploadVideo(file.buffer, 'feed');
    const video = await this.prisma.postVideo.create({
      data: {
        postId,
        url: up.url,
        publicId: up.publicId,
        thumbnailUrl: up.thumbnailUrl,
        durationSeconds: up.durationSeconds ?? null,
        width: up.width ?? null,
        height: up.height ?? null,
      },
    });
    return {
      video: {
        id: video.id,
        url: video.url,
        thumbnailUrl: video.thumbnailUrl,
        durationSeconds: video.durationSeconds,
      },
    };
  }

  async removeVideo(userId: string, postId: string) {
    await this.assertEnabled();
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: { video: true },
    });
    if (!post || post.authorId !== userId) throw new NotFoundException();
    if (post.video) {
      await this.cloudinary.deleteVideo(post.video.publicId);
      await this.prisma.postVideo.delete({ where: { postId } });
    }
    return { deleted: true };
  }

  async addComment(
    userId: string,
    postId: string,
    body: string,
    parentId?: string,
  ) {
    await this.assertEnabled();
    const v = await this.viewer(userId);
    if (v.isBanned || v.accountClosedAt) {
      throw new ForbiddenException('Your account cannot comment right now.');
    }
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, status: true, authorId: true, title: true },
    });
    if (!post || post.status !== PostStatus.PUBLISHED) {
      throw new NotFoundException();
    }

    let parent: { id: string; authorId: string } | null = null;
    if (parentId) {
      parent = await this.prisma.comment.findUnique({
        where: { id: parentId },
        select: { id: true, authorId: true },
      });
      if (!parent) throw new NotFoundException();
    }

    const official = isOfficialEmail(v.email);
    await this.assertTextAllowed(body, 'feed-comment', userId, official);
    const verdict = await this.moderation.moderate({
      text: body,
      imageUrls: [],
      authorIsOfficial: official,
      postType: undefined,
    });
    const status =
      verdict.decision === 'PUBLISH'
        ? PostStatus.PUBLISHED
        : verdict.decision === 'REJECT'
          ? PostStatus.REJECTED
          : PostStatus.PENDING_MODERATION;

    const comment = await this.prisma.comment.create({
      data: {
        postId,
        authorId: userId,
        parentId: parentId ?? null,
        body,
        status,
        moderationReason: verdict.reasons.join('; ') || null,
      },
    });

    if (status === PostStatus.PUBLISHED) {
      await this.prisma.post.update({
        where: { id: postId },
        data: { commentCount: { increment: 1 } },
      });
      await this.bumpSocial(userId, { commentCount: 1 });
      await this.awards.award(userId, FeedAwardReason.COMMENT, comment.id);
      // Notifications: reply beats post-author, and never notify yourself.
      const recipientId = parent?.authorId ?? post.authorId;
      if (recipientId !== userId) {
        const actor = v.username;
        if (parent) {
          await this.notifications.commentReply({
            recipientId,
            actorUsername: actor,
            postId,
            commentId: comment.id,
          });
        }
      }
    }

    return {
      comment: {
        id: comment.id,
        parentId: comment.parentId,
        body: comment.body,
        likeCount: comment.likeCount,
        createdAt: comment.createdAt,
        liked: false,
        author: { id: userId, username: v.username, avatarUrl: null },
      },
      moderation: { decision: status, reasons: verdict.reasons },
    };
  }

  async likePost(userId: string, postId: string) {
    await this.assertEnabled();
    await this.viewer(userId);
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, status: true, authorId: true, title: true },
    });
    if (!post || post.status !== PostStatus.PUBLISHED) {
      throw new NotFoundException();
    }
    const existing = await this.prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (!existing) {
      await this.prisma.$transaction([
        this.prisma.postLike.create({ data: { postId, userId } }),
        this.prisma.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
        }),
      ]);
      if (post.authorId !== userId) {
        const v = await this.viewer(userId);
        await this.notifications.postLiked({
          recipientId: post.authorId,
          actorUsername: v.username,
          postId,
          postTitle: post.title ?? undefined,
        });
        await this.awards.award(
          post.authorId,
          FeedAwardReason.LIKE_RECEIVED,
          postId,
        );
      }
    }
    return { liked: true };
  }

  async unlikePost(userId: string, postId: string) {
    await this.assertEnabled();
    const existing = await this.prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.postLike.delete({ where: { id: existing.id } }),
        this.prisma.post.update({
          where: { id: postId },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);
    }
    return { liked: false };
  }

  async likeComment(userId: string, commentId: string) {
    await this.assertEnabled();
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true, status: true },
    });
    if (!comment || comment.status !== PostStatus.PUBLISHED) {
      throw new NotFoundException();
    }
    const existing = await this.prisma.commentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });
    if (!existing) {
      await this.prisma.$transaction([
        this.prisma.commentLike.create({ data: { commentId, userId } }),
        this.prisma.comment.update({
          where: { id: commentId },
          data: { likeCount: { increment: 1 } },
        }),
      ]);
    }
    return { liked: true };
  }

  async unlikeComment(userId: string, commentId: string) {
    await this.assertEnabled();
    const existing = await this.prisma.commentLike.findUnique({
      where: { commentId_userId: { commentId, userId } },
    });
    if (existing) {
      await this.prisma.$transaction([
        this.prisma.commentLike.delete({ where: { id: existing.id } }),
        this.prisma.comment.update({
          where: { id: commentId },
          data: { likeCount: { decrement: 1 } },
        }),
      ]);
    }
    return { liked: false };
  }

  async follow(userId: string, targetId: string) {
    await this.assertEnabled();
    if (userId === targetId) throw new BadRequestException('You cannot follow yourself.');
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true },
    });
    if (!target) throw new NotFoundException();
    const existing = await this.prisma.follow.findUnique({
      where: { followerId_followingId: { followerId: userId, followingId: targetId } },
    });
    if (!existing) {
      await this.prisma.follow.create({
        data: { followerId: userId, followingId: targetId },
      });
      const v = await this.viewer(userId);
      await this.notifications.newFollower({
        recipientId: targetId,
        actorUsername: v.username,
      });
    }
    return { following: true };
  }

  async unfollow(userId: string, targetId: string) {
    await this.assertEnabled();
    await this.prisma.follow.deleteMany({
      where: { followerId: userId, followingId: targetId },
    });
    return { following: false };
  }

  async reportPost(
    userId: string,
    postId: string,
    reason?: string,
    note?: string,
  ) {
    await this.assertEnabled();
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true },
    });
    if (!post) throw new NotFoundException();
    await this.prisma.post.update({
      where: { id: postId },
      data: { reportedCount: { increment: 1 } },
    });
    await this.prisma.adminAlert.create({
      data: {
        type: 'POST_REPORTED',
        referenceId: postId,
        context: JSON.stringify({
          reason: (reason ?? 'other').slice(0, 40),
          note: (note ?? '').slice(0, 500) || undefined,
          reporterId: userId,
        }),
      },
    });
    return { reported: true };
  }

  async reportComment(
    userId: string,
    commentId: string,
    reason?: string,
    note?: string,
  ) {
    await this.assertEnabled();
    const comment = await this.prisma.comment.findUnique({
      where: { id: commentId },
      select: { id: true },
    });
    if (!comment) throw new NotFoundException();
    await this.prisma.comment.update({
      where: { id: commentId },
      data: { reportedCount: { increment: 1 } },
    });
    await this.prisma.adminAlert.create({
      data: {
        type: 'COMMENT_REPORTED',
        referenceId: commentId,
        context: JSON.stringify({
          reason: (reason ?? 'other').slice(0, 40),
          note: (note ?? '').slice(0, 500) || undefined,
          reporterId: userId,
        }),
      },
    });
    return { reported: true };
  }

  // ─────────────────────────────────────────────────────────────────
  // Leaderboard
  // ─────────────────────────────────────────────────────────────────

  async getLeaderboard() {
    await this.assertEnabled();
    return this.awards.leaderboard();
  }

  async recordAdClick(id: string) {
    await this.assertEnabled();
    return this.ads.recordClick(id);
  }

  async featureStatus(userId: string, listingId: string) {
    await this.assertEnabled();
    return this.ads.featureStatus(userId, listingId);
  }

  async featureListing(userId: string, listingId: string) {
    await this.assertEnabled();
    return this.ads.featureListing(userId, listingId);
  }

  async unfeatureListing(userId: string, listingId: string) {
    await this.assertEnabled();
    return this.ads.unfeatureListing(userId, listingId);
  }

  // ─────────────────────────────────────────────────────────────────
  // Admin queue
  // ─────────────────────────────────────────────────────────────────

  async adminQueue(status: PostStatus = PostStatus.PENDING_MODERATION) {
    await this.assertEnabled();
    return this.prisma.post.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        author: { select: { id: true, username: true } },
        images: { orderBy: { order: 'asc' } },
      },
    });
  }

  async adminReported() {
    await this.assertEnabled();
    const [posts, comments] = await Promise.all([
      this.prisma.post.findMany({
        where: { reportedCount: { gt: 0 } },
        orderBy: { reportedCount: 'desc' },
        take: 100,
        include: { author: { select: { id: true, username: true } } },
      }),
      this.prisma.comment.findMany({
        where: { reportedCount: { gt: 0 } },
        orderBy: { reportedCount: 'desc' },
        take: 100,
        include: { author: { select: { id: true, username: true } } },
      }),
    ]);
    return { posts, comments };
  }

  /** Author contests a rejection. Lands in the admin queue with a 48h promise. */
  async disputePost(userId: string, postId: string, note?: string) {
    await this.assertEnabled();
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, authorId: true, status: true, disputedAt: true },
    });
    if (!post || post.authorId !== userId) throw new NotFoundException();
    if (post.status !== PostStatus.REJECTED) {
      throw new BadRequestException('Only a blocked post can be disputed.');
    }
    if (post.disputedAt) {
      throw new BadRequestException('This post has already been disputed.');
    }
    const cleanNote = (note ?? '').trim().slice(0, 1000) || null;
    await this.prisma.post.update({
      where: { id: postId },
      data: { disputedAt: new Date(), disputeNote: cleanNote },
    });
    await this.prisma.adminAlert.create({
      data: {
        type: 'POST_DISPUTED',
        referenceId: postId,
        context: JSON.stringify({ authorId: userId, note: cleanNote ?? undefined }),
      },
    });
    return {
      disputed: true,
      message:
        'Thanks — our team will review this and give you feedback within 48 hours.',
    };
  }

  async adminDisputed() {
    await this.assertEnabled();
    return this.prisma.post.findMany({
      where: { disputedAt: { not: null } },
      orderBy: { disputedAt: 'desc' },
      take: 100,
      include: {
        author: { select: { id: true, username: true } },
        images: { orderBy: { order: 'asc' } },
        video: { select: { id: true, url: true, thumbnailUrl: true } },
      },
    });
  }

  async adminReview(postId: string, action: 'APPROVE' | 'REJECT', reason?: string) {
    await this.assertEnabled();
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post) throw new NotFoundException();
    const status =
      action === 'APPROVE' ? PostStatus.PUBLISHED : PostStatus.REJECTED;
    const updated = await this.prisma.post.update({
      where: { id: postId },
      data: {
        status,
        moderationReason: reason ?? post.moderationReason,
        publishedAt:
          status === PostStatus.PUBLISHED
            ? post.publishedAt ?? new Date()
            : post.publishedAt,
      },
    });
    if (status === PostStatus.PUBLISHED && !post.publishedAt) {
      await this.bumpSocial(post.authorId, { postCount: 1 });
    }
    return updated;
  }

  // ─────────────────────────────────────────────────────────────────
  // Internals
  // ─────────────────────────────────────────────────────────────────

  private async assertTextAllowed(
    text: string,
    origin: string,
    userId: string,
    official: boolean,
  ): Promise<void> {
    // Official accounts are exempt from the promotional/contact filter only.
    if (official) return;
    const check = await this.contactFilter.check(text, origin, userId);
    if (!check.allowed) throw new BadRequestException(check.reason);
  }

  private async bumpSocial(
    userId: string,
    inc: { postCount?: number; commentCount?: number; points?: number },
  ): Promise<void> {
    try {
      await this.prisma.userSocialStats.upsert({
        where: { userId },
        create: {
          userId,
          postCount: inc.postCount ?? 0,
          commentCount: inc.commentCount ?? 0,
          points: inc.points ?? 0,
        },
        update: {
          ...(inc.postCount ? { postCount: { increment: inc.postCount } } : {}),
          ...(inc.commentCount
            ? { commentCount: { increment: inc.commentCount } }
            : {}),
          ...(inc.points ? { points: { increment: inc.points } } : {}),
        },
      });
    } catch (e) {
      // Cosmetic counters must never break the write.
      this.logger.warn(`social stats update failed: ${(e as Error).message}`);
    }
  }
}
