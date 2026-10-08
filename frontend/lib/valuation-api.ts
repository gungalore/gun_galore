// Typed client for the Value My Item API. Mirrors lib/community-api.ts: the
// bearer token is fetched by the caller (useAuth().getToken), every read is
// `no-store`, and errors carry the HTTP status.

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export class ValuationApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ValuationApiError';
  }
}

export interface PhotoChecklistItem {
  tag: string;
  label: string;
  priority: number;
  required: boolean;
  hint: string;
}

export interface ValuationImageView {
  id: string;
  url: string;
  viewTag: string | null;
  source: string;
}

export interface ValuationCreateResponse {
  id: string;
  status: string;
  maxPhotos: number;
  photoChecklist: PhotoChecklistItem[];
}

export interface ValuationState {
  id: string;
  status: string;
  description: string | null;
  categorySlug: string | null;
  photoChecklist: PhotoChecklistItem[];
  images: ValuationImageView[];
  identify: unknown | null;
  questions: unknown | null;
  answers: unknown | null;
  researchSteps: { step: string; detail: string; at: string }[];
  result: unknown | null;
  legalFlags: Array<{ flag: string; message: string }>;
}

export interface ValuationPhotoResult {
  image: ValuationImageView & { width: number | null; height: number | null };
  photoCount: number;
  slotsRemaining: number;
  photoChecklist: PhotoChecklistItem[];
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
    throw new ValuationApiError(res.status, body);
  }
  return (await res.json()) as T;
}

export function createValuation(
  token: string,
  description?: string,
): Promise<ValuationCreateResponse> {
  return jsonFetch('/valuations', token, {
    method: 'POST',
    body: JSON.stringify({ description: description || undefined }),
  });
}

export function fetchValuation(
  token: string,
  id: string,
): Promise<ValuationState> {
  return jsonFetch(`/valuations/${id}`, token);
}

export function deleteValuation(token: string, id: string): Promise<void> {
  return jsonFetch(`/valuations/${id}`, token, { method: 'DELETE' });
}

export async function uploadValuationPhoto(
  token: string,
  id: string,
  file: File,
  opts: { viewTag?: string | null; source?: 'DESKTOP' | 'PHONE' } = {},
): Promise<ValuationPhotoResult> {
  const fd = new FormData();
  fd.append('photo', file);
  if (opts.viewTag) fd.append('viewTag', opts.viewTag);
  fd.append('source', opts.source ?? 'DESKTOP');
  // No Content-Type header: the browser sets the multipart boundary.
  const res = await fetch(`${API_URL}/valuations/${id}/photos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ValuationApiError(res.status, body);
  }
  return (await res.json()) as ValuationPhotoResult;
}

export async function deleteValuationPhoto(
  token: string,
  id: string,
  photoId: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/valuations/${id}/photos/${photoId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ValuationApiError(res.status, body);
  }
}

// ── Identify and questions ────────────────────────────────────────────

export interface ServedQuestion {
  id: string;
  text: string;
  type: 'single' | 'multi';
  options: string[];
  allow_custom: boolean;
  allow_unsure: boolean;
  required: boolean;
  hint?: string;
  /** Pre-filled answer (e.g. the make/model we already know) so the member confirms. */
  default?: string;
}

export interface IdentifyResult {
  identify: {
    inScope: boolean;
    views: { received: string[]; missing: string[] };
    identification: {
      categorySlug: string | null;
      make: string | null;
      model: string | null;
      keySpec?: string | null;
      confidence: 'HIGH' | 'MEDIUM' | 'LOW';
      readable: string[];
      unreadable: string[];
      visibleFeatures: string[];
    };
    questions: unknown[];
  };
  questions: ServedQuestion[];
  photoChecklist: PhotoChecklistItem[];
}

export interface SavedAnswer {
  questionId: string;
  selected: string[];
  custom?: string | null;
  unsure: boolean;
}

export interface CompDiff {
  dimension: string;
  itemValue?: string | null;
  compValue?: string | null;
}

export interface ValuationComp {
  kind: 'USED_COMP' | 'RETAIL_ANCHOR' | 'ACCESSORY';
  sourceSite: string;
  url: string;
  model?: string | null;
  condition?: string | null;
  priceZar: number;
  listedDate?: string | null;
  pageOpened: boolean;
  /** Match differences vs the item; empty means same model and spec. */
  match?: { diffs: CompDiff[] };
}

export interface ValuationResult {
  itemSummary: {
    oneLiner: string;
    categorySlug: string;
    make: string | null;
    model: string | null;
    keySpec?: string | null;
    conditionBand: string;
    attributes?: Record<string, string>;
    specSheet: Array<{ label: string; value: string }>;
    accessories?: Array<{ name: string; valueCents?: number | null; note?: string | null }>;
  };
  /** Not sent to the client any more; kept optional for older results. */
  comps?: ValuationComp[];
  pricing: {
    lowZar: number | null;
    midZar: number | null;
    highZar: number | null;
    askingZar: number | null;
    expectedSaleZar: number | null;
    retailAnchorZar?: number | null;
    missingData?: string | null;
  };
  confidence: { level: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string };
  demandNote: string;
  ad: { title: string; bullets: string[]; priceZar: number; description?: string | null };
  unverified: string[];
  /** Three listing tiers by urgency. Empty when there is no firm price. */
  priceScale?: Array<{ key: string; label: string; priceZar: number | null; note: string }>;
  /** The NEW-price retail source (allowed to show). Secondhand sources never are. */
  retailAnchorSource?: { url: string; site: string } | null;
  meta?: Record<string, unknown>;
}

export function identifyValuation(
  token: string,
  id: string,
  description?: string,
): Promise<IdentifyResult> {
  return jsonFetch(`/valuations/${id}/identify`, token, {
    method: 'POST',
    body: JSON.stringify({ description: description || undefined }),
  });
}

export function saveAnswers(
  token: string,
  id: string,
  answers: SavedAnswer[],
): Promise<{ saved: number; total: number; readyForResearch: boolean }> {
  return jsonFetch(`/valuations/${id}/answers`, token, {
    method: 'POST',
    body: JSON.stringify({ answers }),
  });
}

export function startResearch(token: string, id: string): Promise<{ status: string }> {
  return jsonFetch(`/valuations/${id}/research`, token, { method: 'POST' });
}

export function listingDraft(
  token: string,
  id: string,
): Promise<{
  categoryId: string | null;
  categorySlug: string;
  title: string;
  description: string;
  price: number | null;
  listingType: string;
  attributes: Record<string, string>;
  shippingMethods: string[];
}> {
  return jsonFetch(`/valuations/${id}/listing-draft`, token);
}

export function recordOutcome(
  token: string,
  id: string,
  listingId: string,
): Promise<{ ok: boolean }> {
  return jsonFetch(`/valuations/${id}/outcome`, token, {
    method: 'POST',
    body: JSON.stringify({ listingId }),
  });
}

// ── QR capture ────────────────────────────────────────────────────────

export interface CaptureSession {
  token: string;
  url: string;
  expiresAt: string;
}

export function createCaptureSession(
  token: string,
  id: string,
): Promise<CaptureSession> {
  return jsonFetch(`/valuations/${id}/capture-session`, token, { method: 'POST' });
}

export function closeCaptureSession(token: string, id: string): Promise<{ status: string }> {
  return jsonFetch(`/valuations/${id}/capture-session/close`, token, { method: 'POST' });
}

export interface CaptureState {
  status: string;
  expiresAt: string;
  photoCount: number;
  slotsRemaining: number;
  photoChecklist: PhotoChecklistItem[];
  images: ValuationImageView[];
}

export function fetchCaptureState(token: string): Promise<CaptureState> {
  return fetch(`${API_URL}/v/capture/${token}`, { cache: 'no-store' }).then(async (res) => {
    if (!res.ok) throw new ValuationApiError(res.status, await res.text().catch(() => ''));
    return (await res.json()) as CaptureState;
  });
}

export async function uploadCapturePhoto(
  token: string,
  file: File,
): Promise<ValuationPhotoResult> {
  const fd = new FormData();
  fd.append('photo', file);
  const res = await fetch(`${API_URL}/v/capture/${token}/photos`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) throw new ValuationApiError(res.status, await res.text().catch(() => ''));
  return (await res.json()) as ValuationPhotoResult;
}

export async function deleteCapturePhoto(token: string, photoId: string): Promise<void> {
  const res = await fetch(`${API_URL}/v/capture/${token}/photos/${photoId}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new ValuationApiError(res.status, await res.text().catch(() => ''));
}
