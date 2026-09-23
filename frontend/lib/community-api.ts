// Typed client for the community feed API. Mirrors lib/users-api.ts: the token
// is fetched INSIDE each call, every read is `no-store`, and errors carry the
// HTTP status so the UI can distinguish "disabled" (404) from a real failure.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export class CommunityApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'CommunityApiError';
  }
}

export interface FeedAuthor {
  id: string;
  username: string;
  avatarUrl: string | null;
  sellerTier?: string | null;
  isVerifiedExpert?: boolean;
}

export interface FeedImage {
  id: string;
  url: string;
  order: number;
}

export type GraphicTier = 'NONE' | 'FIELD' | 'EXTREME';

export interface FeedPost {
  id: string;
  type: string;
  title: string | null;
  body: string;
  tags: string[];
  graphicTier: GraphicTier;
  isOfficial: boolean;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  editedAt: string | null;
  author: FeedAuthor;
  images: FeedImage[];
  video: {
    id: string;
    url: string;
    /** Compressed delivery URL for playback (audio kept). */
    playbackUrl: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
  } | null;
  listing: {
    id: string;
    title: string;
    price: number | null;
    listingType: string;
  } | null;
  group: { id: string; slug: string; name: string } | null;
  liked: boolean;
  muted?: boolean;
  /** Only meaningful on the author's own not-yet-live posts. */
  moderationState?: 'PROCESSING' | 'IN_REVIEW' | 'BLOCKED' | 'PUBLISHED';
  moderationReason?: string | null;
  canDispute?: boolean;
  disputed?: boolean;
}

export interface FeedComment {
  id: string;
  parentId: string | null;
  body: string;
  likeCount: number;
  createdAt: string;
  liked: boolean;
  author: { id: string; username: string; avatarUrl: string | null };
}

export interface FeedPage {
  posts: FeedPost[];
  nextBefore: string | null;
  includeFiltered: boolean;
  ads?: FeedAd[];
}

export interface FeedAd {
  id: string;
  title: string;
  body: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string;
  advertiser: string | null;
  listing: {
    id: string;
    title: string;
    price: number | null;
    listingType: string;
    imageUrl: string | null;
  } | null;
}

export interface FeedPreferences {
  feedMutedPostTypes: string[];
  feedMutedAuthorIds: string[];
  feedMutedTags: string[];
  feedMutedTopicIds: string[];
  /** Show the member's profile picture in the community. Default on. */
  feedShowAvatar: boolean;
  /** Show graphic content (hunting, fishing, etc.) in the feed. Default on. */
  feedShowGraphic: boolean;
}

async function jsonFetch<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CommunityApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export function fetchFeed(
  token: string,
  opts: { before?: string; type?: string; includeFiltered?: boolean } = {},
): Promise<FeedPage> {
  const qs = new URLSearchParams();
  if (opts.before) qs.set('before', opts.before);
  if (opts.type) qs.set('type', opts.type);
  if (opts.includeFiltered) qs.set('includeFiltered', 'true');
  const q = qs.toString();
  return jsonFetch(`/community/feed${q ? `?${q}` : ''}`, token);
}

export function fetchPost(
  token: string,
  id: string,
): Promise<{ post: FeedPost; comments: FeedComment[] }> {
  return jsonFetch(`/community/posts/${id}`, token);
}

export function fetchProfile(
  token: string,
  username: string,
): Promise<{
  profile: {
    id: string;
    username: string;
    avatarUrl: string | null;
    sellerTier: string | null;
    isVerifiedExpert: boolean;
    memberSince: string;
  };
  isFollowing: boolean;
  followerCount: number;
  followingCount: number;
  points: number;
  level: string;
  postCount: number;
  commentCount: number;
  posts: FeedPost[];
}> {
  return jsonFetch(`/community/users/${encodeURIComponent(username)}`, token);
}

export function createPost(
  token: string,
  body: {
    type: string;
    title?: string;
    body: string;
    tags?: string[];
    groupId?: string;
    location?: string;
  },
): Promise<{ post: FeedPost; moderation: { decision: string; reasons: string[] } }> {
  return jsonFetch('/community/posts', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function submitPost(
  token: string,
  postId: string,
): Promise<{ post: FeedPost; moderation: { decision: string; reasons: string[] } }> {
  return jsonFetch(`/community/posts/${postId}/submit`, token, {
    method: 'POST',
  });
}

/** Edit a post. Text only for now; media is managed separately. Re-moderated
 *  in the background, so the returned post is in `PROCESSING`. */
export function updatePost(
  token: string,
  id: string,
  body: { title?: string; body?: string; tags?: string[] },
): Promise<{ post: FeedPost }> {
  return jsonFetch(`/community/posts/${id}`, token, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

/** Delete one of the member's own posts (and its Cloudinary media). */
export function deletePost(
  token: string,
  id: string,
): Promise<{ deleted: boolean }> {
  return jsonFetch(`/community/posts/${id}`, token, { method: 'DELETE' });
}

export interface MySummary {
  username: string;
  /** Own profile picture; null when the member turned it off. */
  avatarUrl: string | null;
  postCount: number;
  commentCount: number;
  followerCount: number;
  followingCount: number;
  points: number;
  level: string;
  /** Posts not yet live (processing / in review / blocked). */
  pendingCount: number;
}

/** The member's own posts, every status, newest first. */
export function fetchMyPosts(
  token: string,
  opts: { before?: string; limit?: number } = {},
): Promise<{ posts: FeedPost[]; nextBefore: string | null }> {
  const qs = new URLSearchParams();
  if (opts.before) qs.set('before', opts.before);
  if (opts.limit) qs.set('limit', String(opts.limit));
  const q = qs.toString();
  return jsonFetch(`/community/me/posts${q ? `?${q}` : ''}`, token);
}

export function fetchMySummary(token: string): Promise<MySummary> {
  return jsonFetch('/community/me/summary', token);
}

export async function uploadPostImage(
  token: string,
  postId: string,
  file: File,
): Promise<{ image: FeedImage }> {
  const fd = new FormData();
  fd.append('image', file);
  const res = await fetch(`${API_URL}/community/posts/${postId}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CommunityApiError(res.status, body);
  }
  return (await res.json()) as { image: FeedImage };
}

/** One video per post; re-uploading replaces it. */
export async function uploadPostVideo(
  token: string,
  postId: string,
  file: File,
): Promise<{
  video: {
    id: string;
    url: string;
    thumbnailUrl: string | null;
    durationSeconds: number | null;
  };
}> {
  const fd = new FormData();
  fd.append('video', file);
  const res = await fetch(`${API_URL}/community/posts/${postId}/video`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new CommunityApiError(res.status, body);
  }
  return (await res.json()) as {
    video: {
      id: string;
      url: string;
      thumbnailUrl: string | null;
      durationSeconds: number | null;
    };
  };
}

export function removePostVideo(
  token: string,
  postId: string,
): Promise<{ deleted: boolean }> {
  return jsonFetch(`/community/posts/${postId}/video`, token, {
    method: 'DELETE',
  });
}

export function likePost(token: string, id: string): Promise<{ liked: boolean }> {
  return jsonFetch(`/community/posts/${id}/like`, token, { method: 'POST' });
}

export function unlikePost(token: string, id: string): Promise<{ liked: boolean }> {
  return jsonFetch(`/community/posts/${id}/like`, token, { method: 'DELETE' });
}

export function likeComment(
  token: string,
  id: string,
): Promise<{ liked: boolean }> {
  return jsonFetch(`/community/comments/${id}/like`, token, { method: 'POST' });
}

export function addComment(
  token: string,
  postId: string,
  body: string,
  parentId?: string,
): Promise<{ comment: FeedComment; moderation: { decision: string; reasons: string[] } }> {
  return jsonFetch(`/community/posts/${postId}/comments`, token, {
    method: 'POST',
    body: JSON.stringify({ body, parentId }),
  });
}

export function followUser(
  token: string,
  id: string,
): Promise<{ following: boolean }> {
  return jsonFetch(`/community/users/${id}/follow`, token, { method: 'POST' });
}

export function unfollowUser(
  token: string,
  id: string,
): Promise<{ following: boolean }> {
  return jsonFetch(`/community/users/${id}/follow`, token, { method: 'DELETE' });
}

export function fetchPreferences(token: string): Promise<FeedPreferences> {
  return jsonFetch('/community/preferences', token);
}

export function savePreferences(
  token: string,
  prefs: Partial<FeedPreferences>,
): Promise<FeedPreferences> {
  return jsonFetch('/community/preferences', token, {
    method: 'PUT',
    body: JSON.stringify(prefs),
  });
}

export interface FeedConfig {
  graphicBlurForced: boolean;
  gateEnabled: boolean;
  adsEnabled: boolean;
}

export function fetchConfig(token: string): Promise<FeedConfig> {
  return jsonFetch('/community/config', token);
}

export function reportPost(
  token: string,
  id: string,
  reason?: string,
  note?: string,
): Promise<{ reported: boolean }> {
  return jsonFetch(`/community/posts/${id}/report`, token, {
    method: 'POST',
    body: JSON.stringify({ reason, note }),
  });
}

export function reportComment(
  token: string,
  id: string,
  reason?: string,
  note?: string,
): Promise<{ reported: boolean }> {
  return jsonFetch(`/community/comments/${id}/report`, token, {
    method: 'POST',
    body: JSON.stringify({ reason, note }),
  });
}

export function disputePost(
  token: string,
  postId: string,
  note?: string,
): Promise<{ disputed: boolean; message: string }> {
  return jsonFetch(`/community/posts/${postId}/dispute`, token, {
    method: 'POST',
    body: JSON.stringify({ note }),
  });
}

export interface FeedGroup {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  memberCount: number;
  postCount: number;
  joined: boolean;
}

export function fetchGroups(token: string): Promise<{ groups: FeedGroup[] }> {
  return jsonFetch('/community/groups', token);
}

export function fetchGroup(
  token: string,
  slug: string,
  opts: { before?: string; includeFiltered?: boolean } = {},
): Promise<{
  group: Omit<FeedGroup, 'postCount'>;
  posts: FeedPost[];
  nextBefore: string | null;
  includeFiltered: boolean;
}> {
  const qs = new URLSearchParams();
  if (opts.before) qs.set('before', opts.before);
  if (opts.includeFiltered) qs.set('includeFiltered', 'true');
  const q = qs.toString();
  return jsonFetch(
    `/community/groups/${encodeURIComponent(slug)}${q ? `?${q}` : ''}`,
    token,
  );
}

export function joinGroup(
  token: string,
  id: string,
): Promise<{ joined: boolean }> {
  return jsonFetch(`/community/groups/${id}/join`, token, {
    method: 'POST',
  });
}

export function leaveGroup(
  token: string,
  id: string,
): Promise<{ joined: boolean }> {
  return jsonFetch(`/community/groups/${id}/join`, token, {
    method: 'DELETE',
  });
}

export function recordAdClick(
  token: string,
  id: string,
): Promise<{ url: string }> {
  return jsonFetch(`/community/ads/${id}/click`, token, { method: 'POST' });
}

export function fetchFeatureStatus(
  token: string,
  listingId: string,
): Promise<{ featured: boolean; adsEnabled: boolean }> {
  return jsonFetch(`/community/listings/${listingId}/feature`, token);
}

export function featureListing(
  token: string,
  listingId: string,
): Promise<{ featured: boolean; adId?: string }> {
  return jsonFetch(`/community/listings/${listingId}/feature`, token, {
    method: 'POST',
  });
}

export function unfeatureListing(
  token: string,
  listingId: string,
): Promise<{ featured: boolean }> {
  return jsonFetch(`/community/listings/${listingId}/feature`, token, {
    method: 'DELETE',
  });
}
