# Community Feed — Build Specification

**Project:** All Outdoor (`alloutdoor.co.za`) — NestJS + Prisma + PostgreSQL backend, Next.js 16 App Router frontend.
**Feature:** A members-only community feed (posts, comments, likes, follows, profiles, per-user content filters) with a public join-gate and Facebook-style share cards.
**Audience for this document:** an AI coding agent (DeepSeek V4.1) building the feature. You are expected to follow the repository's existing conventions exactly; this spec tells you what to build and where, not how to restructure the app.

**Status:** C0 + C1 built and locally verified (type-checks clean, both suites green). Not deployed; every route is dark behind `feed_enabled` (default false). C2–C4 still to come.

### Implementation status (2026-09-21)

**Done (C0 + C1):**
- Prisma: `PostType`, `PostStatus`, `GraphicTier`; `Post`, `PostImage`, `Comment`, `PostLike`, `CommentLike`, `Follow`, `UserSocialStats`; `User` filter columns + back-relations; migration `20260921112512_add_community_feed`.
- LLM: `DeepSeekProvider` (`deepseek-flash`), `LlmProvider` union extended, per-purpose routing (`providerFor`) + `isConfiguredFor`, `LLM_PROVIDER_FEED_MODERATION` kill switch, DeepSeek pricing, ledger records the routed provider. **Video moderation routes to Gemini** (`feed.moderation.video`, default `gemini-3.1-flash-lite`); a `video` `LlmPart` was added, refused by DeepSeek and Anthropic.
- Backend: `FeedModule` (+ boot spec), `FeedService`, fail-closed `FeedModerationService`, DTOs, member + admin controllers, settings flags (both registries), notification `linkedType`s + `postLiked`/`commentReply`/`newFollower`, `notification-module` mapping, `AdminAlert` report types.
- Frontend: `/community` (gate/feed), `/community/p/[id]`, `/community/u/[username]`, `/community/settings`; `lib/community-api.ts`, `lib/post-types.ts`, community components, middleware public route, account-menu entry.
- Homepage split + nav (§11A): `components/home-view-toggle.tsx` wrapping the landing page's `showHero` branch in `app/page.tsx` (Shop default, SSR shop preserved); `CommunityGate` gained `as`; desktop top-nav Community link in `components/nav.tsx`; `/community` push-header title in `lib/shell-routes.ts`.
- C2: report flow (post-menu + per-comment report via `POST /community/posts/:id/report` and `/comments/:id/report`); public `(legal)/community-guidelines` page + middleware allowlist + AUP updates; graphic-blur policy honoured through `GET /community/config` (`graphicBlurForced`) with a no-reveal "hidden" state.
- C4: `FeedAward` points ledger + `FeedAwardsService` (levels, daily anti-farming cap, monthly leaderboard); `Group`/`GroupMember` + `Post.groupId` + `User.feedMutedTopicIds`; group list/feed/join endpoints and admin create; frontend `/community/groups`, `/community/g/[slug]`, `/community/leaderboard`, level badge on profiles, group selector in the composer, muted-groups in filters. Topic groups seedable with `npm run seed:feed-groups` (9 groups, one per post type).
- C3: featured ads built **FRESH** (not the orphaned `FeaturedSlot*`): `FeedAd` + `FeedAdStatus`, admin CRUD (`/api/admin/community/ads`), served on the feed's first page and interleaved in the UI with a "Sponsored" label (click tracked via `POST /api/community/ads/:id/click`), flag `feed_ads_enabled`, seed `npm run seed:feed-ads`. **Ads promote a seller's listing:** `FeedAd.listingId` links a Listing, so title/photo/price/link come from the listing and the ad stops showing when the listing is no longer ACTIVE. Sellers feature/unfeature from **My Listings** (`GET|POST|DELETE /api/community/listings/:id/feature`), capped at `FEED_AD_MAX_PER_USER` (3) active ads each. Migration `20260921140000_feed_ads_listing_link`. **Pricing is not built yet** (operator deciding the model) — featuring is free for now.
- Admin UI: `/admin/desk/community` — the feed moderation queue (approve/reject posts held in `PENDING_MODERATION`), a **Disputed** section, plus featured-ads management (list, create, set status, delete). Self-contained inside the Desk layout (uses `deskFetch` + `--dk-*` tokens; the four pinned Desk tabs are untouched).
- **Background moderation + disputes** (built): `submitPost` queues the post (status `PENDING_MODERATION`, `moderatedAt` null) and returns at once with `PROCESSING`; `FeedService.runModeration()` does the real pass fire-and-forget, and a `feed_moderation_sweep` cron re-picks anything stranded. The author sees their own in-flight/rejected posts in the feed (`moderationState`: `PROCESSING` / `IN_REVIEW` / `BLOCKED`) and gets notified on publish/reject. **Dispute flow:** a blocked post offers *Dispute this decision* → `POST /community/posts/:id/dispute` → `AdminAlert POST_DISPUTED` + the promise of feedback **within 48 hours**; admins work it from the Disputed section.
- **Video moderation (visual only, pragmatic):** the clip is transcoded down by Cloudinary, audio stripped (`ac_none`), and Gemini judges the **picture and on-screen text** with the same FIELD/EXTREME criteria as images. Policy is **intent-based**: incidental vehicle/gear branding (logos, even a phone number in shot) is **allowed**; contact/promotional flags fire only when the post itself advertises, sells, or solicits off-platform contact. Playback uses a compressed but complete derivative (`optimizedVideoUrl`, audio kept). Migration `20260921160000_post_moderation_and_disputes`.

**Flow note:** a post is created, media is uploaded, then `POST /community/posts/:id/submit` **queues** it and returns immediately — moderation runs in the background and the post appears on the author's feed automatically once it passes. Nothing is public until it clears moderation (fail-closed for everyone but the author).

**Still open:** share-card OG image generation (deliberately deferred — a per-post card would expose the post title/image to anonymous crawlers, so the generic `/og-default.jpg` is used), a Meilisearch `posts` index (Prisma search is the MVP path), and the deferred privacy (DeepSeek sub-processor) audit.

---

## 0. Read this before writing any code

1. **Read `AGENTS.md` at the repo root, then `docs/project-reference.md`.** They contain hard constraints that override anything ambiguous in this spec. If this spec and the code disagree, the code wins — report it, then follow the code.
2. **Never run `prisma db push`.** Schema changes go through a migration (`npx prisma migrate dev --name …` locally, `prisma migrate deploy` on the box). `npx prisma generate` only regenerates the client.
3. **Every module that mounts a guarded controller must provide that guard's dependencies locally and ship a boot spec.** Getting this wrong crash-loops production while `tsc` and unit tests stay green (this happened on 2026-09-07; see `backend/src/news/news.module.spec.ts`). Copy that spec pattern.
4. **All model calls go through `LlmService`** (`backend/src/common/llm/`). No service builds a provider client, picks a model, or parses a provider response. This spec adds a DeepSeek provider **behind** that adapter; call sites still speak `LlmRequest`/`LlmResponse`.
5. **Frontend component specs must be `.spec.tsx`** (the Vitest include is `['lib/**/*.spec.ts', 'components/**/*.spec.tsx']` — a `.spec.ts` under `components/` is silently never run).
6. **Do not hard-code the brand name.** Use `frontend/lib/brand.ts` (`BRAND_NAME`) and `backend/src/common/brand.ts`.
7. **Never expose real names.** Public/member surfaces render `username` only, with the approved anonymous fallback (`?? 'Anonymous'`).
8. **Never use the words "Escrow" or "KYC" in user-facing copy.** Use "funds held", "payment protected", "Verified"/"Verification".
9. **Build in the phase order in §15.** Each phase is independently testable and flag-gated.

---

## 1. Product summary

A Facebook-for-the-outdoors: members share experiences, ask questions, post photos, and discuss. It exists to increase engagement and drive sales by keeping members active and surfacing relevant marketplace listings. It is deliberately **members-only**, with a designed public front door so shared links work.

### Locked decisions (do not change without the operator)

| # | Area | Decision |
|---|---|---|
| 1 | Visibility | Feed is members-only. Public routes show a **join gate**; feed content requires a session. |
| 2 | Sharing | Share URL unfurls a **generated brand card** (title + type + username, no member photo); click → gate/login. |
| 3 | Post types | 9 condensed types (§4). |
| 4 | Filters | Per-user, server-side, in feed **and** search; type / author / tag axes (topic later). Tags-only for keyword muting. |
| 5 | Moderation | Fail-closed. Members may **not advertise at all** (own listings included). `@alloutdoor.co.za` accounts post anything, badged **Official**. Illegal/graphic moderation applies to everyone. |
| 6 | Graphic content | Tiered: field-normal gore allowed with warning/blur; extreme gore mandatory blur + warning + review; hard-block only unlawful material. |
| 7 | People tagging | None. No face recognition. No tagging of people in photos. Content tags (`Post.tags`) are topic hashtags only. |
| 8 | LLM | Feed moderation only runs on DeepSeek `deepseek-flash`, via per-purpose routing + a kill switch. Gemini stays the platform default and the only image generator. |
| 9 | Commerce | No member promotion. Featured ads are a later phase (deferred, undecided). |
| 10 | DMs | Not built, ever (fee-bypass surface). |

---

## 2. Repository conventions you must follow

### Backend module skeleton
A feature folder contains `*.module.ts`, `*.controller.ts` (often several, when guards differ), `*.service.ts`, `dto/`, and a `*.module.spec.ts` boot spec. Register the module in `backend/src/app.module.ts` (add to the single `imports` array, near `ActivityModule` at line 122).

**Guard-dependency rule:** a controller's `@UseGuards` classes resolve inside the controller's **own** module. So a module with an auth-guarded controller needs, locally:
```ts
imports: [JwtModule.register({})],
providers: [FeedService, AuthGuard, OptionalAuthGuard, AdminJwtGuard, AdminAuditService],
```
`AuthGuard`/`OptionalAuthGuard` are exported by the global `AuthModule` but still need to be **provided** here for Nest to build them in this module's injector.

### Auth
- `AuthGuard` (`backend/src/auth/auth.guard.ts`) — requires a session; stamps `request.userId`.
- `OptionalAuthGuard` (`backend/src/auth/optional-auth.guard.ts`) — never rejects; stamps `request.userId` when present.
- `@CurrentUser()` (`backend/src/auth/current-user.decorator.ts`) — returns `request.userId`.
- Admin routes use `AdminJwtGuard` + `AdminAuditService`.

### DTOs & validation
Global `ValidationPipe({ whitelist: true, transform: true, transformOptions: { enableImplicitConversion: true } })` (`backend/src/main.ts`). **Use real DTO classes**, not inline body interfaces, so `whitelist` strips unknown fields. See `backend/src/ratings/dto/create-rating.dto.ts` and `backend/src/notifications/dto/notifications-feed-query.dto.ts`.

### Pagination
Use **cursor pagination** for the feed (stable under inserts): query DTO carries `limit` (1–100) and `before` (ISO date of the last row's `createdAt`); the service applies `createdAt: { lt: new Date(before) }` with `orderBy: { createdAt: 'desc' }, take: limit`. Mirror `backend/src/notifications/dto/notifications-feed-query.dto.ts`.

### Throttling
Global default bucket is 60 req/min (`app.module.ts:71-73`). Override per route with `@Throttle({ default: { limit: N, ttl: ms } })`. `@SkipThrottle()` is reserved for SSR-facing public reads and webhooks — **do not** put it on member writes.

### Images
`CloudinaryService` (`backend/src/cloudinary/cloudinary.service.ts`) is `@Global`: `uploadImage(buffer, folder, publicId?)`, `deleteImage(publicId)`. Upload endpoints use `FileInterceptor('image', { storage: memoryStorage() })` + `ParseFilePipe` validators (`MaxFileSizeValidator`, `FileTypeValidator`). Persist a child row exactly like `ListingImage`. Never store zero-byte images.

### Feature flags
Add flags to `FLAGS` in `backend/src/settings/settings.service.ts` (line 16–419) **and** to `admin-settings.service.ts` (both registries or neither; see the WhatsApp comment at `settings.service.ts:405-413`). Read them via `SettingsService`. Defaults must be OFF for anything new.

### Notifications
Single chokepoint `NotificationsService` (`backend/src/notifications/notifications.service.ts`). Add a purpose-built method per event; call `persist()`/`persistByEmail()` internally. `type` is a free-form string (no migration). `NotificationCategory` is an enum (`BUYER|SELLER|ACCOUNT`). `linkedType` is a compile-time union (`notifications.service.ts:18-35`) — extend it. Map new event types in `backend/src/notifications/notification-module.ts`.

### Frontend
- Route gating is an **allowlist**: anything not in `isPublicRoute` (`frontend/middleware.ts:60-199`) requires a session (307 → `/sign-in`). A route that must be reachable signed-out (to show the gate) must be added there.
- Server components check auth with `serverAuth()` (`frontend/lib/auth-server.ts:48-63`) → `{ userId, getToken }`; redirect or render the gate.
- Viewer-varying server reads use `viewerFetch` (`frontend/lib/api-viewer.ts`, forces `no-store`); client reads use `useViewerFetch` (`frontend/lib/use-viewer-fetch.ts`). **Never** `revalidate`/`force-cache` a viewer-varying fetch.
- Tokens: `FRONTEND` server uses `INTERNAL_API_URL ?? NEXT_PUBLIC_API_URL`; client uses `NEXT_PUBLIC_API_URL`. Client actions get a fresh token via `getToken()` and send `Authorization: Bearer`.
- Tokens/theme: use CSS vars from `frontend/app/globals.css`; elevation only via `.gg-tile` (+ `.gg-tile-lift`). No Tailwind colour theme.
- Nav destinations live in `frontend/lib/account-menu-data.tsx` (`ACCOUNT_GROUPS`) — one edit propagates to desktop, mobile, PWA and the account hub.

---

## 3. Data model

### 3.1 Enums (append to `backend/prisma/schema.prisma`)

```prisma
enum PostType {
  GENERAL
  HUNTING
  FIREARMS_SHOOTING
  RELOADING
  FISHING
  OVERLANDING_4X4
  CAMPING_BUSHCRAFT
  GEAR_REVIEWS
  QUESTIONS_ADVICE
}

enum PostStatus {
  PENDING_MODERATION
  PUBLISHED
  REJECTED
  HIDDEN
}

enum GraphicTier {
  NONE
  FIELD     // normal field gore (blood on carcass, field dressing)
  EXTREME   // guts, dismemberment, severe injury — mandatory blur + review
}
```

### 3.2 Models (append to `backend/prisma/schema.prisma`)

```prisma
// ─── Community Feed ────────────────────────────────────────────────
model Post {
  id               String       @id @default(cuid())
  authorId         String
  author           User         @relation("UserPosts", fields: [authorId], references: [id], onDelete: Cascade)
  type             PostType
  title            String?      @db.VarChar(140)
  body             String
  tags             String[]     @default([])
  gear             Json?
  listingId        String?
  listing          Listing?     @relation("PostListing", fields: [listingId], references: [id], onDelete: SetNull)
  categoryId       String?
  category         Category?    @relation("PostCategory", fields: [categoryId], references: [id], onDelete: SetNull)
  publicVisible    Boolean      @default(false)
  status           PostStatus   @default(PENDING_MODERATION)
  graphicTier      GraphicTier  @default(NONE)
  moderationReason String?
  isPinned         Boolean      @default(false)
  isOfficial       Boolean      @default(false)
  likeCount        Int          @default(0)
  commentCount     Int          @default(0)
  reportedCount    Int          @default(0)
  publishedAt      DateTime?
  editedAt         DateTime?
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  images   PostImage[]
  comments Comment[]
  likes    PostLike[]

  @@index([status, createdAt(sort: Desc)])
  @@index([authorId, createdAt(sort: Desc)])
  @@index([type, createdAt(sort: Desc)])
  @@index([tags(ops: ArrayOps)], type: Gin)
}

model PostImage {
  id        String   @id @default(cuid())
  postId    String
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  url       String
  publicId  String
  order     Int      @default(0)
  isPrimary Boolean  @default(false)
  createdAt DateTime @default(now())

  @@index([postId])
}

model Comment {
  id               String       @id @default(cuid())
  postId           String
  post             Post         @relation(fields: [postId], references: [id], onDelete: Cascade)
  authorId         String
  author           User         @relation("UserComments", fields: [authorId], references: [id], onDelete: Cascade)
  parentId         String?
  parent           Comment?     @relation("CommentReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies          Comment[]    @relation("CommentReplies")
  body             String
  status           PostStatus   @default(PENDING_MODERATION)
  moderationReason String?
  likeCount        Int          @default(0)
  reportedCount    Int          @default(0)
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt

  likes CommentLike[]

  @@index([postId, createdAt])
  @@index([authorId])
}

model PostLike {
  id        String   @id @default(cuid())
  postId    String
  post      Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation("UserPostLikes", fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([postId, userId])
  @@index([userId, createdAt(sort: Desc)])
  @@index([postId])
}

model CommentLike {
  id        String   @id @default(cuid())
  commentId String
  comment   Comment  @relation(fields: [commentId], references: [id], onDelete: Cascade)
  userId    String
  user      User     @relation("UserCommentLikes", fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())

  @@unique([commentId, userId])
  @@index([commentId])
}

model Follow {
  id          String   @id @default(cuid())
  followerId  String
  follower    User     @relation("UserFollowing", fields: [followerId], references: [id], onDelete: Cascade)
  followingId String
  following   User     @relation("UserFollowers", fields: [followingId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())

  @@unique([followerId, followingId])
  @@index([followingId, createdAt(sort: Desc)])
  @@index([followerId, createdAt(sort: Desc)])
}

model UserSocialStats {
  id          String   @id @default(cuid())
  userId      String   @unique
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  points      Int      @default(0)
  postCount   Int      @default(0)
  commentCount Int     @default(0)
  followerCount Int    @default(0)
  followingCount Int   @default(0)
  updatedAt   DateTime @updatedAt
}
```

### 3.3 `User` back-relations and filter columns

Inside `model User` add the scalar filter columns (Prisma scalar lists on Postgres):
```prisma
  feedMutedPostTypes String[] @default([])
  feedMutedAuthorIds String[] @default([])
  feedMutedTags      String[] @default([])
  // feedMutedTopicIds String[] @default([])   // C4, add with the topic model
```
And the back-relations:
```prisma
  posts          Post[]           @relation("UserPosts")
  comments       Comment[]        @relation("UserComments")
  postLikes      PostLike[]       @relation("UserPostLikes")
  commentLikes   CommentLike[]    @relation("UserCommentLikes")
  following      Follow[]         @relation("UserFollowing")
  followers      Follow[]         @relation("UserFollowers")
  socialStats    UserSocialStats?
```

### 3.4 Existing models to touch

- `Listing`: add `posts Post[] @relation("PostListing")`.
- `Category`: add `posts Post[] @relation("PostCategory")`.

### 3.5 Migration

```bash
cd backend
npx prisma migrate dev --name add_community_feed
npx prisma generate
```
⛔ Do **not** run `prisma db push`. On the production box the deploy script runs `prisma migrate deploy` then `prisma generate`.

---

## 4. Post types

| Enum | Display label | Maps to catalogue |
|---|---|---|
| `HUNTING` | Hunting | hunting, archery-bowhunting |
| `FIREARMS_SHOOTING` | Firearms & Shooting | firearms, shooting-accessories, self-defence, air-rifles, gun-smithing-parts |
| `RELOADING` | Reloading | reloading-components, reloading-equipment |
| `FISHING` | Fishing | fishing |
| `OVERLANDING_4X4` | Overlanding & 4x4 | overlanding |
| `CAMPING_BUSHCRAFT` | Camping & Bushcraft | camping-outdoor |
| `GEAR_REVIEWS` | Gear & Reviews | optics, knives, outdoor-clothing-footwear, cleaning-equipment |
| `QUESTIONS_ADVICE` | Questions & Advice | cross-cutting |
| `GENERAL` | General & Community | cross-cutting (intros, news, "wanted" tags) |

Labels live in ONE place shared by backend and frontend: create `frontend/lib/post-types.ts` for display labels, and a backend constant in `backend/src/feed/feed.types.ts`. Keep the enum as the source of truth.

---

## 5. LLM: DeepSeek provider + per-purpose routing

### 5.1 New file `backend/src/common/llm/deepseek.provider.ts`

`deepseek-flash` is the **only** DeepSeek model with vision; `deepseek-v4-pro` has none. Feed moderation needs vision, so the model is fixed to `deepseek-flash` (overridable by `LLM_MODEL` only if that model also supports vision — document the risk).

```ts
import {
  LlmError,
  type LlmPart,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamEvent,
} from './llm.types';
import type { LlmProviderClient } from './provider.interface';

const BASE_URL = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';

export class DeepSeekProvider implements LlmProviderClient {
  readonly name = 'deepseek' as const;

  isConfigured(): boolean {
    return Boolean(process.env.DEEPSEEK_API_KEY);
  }

  defaultModel(): string {
    return process.env.LLM_MODEL ?? DEFAULT_DEEPSEEK_MODEL;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    if (!this.isConfigured()) {
      throw new LlmError('not_configured', 'deepseek is not configured — no DEEPSEEK_API_KEY');
    }
    // This provider is wired for feed moderation only. Anything it is not
    // expected to do fails loudly rather than silently mis-mapping.
    if (req.tools?.length) throw new LlmError('unsupported', 'deepseek path does not implement tools on this platform');
    if (req.grounding?.web) throw new LlmError('unsupported', 'deepseek path does not implement hosted web search');

    const model = req.model ?? this.defaultModel();
    const messages = req.messages.map((m) => ({ role: m.role, content: this.mapContent(m.content) }));

    // DeepSeek JSON mode: response_format + the word "json" + an example in
    // the prompt. It guarantees valid JSON, NOT a schema. The caller validates.
    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: req.maxTokens,
      stream: false,
      // Moderation wants a fast deterministic verdict; thinking doubles latency.
      thinking: { type: 'disabled' },
    };
    if (req.system) body.messages = [{ role: 'system', content: req.system }, ...(body.messages as unknown[])];
    if (typeof req.temperature === 'number') body.temperature = req.temperature;
    if (req.json) body.response_format = { type: 'json_object' };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? 60_000);
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new LlmError('timeout', 'deepseek request timed out');
      throw new LlmError('network', `deepseek network error: ${(e as Error).message}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const code =
        res.status === 400 ? 'bad_request'
        : res.status === 401 || res.status === 403 ? 'not_configured'
        : res.status === 429 ? 'rate_limited'
        : res.status >= 500 ? 'overloaded'
        : 'unknown';
      throw new LlmError(code as never, `deepseek ${res.status}: ${text}`, res.status);
    }

    const data = (await res.json()) as any;
    const choice = data?.choices?.[0];
    const content: string = choice?.message?.content ?? '';
    const finish: string = choice?.finish_reason ?? 'stop';

    // An empty answer with JSON requested is a REFUSAL, not a shape to trust.
    // Throw so the caller's fail-closed path takes over.
    if (req.json && !content.trim()) {
      throw new LlmError('safety', 'deepseek returned empty JSON content');
    }

    const usage = data?.usage ?? {};
    return {
      text: content,
      parts: content ? [{ type: 'text', text: content }] : [],
      toolCalls: [],
      stopReason: finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'safety' : 'end',
      usage: {
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        cachedInputTokens: usage.prompt_cache_hit_tokens,
      },
      model,
      provider: 'deepseek',
      assistantMessage: { role: 'assistant', content },
    };
  }

  async *stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    // Feed moderation never streams. A single 'done' event satisfies the
    // interface without a second, untested SSE path.
    const response = await this.complete(req);
    yield { type: 'done', response };
  }

  private mapContent(content: string | LlmPart[]): unknown {
    if (typeof content === 'string') return content;
    return content.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      if (p.type === 'image') {
        return { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } };
      }
      // PDFs/documents are not used by feed moderation.
      throw new LlmError('unsupported', `deepseek path does not accept a '${p.type}' part`);
    });
  }
}
```

### 5.2 Extend `LlmProvider` and the provider interface

- `backend/src/common/llm/llm.types.ts:19` → `export type LlmProvider = 'gemini' | 'anthropic' | 'deepseek';`
- `provider.interface.ts` needs no change (DeepSeek implements the same contract).

### 5.3 Per-purpose routing in `LlmService`

In `backend/src/common/llm/llm.service.ts`:

1. Add DI token + optional constructor param, built like the existing two:
```ts
export const LLM_DEEPSEEK_PROVIDER = Symbol('LLM_DEEPSEEK_PROVIDER');
// in the constructor:
@Optional() @Inject(LLM_DEEPSEEK_PROVIDER) deepseek?: LlmProviderClient,
// and:
this.deepseek = deepseek ?? new DeepSeekProvider();
```
2. Add a purpose→provider resolver. Env var name is derived from the purpose: `feed.moderation` → `LLM_PROVIDER_FEED_MODERATION`.
```ts
private providerFor(purpose: string): LlmProviderClient {
  const key = `LLM_PROVIDER_${purpose.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const name = process.env[key] ?? process.env.LLM_PROVIDER ?? 'gemini';
  if (name === 'anthropic') return this.anthropic;
  if (name === 'deepseek') return this.deepseek;
  return this.gemini;
}
```
3. In `complete()` / `stream()` / `generateImage()`, replace `this.active()` with `this.providerFor(req.purpose)`, and replace `const model = req.model ?? this.model;` with `const model = req.model ?? providerClient.defaultModel();`. Keep the `provider` getter (global) for `/admin/health` and `ping()`.
4. `record()` currently writes `this.provider` and logs `this.provider`. Change it to accept the actual `provider: LlmProvider` used for the call and use that. This keeps the `AiUsage` ledger correct when calls route to different providers.

### 5.4 Pricing in `backend/src/common/llm/llm.pricing.ts`

Add a DeepSeek branch so the ledger prices these calls. Rates (per 1M tokens, USD): input cache-miss **$0.15 off-peak / $0.30 peak**, input cache-hit **$0.003 / $0.006**, output **$0.60 / $1.20**. DeepSeek peak = **UTC 01:00–04:00 and 06:00–10:00, Mon–Fri** (SAST 03:00–06:00 and 08:00–12:00). Anything unrecognised must fall back to a **conservative (peak) rate**, never zero.

### 5.5 Kill switch

The purpose override is read from the env on every call. To take feed moderation off DeepSeek:
```
LLM_PROVIDER_FEED_MODERATION=gemini
```
then `pm2 reload alloutdoor-backend`. This is the same "env + reload, no deploy" rollback lever as `LLM_PROVIDER=anthropic`. Document it in `HANDOFF.md` when shipped. If a true no-reload switch is ever wanted, move the lookup to a `Setting` row (inject `SettingsService` into `LlmService`) — but do not do that in this build.

---

## 6. Backend: feed module

### 6.1 File tree

```
backend/src/feed/
  feed.module.ts
  feed.module.spec.ts
  feed.types.ts                 # shared constants: labels, limits, regex of official domain
  feed.controller.ts            # member reads (AuthGuard)
  feed-member.controller.ts     # member writes (AuthGuard)   [may be merged into feed.controller]
  feed-admin.controller.ts      # admin queue (AdminJwtGuard)
  feed.service.ts               # reads + writes + filter predicate
  feed-moderation.service.ts    # PostModerationService (fail-closed)
  dto/
    create-post.dto.ts
    update-post.dto.ts
    create-comment.dto.ts
    feed-query.dto.ts
    feed-search.dto.ts
    feed-preferences.dto.ts
    report-content.dto.ts
```

> Keep controllers split by guard. Nest applies class-level guards to every method, so a public `OptionalAuthGuard` method cannot live under an `AuthGuard` class (see `ratings.controller.ts:60-64` for the precedent). For this feature the feed API is member-only except where noted, so two controllers (member + admin) is the minimum.

### 6.2 `feed.module.ts`

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AuthGuard } from '../auth/auth.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { FeedService } from './feed.service';
import { FeedModerationService } from './feed-moderation.service';
import { FeedController, FeedMemberController, FeedAdminController } from './feed.controller';

@Module({
  imports: [JwtModule.register({})],   // required to build the guards locally
  controllers: [FeedController, FeedMemberController, FeedAdminController],
  providers: [FeedService, FeedModerationService, AuthGuard, OptionalAuthGuard, AdminJwtGuard, AdminAuditService],
  exports: [FeedService, FeedModerationService],
})
export class FeedModule {}
```

### 6.3 `feed.module.spec.ts`

Copy `backend/src/news/news.module.spec.ts` exactly (it stubs `SessionService` globally, imports the real module, overrides `PrismaService` with `{}`, and asserts a service resolves). This is the guard-dependency safety net.

### 6.4 `feed.service.ts` — reads & writes

Constructor injects: `PrismaService`, `CloudinaryService`, `ContactDetailFilterService`, `FeedModerationService`, `NotificationsService`, `SettingsService`, `ActivityService` (optional), `Logger`.

**Filter predicate (the core of §7):**
```ts
private filterWhere(viewer: UserFilterRow, includeFiltered: boolean) {
  if (includeFiltered) return {};
  return {
    NOT: [
      { type: { in: viewer.feedMutedPostTypes as PostType[] } },
      { authorId: { in: viewer.feedMutedAuthorIds } },
      { tags: { hasSome: viewer.feedMutedTags } },   // tag-based keyword muting
    ],
  };
}
```
Load the viewer's filter row once per feed request: `prisma.user.findUnique({ where: { id: userId }, select: { feedMutedPostTypes, feedMutedAuthorIds, feedMutedTags } })`.

**`listFeed({ userId, before, limit, includeFiltered, type })`** → `prisma.post.findMany({ where: { status: 'PUBLISHED', ...(type ? { type } : {}), ...(before ? { createdAt: { lt: new Date(before) } } : {}), ...filterWhere(...) }, orderBy: { createdAt: 'desc' }, take: Math.min(limit ?? 20, 50), include: { images: true, author: { select: { username: true, avatarUrl: true, sellerTier: true, isVerifiedExpert: true } }, listing: { select: { id: true, title: true, price: true, listingType: true } } } })`. Never select `User.firstName`/`lastName`.

**`searchFeed({ userId, q, before, limit, includeFiltered })`** — same predicate; MVP search is `Prisma` `contains` on `title`/`body` (case-insensitive) plus exact tag match; filters apply. Meilisearch is deferred.

**`getPost(userId, postId)`** — 404 (`NotFoundException`) when the post is not `PUBLISHED` (never 403; do not confirm existence).

**`createPost(userId, dto)`** — order of operations:
1. Load author (`isBanned`, `accountClosedAt`, `email`) — reject banned/closed.
2. `official = author.email.toLowerCase().endsWith('@alloutdoor.co.za')`.
3. `const check = await this.contactFilter.check(dto.body, 'feed-post', userId)`; if `!check.allowed` and `!official` → `BadRequestException(check.reason)`.
4. `const verdict = await this.moderation.moderate({ text: [dto.title, dto.body].filter(Boolean).join('\n'), imageUrls: [], authorIsOfficial: official, postType: dto.type })`.
5. Persist with `status = verdict.decision === 'PUBLISH' ? 'PUBLISHED' : verdict.decision === 'REJECT' ? 'REJECTED' : 'PENDING_MODERATION'`, `graphicTier = verdict.graphicTier`, `isOfficial = official`, `publishedAt` when published.
6. Normalise/dedupe/cap tags (lowercase, trim, `#` stripped, max 10; reject tags > 40 chars).
7. Notify followers (best-effort, capped) when published.
8. `activity.record(...)` optional.
9. Return the shaped post.

**`addComment` / `likePost` / `unlikePost` / `likeComment` / `follow` / `unfollow`** — validate target exists and is PUBLISHED, guard against self-follow if desired, `upsert`/`delete` on the join table, update denormalised counters in the same transaction. Comments run `contactFilter.check(body, 'feed-comment', userId)` + `moderation.moderate(...)` (text only) and persist status accordingly. Likes/follows need no LLM.

**`uploadImage(postId, userId, file)`** — ownership check, `cloudinary.uploadImage(file.buffer, 'feed')`, create `PostImage`. Do not allow uploads to a post that isn't the caller's or isn't PENDING/PUBLISHED.

**`removeImage(postId, userId, imageId)`** — ownership check, `cloudinary.deleteImage(publicId)`, delete row.

**`getPreferences(userId)` / `setPreferences(userId, dto)`** — read/merge-write the three arrays, normalise values.

**`report(userId, kind, id)`** — increment `reportedCount` and raise an `AdminAlert` (reuse the `reports.service.ts` pattern: `AdminAlert.create({ type: 'POST_REPORTED' | 'COMMENT_REPORTED', referenceId, context: { reporterId, reason } })`). See §10.

**`deletePost`** — author may delete own post; soft is not required, hard delete cascades images (delete Cloudinary assets first).

### 6.5 `feed-moderation.service.ts` — `FeedModerationService`

Fail-closed. Single public method:
```ts
export interface FeedModerationInput {
  text: string;
  imageUrls: string[];
  authorIsOfficial: boolean;
  postType?: PostType;
}
export interface FeedModerationVerdict {
  decision: 'PUBLISH' | 'PENDING_MODERATION' | 'REJECT';
  graphicTier: GraphicTier;
  reasons: string[];
  promoDetected: boolean;
}
async moderate(input: FeedModerationInput): Promise<FeedModerationVerdict>
```

Rules:
- If `!this.llm.isConfiguredFor('feed.moderation')` (or any error / empty / malformed JSON) → return `{ decision: 'PENDING_MODERATION', graphicTier: 'NONE', reasons: ['moderation_unavailable'], promoDetected: false }`. **Never auto-publish on a failure.**
- Fetch bounded image copies as base64 via `common/image-url.ts` (`boundedImageUrl`, `IMAGE_EDGE.photo`). If an image cannot be fetched, drop it from the call; if **no** image is readable but images were expected, return `PENDING_MODERATION`.
- Call `LlmService.complete({ system, messages: [{ role: 'user', content: [ {type:'text',text}, ...images ] }], maxTokens: 400, temperature: 0, thinking: { budgetTokens: 0 }, json: { schema: <shape> }, purpose: 'feed.moderation' })`.
- **Validate the JSON yourself** (DeepSeek enforces valid JSON only, not the schema). On shape mismatch → `PENDING_MODERATION`.
- Official accounts skip the **promotional** category only; illegal and graphic categories always apply.

System prompt (abridged; write it in full in the file — it must contain the word "json" and a worked example, per DeepSeek JSON mode):
```
You are the content moderation classifier for All Outdoor, a South African
outdoor and firearms community. Classify the POST and its photos. Return json.

Categories to look for:
- promotional: advertising or selling by a member — links to shops/YouTube/
  social handles, "DM me", "visit my store", prices-for-sale, watermarks or
  contact text baked into an image. NOTE: promoting your own All Outdoor
  listing is ALSO promotional and is NOT allowed for members.
- contact: phone numbers, email addresses, physical addresses, URLs, social
  handles, off-platform coordination.
- illegal: live ammunition/primers/propellant sales talk, threats, doxxing,
  animal cruelty, anything unlawful under South African law.
- graphic: FIELD = normal hunting field photos (blood on a carcass, field
  dressing); EXTREME = exposed guts/viscera, dismemberment, severely damaged
  heads/bodies.
Verdict rules:
- promotional or contact → REJECT.
- illegal → REJECT.
- EXTREME graphic → PENDING_MODERATION (blur + human review).
- otherwise PUBLISH.

Example json output:
{"decision":"PUBLISH","graphicTier":"FIELD","promoDetected":false,"reasons":[]}
```

### 6.6 Controllers

`feed.controller.ts` (member reads, `@Controller('community') @UseGuards(AuthGuard)`, `@Throttle({ default: { limit: 120, ttl: 60_000 } })` on reads):
- `GET /community/feed` → `listFeed`
- `GET /community/posts/:id` → `getPost`
- `GET /community/search` → `searchFeed`
- `GET /community/users/:username` → profile + posts
- `GET /community/preferences` → `getPreferences`

`feed-member.controller.ts` (`@Controller('community') @UseGuards(AuthGuard)`, writes throttled 10–20/min):
- `POST /community/posts`
- `PATCH /community/posts/:id`
- `DELETE /community/posts/:id`
- `POST /community/posts/:id/images` (FileInterceptor + ParseFilePipe, 8 MB, jpeg/png/webp)
- `DELETE /community/posts/:id/images/:imageId`
- `POST /community/posts/:id/comments`
- `POST /community/posts/:id/like` / `DELETE /community/posts/:id/like`
- `POST /community/comments/:id/like` / `DELETE`
- `POST /community/users/:id/follow` / `DELETE`
- `PUT /community/preferences`
- `POST /community/posts/:id/report` / `POST /community/comments/:id/report`

`feed-admin.controller.ts` (`@Controller('admin/community') @UseGuards(AdminJwtGuard)`):
- `GET /admin/community/queue?status=PENDING_MODERATION` → list
- `POST /admin/community/posts/:id/review` body `{ action: 'APPROVE'|'REJECT', reason? }`
- `GET /admin/community/reported` → reported posts + comments

New `AdminAlert` types: `POST_REPORTED`, `COMMENT_REPORTED`.

---

## 7. Content filters

- Stored on `User` as `feedMutedPostTypes`, `feedMutedAuthorIds`, `feedMutedTags`.
- Applied **server-side** in `listFeed` and `searchFeed` via `filterWhere()`.
- `?includeFiltered=true` disables the exclusions for that request only (never persisted), and the UI marks muted items visibly.
- **Feed only.** Never apply these to listings, search of listings, categories, or the marketplace.
- Direct interaction notifications (comment reply on your post, mention, new follower) bypass filters.
- Preferences page + inline "hide this type / mute this author / mute this tag" actions persist immediately.
- Keyword muting is **tag-based only** for MVP (`tags: { hasSome: [...] }`). Free-text muting is deferred.

---

## 8. Notifications

Extend `NotificationLinkedType` (`notifications.service.ts:18-35`) with `'post' | 'comment' | 'user'`. Add methods next to the existing event methods, each calling `persist()`:

- `postLiked({ recipientId, actorUsername, postId, postTitle })` — `category: 'ACCOUNT'`, `type: 'post_liked'`, `dismissible: true`, `linkedType: 'post'`, `linkedId: postId`, `url: '/community/p/<id>'`.
- `commentReply({ recipientId, actorUsername, postId, commentId })` — `type: 'comment_reply'`, `linkedType: 'comment'`.
- `newFollower({ recipientId, actorUsername, followerId })` — `type: 'new_follower'`, `linkedType: 'user'`.

Rules: never include the other member's real name; username only. Do not notify a user about their own action. Add branches in `notification-module.ts` so these badge the account menu/community module.

---

## 9. Settings flags

Add to `FLAGS` (`settings.service.ts`) **and** `admin-settings.service.ts`, all defaulting OFF:
```ts
feedEnabled:            { key: 'feed_enabled', default: false, parse: (s) => s === 'true' || s === '1' },
feedGateEnabled:        { key: 'feed_gate_enabled', default: true,  parse: (s) => s === 'true' || s === '1' },
feedGraphicBlurForced:  { key: 'feed_graphic_blur_forced', default: true, parse: (s) => s === 'true' || s === '1' },
feedAwardsEnabled:      { key: 'feed_awards_enabled', default: false, parse: (s) => s === 'true' || s === '1' },
```
Every feed route must 404 (or return an empty gate) when `feed_enabled` is false, mirroring how inert modules behave.

---

## 10. Admin & moderation queue

- Backend: `FeedAdminController` (§6.6) + methods in `AdminService`/`AdminTrustSafetyService` for `pendingPosts()`, `reportedPosts()`, `reportedComments()`.
- Frontend: extend `frontend/app/admin/desk/health/trust-safety.tsx` with new tabs (`posts`, `comments`) and the existing drawer components. Follow the file's "queue you work FROM" pattern.
- Reports raise `AdminAlert` rows and increment the row's `reportedCount` (the Q&A precedent).

---

## 11. Frontend

### 11.1 Routes (all public in middleware so the gate can render)

Add to `isPublicRoute` (`frontend/middleware.ts:60-199`):
```ts
'/community(.*)',   // feed + post permalink + profiles; page does its own auth check
```

Pages:
```
frontend/app/community/page.tsx              # gate (anon) / feed (member)
frontend/app/community/p/[id]/page.tsx       # permalink: gate / post
frontend/app/community/u/[username]/page.tsx # profile: gate / member view
frontend/app/community/settings/page.tsx     # feed preferences
frontend/app/community/me/page.tsx           # member control centre (edit/delete own posts)
frontend/app/community/loading.tsx           # RSC skeleton
```
Each page does:
```ts
const { userId, getToken } = await serverAuth();
if (!userId) return <CommunityGate />;      // the join gate + blurred sample
const token = await getToken();
// viewerFetch/ no-store fetch of /community/...
```
Anonymous visitors must get **identical** content to any crawler — the gate. Never branch on user-agent.

### 11.2 Gate

A designed card: headline, short value copy, a **blurred sample post** (CSS blur over a stock-looking placeholder, clearly labelled), and a CTA to sign in / sign up preserving the destination (`/sign-in?redirect_url=/community`). Copy uses `BRAND_NAME`; no Escrow/KYC wording.

### 11.3 Metadata & share cards

`generateMetadata` on `/community/p/[id]` returns **generic brand metadata** for anonymous callers: title `"A post on {BRAND_NAME}"`, description from category keywords with no weapon words, `openGraph.images = ['/og-default.jpg']`. Do **not** put the member's photo or body in anonymous metadata. Once a generated card image exists, it replaces the default. `robots: { index: false, follow: false }` for post pages (the feed must not be indexed).

### 11.4 Components

- `components/community/post-card.tsx` — `.gg-tile gg-tile-lift`, author line (`username ?? 'Anonymous'`), type chip, tags, images (`next/image`, Cloudinary only), graphic blur overlay with tap-to-reveal, action row (like/comment/share/mute).
- `components/community/comment-thread.tsx`
- `components/community/feed-filters.tsx` — inline hide/mute menu.
- `components/community/post-composer.tsx` — type picker, tags, image upload via `FormData` to `/community/posts/:id/images` (downscale with `lib/process-image.ts`, picker `components/photo-dropzone.tsx`).
- `components/community/follow-button.tsx`, `share-button.tsx`.
- All component specs are `.spec.tsx` with `// @vitest-environment jsdom` on line 1.

### 11.5 Data clients

Add `frontend/lib/community-api.ts` modelled on `frontend/lib/users-api.ts` (`request<T>()` gets the token inside each call, `cache: 'no-store'`, typed error). Server reads use `viewerFetch`.

### 11.6 Nav & SEO

- Add a **Community** entry to `ACCOUNT_GROUPS` (`frontend/lib/account-menu-data.tsx:181-265`) with an icon.
- `robots.ts`: allow `/community` (the gate) but the post pages carry `noindex`. Add nothing to `sitemap.ts`.
- Weapon-word guard: any public URL/slug derived from content must not contain a weapon word. Since post URLs use cuid `id`, there is no slug risk today — but assert it in a test.

---

## 11A. Navigation placement

**Status (operator, 2026-09-22):** the homepage-only split is **retired**. A
single **global Shop/Community toggle** (`components/view-mode-toggle.tsx`) is
the one view switch, present in the global chrome on every page, and it
**navigates** — Shop → `/`, Community → `/community`. The active tab follows the
pathname.

### 11A.1 The global toggle

- **Where:** the sticky nav (`components/nav.tsx`) on every public page —
  inline on desktop (`hidden md:flex`) and full-width at the top of the mobile
  drawer. In the installed PWA — where the nav is hidden — it instead renders in
  the shell header (`components/shell/shell-header.tsx`), in both archetypes,
  using the compact `size="sm"` variant (between the title and the cart on the
  PUSH header). Admin, checkout and chromeless routes render their own chrome
  and no nav, so no toggle there (intentionally).
- **What it does:** navigates. Shop goes to the storefront home `/`; Community
  goes to `/community` (which carries the feed + the member's My rail, §18).
  Signed-out Community → the join gate (the `/community` page already does
  this).
- **SEO is untouched:** `/` stays the server-rendered shop (community content is
  never in the public HTML) and `/community` stays `noindex`.
- **Hidden only while a motivation is busy.** The motivation sheet
  (`app/licence-centre/[id]/page.tsx`) reports its `busy` state through
  `lib/motivation-busy.ts` (a DOM attribute + a `gg:motivation-busy` window
  event); `ViewModeToggle` hides itself while true, so a switch cannot yank a
  member out of an in-flight save/generate.
- The former `components/home-view-toggle.tsx` (an inline Shop/Community switch
  on the homepage) was **deleted** — one toggle, not two. `app/page.tsx` now
  renders the shop directly.

### 11A.2 Other placement

- **Account group** (`ACCOUNT_GROUPS`) keeps the *Community feed* (`/community`)
  and *Feed preferences* (`/community/settings`) entries — shown in the desktop
  account dropdown, mobile drawer, PWA "More" sheet, and the `/account` hub.
- The signed-in desktop **"Community" nav pill** beside the avatar was
  **removed** (operator, 2026-09-22).
- **Mobile shell title.** `['/community', 'Community']` in `PUSH_TITLES`
  (`frontend/lib/shell-routes.ts`) — built.

**Do not** add a bottom-tab slot (the five-tab pack is locked) and **do not**
make `/community` publicly indexable.

---

## 12. Moderation policy matrix (reference)

| Content | Member | Official `@alloutdoor.co.za` |
|---|---|---|
| Normal post/photo | Allow | Allow |
| Own All Outdoor listing promotion | **Block** (promotional) | Allow |
| External shop / YouTube / social / "DM me" | **Block** (promotional) | Allow |
| Contact details in text/images | Block | Allow (promo/contact filter only) |
| Illegal (ammo sales, threats, doxxing, cruelty) | Block | **Block** |
| Extreme gore | Blur + PENDING | Blur + PENDING |
| Field-normal gore | Allow, warning/blur | Allow, warning/blur |
| Watermarked/stock image | Block | Allow (may be branded content) |

The Official exemption never bypasses illegal or graphic moderation.

---

## 13. Tests

Backend (Jest via `npm test`, not `npx jest`):
- `feed.module.spec.ts` — boot spec (§6.3).
- `feed.service.spec.ts` — filter predicate excludes muted type/author/tag; `includeFiltered` bypasses; non-PUBLISHED → 404; banned/closed author rejected; comments with contact info rejected.
- `feed-moderation.service.spec.ts` — LLM error → `PENDING_MODERATION`; empty JSON → `PENDING_MODERATION`; extreme gore → `PENDING_MODERATION` + `EXTREME`; official skips promo but not illegal.
- `deepseek.provider.spec.ts` — maps a fake fetch response; empty JSON content throws `safety`; tools/grounding throw `unsupported`; HTTP 429 → `rate_limited`.
- `llm.service.spec.ts` — `providerFor('feed.moderation')` respects `LLM_PROVIDER_FEED_MODERATION`; ledger records the routed provider.

Frontend (Vitest via `npm test`): `post-card.spec.tsx`, `feed-filters.spec.tsx`, `community-api` pure helpers in `lib/*.spec.ts`.

Acceptance per phase: all type-checks clean (`npx tsc --noEmit` in both), both suites green, and the documented behaviour observable against a local backend.

---

## 14. Traps (do not rediscover the hard way)

- **Guard deps must be local + boot spec**, or production crash-loops with green tests.
- **Never `prisma db push`.**
- **Failed moderation must never publish.** Empty/malformed DeepSeek output is a refusal.
- **Filters are server-side and feed-only**; a marketplace query must never inherit them.
- **Anonymous responses are identical for humans and crawlers** (no cloaking, ever).
- **Hidden/non-published content returns 404, not 403.**
- **No real names on any surface**; username only.
- **DeepSeek has no image generation** — never route `generateImage` to it.
- **DeepSeek peak pricing is SA morning** (03:00–06:00 and 08:00–12:00 SAST).
- **`@alloutdoor.co.za` domain match is the entire Official gate** — ensure no catch-all mailbox exists on that domain.
- **Frontend component specs must be `.spec.tsx`.**
- **Never `revalidate`/`force-cache` viewer-varying fetches.**

---

## 15. Build order (each phase independently testable, flag-gated, dark)

**C0 — Foundations**
1. Prisma enums/models/migration + `prisma generate`.
2. `DeepSeekProvider` + `LlmProvider` union + DI token + per-purpose routing + pricing + kill switch.
3. `FeedModule` + boot spec; register in `app.module.ts`.
4. `FeedModerationService` (fail-closed) + fake-provider spec.
5. Flags in both settings registries.
6. `NotificationLinkedType` extensions + event methods + `notification-module.ts` mapping.
7. Admin queue backend + `AdminAlert` types.
8. Verify: type-checks, both suites, backend boots with feed disabled (all routes 404/empty).

**C1 — Feed core (members-only)**
9. Feed reads/writes in `FeedService`; controllers with guards/throttles; DTOs.
10. Filter predicate wired into feed + search from day one.
11. Image upload/delete via Cloudinary.
12. Frontend: `/community` gate + feed, post detail, composer, comments, likes, follows, profile, preferences; `community-api.ts`; nav entry.
13. Verify: create/like/comment/follow/filter end to end locally.

**C2 — Growth & safety**
14. Share cards + generic metadata + `noindex`.
15. Report flow + community guidelines page + AUP update.
16. Graphic blur / tap-to-reveal + `feed_graphic_blur_forced`.
17. Verify.

**C3 — Commerce (featured ads) — BUILT FRESH**
18. Operator decided **build fresh** (not the orphaned `FeaturedSlot*`). Done: `FeedAd` model + `FeedAdsService` + admin CRUD, feed serving/interleaving with a "Sponsored" label, click tracking, `feed_ads_enabled` flag. Ads promote a seller's `Listing` (`FeedAd.listingId`); the seller toggles "Feature in feed" from **My Listings** (`/api/community/listings/:id/feature`), capped at 3 active per seller. Admin page at `/admin/desk/community`. ⚠️ **Pricing model is still to be decided** — featuring is free today; when built it becomes a paid placement (likely created only after payment, or with an admin-approved credit).

**C4 — Groups + awards**
19. Topic/group model + membership; add `feedMutedTopicIds` column and wire it.
20. Cosmetic points/levels/badges (never prize-draw entries).

---

## 16. Deferred / open items

1. **DeepSeek sub-processor / cross-border privacy wording** — before go-live; the feed sends member photos and text to DeepSeek (China). Handle in the privacy audit.
2. **Featured ads** — future; decide whether to reuse the orphaned `FeaturedSlot` models or build fresh.
3. **Free-text keyword muting** — deferred; tags-only for MVP.
4. **Generated OG card image** — MVP uses `/og-default.jpg`; a per-post generated card is a later polish.
5. **Meilisearch `posts` index** — deferred; Prisma search for MVP.

---

## 17. Environment variables (new)

| Variable | Purpose | Required |
|---|---|---|
| `DEEPSEEK_API_KEY` | DeepSeek provider key | For feed moderation |
| `LLM_PROVIDER_FEED_MODERATION` | Routes `feed.moderation` to `deepseek`; set to `gemini` to kill-switch | Optional (default follows `LLM_PROVIDER`) |
| `LLM_MODEL_VIDEO_MODERATION` | Model for `feed.moderation.video`; defaults to `gemini-3.1-flash-lite` | Optional |

### Video moderation

`feed.moderation.video` is a **separate purpose pinned to Gemini** (video input
is Gemini-only here; DeepSeek's vision path rejects video). It defaults to
**`gemini-3.1-flash-lite`**, overridable with `LLM_MODEL_VIDEO_MODERATION` —
if a key does not serve that id, set it to a video-capable model such as
`gemini-3.5-flash-lite`. A post with a video has its clip inlined for the
model; clips above ~18 MB (Gemini's inline-data ceiling) fall back to the
**poster frame**, and a clip that cannot be read at all holds the post for
review. `LlmPart` gained a `video` part; Anthropic and DeepSeek both refuse it.

⚠️ `gemini-3.1-flash-lite` is **not yet in `llm.pricing.ts`**, so its calls are
recorded with cost 0 in the `AiUsage` ledger until the model's real rate is
confirmed — the provider/model/latency are still recorded.

Never commit values. `.env` only.

## 18. My community control centre

Members manage their own posts from two places, added together:

**Right rail on `/community` (and the homepage Community tab).** The feed is
the left ~75% of a `lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]` grid;
`MyControlPanel` fills the remaining ~25% as a `lg:sticky` aside. On mobile the
grid collapses and the panel moves **above** the feed (`order-1` vs `order-2`)
— a sidebar stacked below an infinite feed is never found. The rail is a
*summary*: a red **Create Post** button, the member's picture + name (with a
Manage link), a four-up stat row, the latest five posts with a status pill and
inline delete, a "still being checked" nudge when `pendingCount > 0`, and quick
links (filters, groups, notifications).

**Composer lives in the rail, not the feed** (operator, 2026-09-22). The old
"Share something with the community…" button is gone from the feed; the red
**Create Post** button opens the one `PostComposer` in a modal. On success the
rail dispatches a `gg:feed-refresh` window event that the sibling `FeedClient`
listens for (they are separate client components). `PostComposer` is now
controlled (`open` / `onOpenChange`); its built-in trigger was removed.

**Removed (operator, 2026-09-22):** the leaderboard (page, client, API helper,
and both links), the user's **level** badge/points strip, and the row of red
links above the panel on `/community`.

**Profile picture — `feedShowAvatar` (default ON).** Shown in the rail and on
every post/comment/profile. A member can turn it off under Feed settings; when
off the API returns a `null` avatarUrl for that member and the UI falls back to
the username initial. `User.feedShowAvatar Boolean @default(true)` (migration
`20260922120000_feed_show_avatar`), gated in `shapePost` (author select) and
`getProfile`, exposed in `getPreferences`/`setPreferences` and `mySummary`.

**Full page `/community/me`** (`MyPostsClient`). Every post the member
authored, any status, newest first, with **All / Live / Processing / Blocked**
tabs, per-row Edit / Delete / View, and a modal editor (title, body, tags).
Reached from the rail's "Manage"/deep links; the ⋯ menu on a member's own
`PostCard` deep-links straight to `?edit=<id>` (opened once — a save reload
must not reopen the modal).

Backend:
- `GET /community/me/posts` — the member's own posts, every status,
  cursor-paginated (`before`), same shape as the feed. **Not** filtered by the
  member's own mute list: you must be able to manage what you muted.
- `GET /community/me/summary` — username, avatar (gated), and
  posts/comments/followers/following counts + `pendingCount` (posts not
  `PUBLISHED`).
- `PATCH /community/posts/:id` now **re-moderates in the background**, exactly
  like `submitPost`: it sets `PENDING_MODERATION` + `moderatedAt = null` and
  fires `runModeration`. Until the verdict lands the post is hidden from
  everyone but its author (fail-closed) and the author sees "Processing". The
  cheap `assertTextAllowed` keyword block stays synchronous so the UI can show
  a 400 inline.
- `PostCard` gained optional `onEditPost` / `onDeletePost`; the ⋯ menu renders
  them only on the viewer's own post.

⚠️ Behaviour change: editing a **published** post now hides it from other
members until it is re-approved (previously the edit was moderated inline and
stayed live). This is deliberate and fail-closed; `publishedAt` is preserved so
a passing re-review does not double-award points or re-notify.

Frontend pieces: `components/community/my-control-panel.tsx` (rail + the
exported `postStatusMeta`), `components/community/my-posts-client.tsx`,
`app/community/me/page.tsx` (wraps the client in `Suspense` for the
`useSearchParams` deep link), plus `updatePost` / `deletePost` /
`fetchMyPosts` / `fetchMySummary` in `lib/community-api.ts`.
