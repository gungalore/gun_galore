'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import {
  CommunityApiError,
  createPost,
  deletePost,
  submitPost,
  uploadPostImage,
  uploadPostVideo,
  type PostDetailPayload,
} from '../../lib/community-api';
import { processImage } from '../../lib/process-image';
import { POST_TYPE_LABELS, POST_TYPE_ORDER, type PostTypeKey } from '../../lib/post-types';
import {
  buildDetailPayload,
  chipLabel,
  detailFieldsFor,
  memoryKey,
  readDetailMemory,
  writeDetailMemory,
  type DetailValue,
  type PostFieldDef,
} from '../../lib/post-fields';
import FilePickerButton from '../file-picker-button';

declare global {
  interface Window {
    google?: {
      maps?: {
        places?: {
          Autocomplete: new (
            input: HTMLInputElement,
            opts?: Record<string, unknown>,
          ) => {
            addListener: (event: string, handler: () => void) => void;
            getPlace: () => {
              name?: string;
              formatted_address?: string;
              place_id?: string;
              address_components?: Array<{
                long_name: string;
                short_name: string;
                types: string[];
              }>;
            };
          };
        };
      };
    };
  }
}

interface Picked {
  file: File;
  url: string;
}

/**
 * The label stored on the post: the place name plus its town, and nothing more
 * ("Hunting Lodge, Swartruggens") — no street, postal code or country. Falls
 * back down the address hierarchy when a place has no name (a bare area pick).
 */
export function placeLabel(place: {
  name?: string;
  address_components?: Array<{ long_name: string; types: string[] }>;
}): string {
  const comps = place.address_components ?? [];
  const part = (type: string) =>
    comps.find((c) => c.types.includes(type))?.long_name?.trim() ?? '';
  const name = (place.name ?? '').trim();
  const town =
    part('locality') ||
    part('postal_town') ||
    part('administrative_area_level_2') ||
    part('sublocality_level_1') ||
    part('administrative_area_level_1');
  if (name && town && name.toLowerCase() !== town.toLowerCase()) {
    return `${name}, ${town}`;
  }
  return name || town;
}

const MAX_IMAGES = 6;

/**
 * Mirrors `FEED_MAX_VIDEO_BYTES` in `backend/src/feed/feed.types.ts`. Checked
 * here so an over-size clip is refused with a clear message BEFORE a post row
 * is created — otherwise the post is created, the upload 400s, and the
 * moderation sweep later publishes an orphan with no video.
 */
const MAX_VIDEO_MB = 64;
const MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024;

/** Turn a failed create/upload into a message that names the actual problem. */
function describePostError(e: unknown): string {
  if (e instanceof CommunityApiError) {
    if (e.status === 401) return 'Your session expired — please sign in again.';
    if (e.status === 429) {
      return 'Too many attempts just now — please wait a moment and try again.';
    }
    if (e.status === 413 || /file size|too large|maximum/i.test(e.message)) {
      return `That video is too large. The maximum is ${MAX_VIDEO_MB} MB — please trim or compress it.`;
    }
    if (/expected type|file type/i.test(e.message)) {
      return 'That video format is not supported. Please use MP4, MOV or WebM.';
    }
    if (e.status === 404) {
      // The community API is missing on this server — almost always a backend
      // that has not been deployed yet. Say so honestly instead of the generic
      // "something went wrong", which reads as a user error.
      return 'Community is temporarily unavailable — please try again shortly.';
    }
    if (e.status === 400) {
      return 'That post was blocked by our moderation rules.';
    }
    if (e.status >= 500) {
      return 'The server had a problem posting. Please try again.';
    }
    return 'Something went wrong posting. Please try again.';
  }
  return 'Something went wrong posting. Please try again.';
}

const fieldInput = {
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-primary)',
} as const;

/** One optional detail control, rendered by `kind`. */
function DetailField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: PostFieldDef;
  value: DetailValue | undefined;
  disabled: boolean;
  onChange: (key: string, value: DetailValue) => void;
}) {
  const asString = typeof value === 'string' ? value : '';
  const asNumber =
    typeof value === 'number' ? value : typeof value === 'string' ? value : '';

  let control: ReactNode = null;
  if (field.kind === 'chips') {
    const selected = Array.isArray(value) ? value : [];
    control = (
      <div className="flex flex-wrap gap-1.5">
        {(field.options ?? []).map((opt) => {
          const on = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() =>
                onChange(
                  field.key,
                  on ? selected.filter((v) => v !== opt) : [...selected, opt].slice(0, 8),
                )
              }
              className="gg-press px-2.5 py-1 rounded-full text-[12px]"
              style={{
                background: on ? 'var(--red)' : 'var(--bg-inset)',
                color: on ? '#fff' : 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
              }}
            >
              {chipLabel(opt)}
            </button>
          );
        })}
      </div>
    );
  } else if (field.kind === 'single') {
    control = (
      <select
        value={asString}
        disabled={disabled}
        onChange={(e) => onChange(field.key, e.target.value)}
        className="w-full px-2 py-2 rounded-[6px] text-[13px]"
        style={fieldInput}
      >
        <option value="">—</option>
        {(field.options ?? []).map((opt) => (
          <option key={opt} value={opt}>
            {chipLabel(opt)}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === 'number') {
    control = (
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          min={field.min}
          max={field.max}
          value={asNumber}
          disabled={disabled}
          onChange={(e) =>
            onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))
          }
          className="w-28 px-2 py-2 rounded-[6px] text-[13px]"
          style={fieldInput}
        />
        {field.suffix && (
          <span className="text-[12px]" style={{ color: 'var(--text-tertiary)' }}>
            {field.suffix}
          </span>
        )}
      </div>
    );
  } else if (field.kind === 'rating') {
    control = (
      <div className="flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = typeof value === 'number' && value >= n;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              aria-label={`${n} star${n > 1 ? 's' : ''}`}
              aria-pressed={typeof value === 'number' && value === n}
              onClick={() => onChange(field.key, value === n ? '' : n)}
              className="gg-press"
              style={{
                color: active ? 'var(--red)' : 'var(--text-tertiary)',
                fontSize: 20,
                lineHeight: 1,
              }}
            >
              ★
            </button>
          );
        })}
      </div>
    );
  } else if (field.kind === 'date') {
    control = (
      <input
        type="date"
        value={asString}
        disabled={disabled}
        onChange={(e) => onChange(field.key, e.target.value)}
        className="px-2 py-2 rounded-[6px] text-[13px]"
        style={fieldInput}
      />
    );
  } else {
    control = (
      <input
        value={asString}
        maxLength={field.max}
        placeholder={field.placeholder}
        disabled={disabled}
        onChange={(e) => onChange(field.key, e.target.value)}
        className="w-full px-2 py-2 rounded-[6px] text-[13px]"
        style={fieldInput}
      />
    );
  }

  return (
    <div>
      <div className="text-[12px] mb-1" style={{ color: 'var(--text-tertiary)' }}>
        {field.label}
      </div>
      {control}
      {field.hint && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
          {field.hint}
        </p>
      )}
    </div>
  );
}

export function PostComposer({
  onPosted,
  open: openProp,
  onOpenChange,
  defaultOpen = false,
}: {
  onPosted: () => void;
  /** Controlled open state. When provided, no built-in trigger is rendered. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  defaultOpen?: boolean;
}) {
  const { getToken } = useAuth();
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = controlled ? !!openProp : internalOpen;
  const setOpen = (v: boolean) => {
    if (controlled) onOpenChange?.(v);
    else setInternalOpen(v);
  };
  const [type, setType] = useState<PostTypeKey>('GENERAL');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [images, setImages] = useState<Picked[]>([]);
  const [video, setVideo] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // `place` is what the location input SHOWS (the full text Google returned).
  // `location` is the short label stored on the post ("Place, Town"). They
  // differ on purpose: the box mirrors the pick, the post stays tidy.
  const [place, setPlace] = useState('');
  const [location, setLocation] = useState('');
  const [placeId, setPlaceId] = useState('');
  const placeRef = useRef<HTMLInputElement>(null);
  // Optional per-category details, remembered across posts (keyed
  // `${type}:${field}`) so the one-tap chips never have to be re-picked.
  const [details, setDetails] = useState<Record<string, DetailValue>>({});
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    setDetails(readDetailMemory());
  }, []);

  function updateDetail(key: string, value: DetailValue) {
    setDetails((prev) => {
      const next = { ...prev, [memoryKey(type, key)]: value };
      writeDetailMemory(next);
      return next;
    });
  }

  useEffect(() => {
    if (!open || !placeRef.current || !window.google?.maps?.places) return;
    // The post shows place name + town only (no street/postal/country); the
    // input shows the full formatted text so the member sees what they picked.
    // place_id is kept so the post's location link opens THAT exact place.
    const autocomplete = new window.google.maps.places.Autocomplete(placeRef.current, {
      fields: ['name', 'formatted_address', 'place_id', 'address_components'],
      componentRestrictions: { country: 'za' },
    });
    autocomplete.addListener('place_changed', () => {
      const selected = autocomplete.getPlace();
      const full = (selected.formatted_address ?? '').trim();
      const short = placeLabel(selected) || full;
      setPlace(full || short);
      setLocation(short);
      setPlaceId(selected.place_id ?? '');
    });
  }, [open]);

  function pickImages(files: File[]) {
    images.forEach((i) => URL.revokeObjectURL(i.url));
    const next = files
      .slice(0, MAX_IMAGES)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setImages(next);
  }

  function pickVideo(files: File[]) {
    if (video) URL.revokeObjectURL(video.url);
    const file = files[0];
    if (!file) {
      setVideo(null);
      return;
    }
    // Refuse an over-size clip up front — see MAX_VIDEO_BYTES.
    if (file.size > MAX_VIDEO_BYTES) {
      setVideo(null);
      setMessage(
        `That video is ${(file.size / (1024 * 1024)).toFixed(0)} MB. The maximum is ${MAX_VIDEO_MB} MB — please trim or compress it.`,
      );
      return;
    }
    setMessage(null);
    setVideo({ file, url: URL.createObjectURL(file) });
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const copy = [...prev];
      const [gone] = copy.splice(index, 1);
      if (gone) URL.revokeObjectURL(gone.url);
      return copy;
    });
  }

  function removeVideo() {
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null);
  }

  function reset() {
    images.forEach((i) => URL.revokeObjectURL(i.url));
    if (video) URL.revokeObjectURL(video.url);
    setTitle('');
    setBody('');
    setTags('');
    setPlace('');
    setLocation('');
    setPlaceId('');
    setImages([]);
    setVideo(null);
  }

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    setPhase(null);
    let token: string | null = null;
    let createdId: string | null = null;
    try {
      token = await getToken();
      if (!token) {
        setMessage('Please sign in again.');
        return;
      }
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const detailPayload = buildDetailPayload(type, details) as PostDetailPayload;
      const created = await createPost(token, {
        type,
        title: title.trim() || undefined,
        body: body.trim(),
        tags: tagList.length ? tagList : undefined,
        location: location || undefined,
        locationPlaceId: placeId || undefined,
        ...detailPayload,
      });
      createdId = created.post.id;

      const total = images.length + (video ? 1 : 0);
      let done = 0;
      for (const item of images) {
        setPhase(`Uploading media… ${done + 1}/${total}`);
        const processed = await processImage(item.file).catch(() => item.file);
        await uploadPostImage(token, created.post.id, processed);
        done += 1;
      }
      if (video) {
        setPhase(`Uploading media… ${done + 1}/${total}`);
        await uploadPostVideo(token, created.post.id, video.file);
      }

      setPhase('Reviewing…');
      // Background moderation: the API queues the post and returns at once.
      await submitPost(token, created.post.id);
      reset();
      setNotice(
        "Upload complete — we're checking it now and it will appear on your feed automatically.",
      );
      onPosted();
    } catch (e) {
      // A post row may already exist when a media upload fails. Remove it: the
      // moderation sweep would otherwise publish it a couple of minutes later
      // WITHOUT the photos/video the member attached, which reads as "the post
      // is up but the video never made it".
      if (createdId && token) {
        await deletePost(token, createdId).catch(() => {
          /* best effort — nothing more we can do */
        });
      }
      setMessage(describePostError(e));
    } finally {
      setBusy(false);
      setPhase(null);
    }
  }

  if (!open) {
    // The composer has no built-in trigger any more (operator, 2026-09-22):
    // it is opened from the red "Create Post" button in the My panel, so the
    // old "Share something with the community…" button is gone.
    return null;
  }

  if (open && notice) {
    return (
      <div
        className="gg-tile rounded-[8px] p-4"
        style={{
          background: 'var(--bg-card)',
          border: '0.5px solid var(--border)',
        }}
      >
        <p className="text-[14px] mb-3" style={{ color: 'var(--text-primary)' }}>
          {notice}
        </p>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setOpen(false);
            }}
            className="gg-press px-4 py-2 rounded-[6px] text-[13px]"
            style={{
              background: 'var(--bg-card)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-secondary)',
            }}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="gg-tile rounded-[8px] p-4"
      style={{
        background: 'var(--bg-card)',
        border: '0.5px solid var(--border)',
      }}
    >
      <div className="flex gap-2 mb-3 flex-wrap">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PostTypeKey)}
          className="px-2 py-2 rounded-[6px] text-[13px]"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-primary)',
          }}
        >
          {POST_TYPE_ORDER.map((t) => (
            <option key={t} value={t}>
              {POST_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        maxLength={140}
        className="w-full px-3 py-2 rounded-[6px] text-[14px] mb-2"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What's on your mind?"
        rows={4}
        maxLength={5000}
        className="w-full px-3 py-2 rounded-[6px] text-[14px] mb-2 resize-y"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="Tags, comma separated (e.g. biltong, gauteng)"
        className="w-full px-3 py-2 rounded-[6px] text-[13px] mb-2"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />
      <input
        ref={placeRef}
        value={place}
        onChange={(e) => {
          // Editing the text invalidates the picked place — drop its id so we
          // never link a stale place to a name the member has changed. Typed
          // text becomes the post label verbatim.
          setPlace(e.target.value);
          setLocation(e.target.value);
          setPlaceId('');
        }}
        placeholder="Place or area (optional)"
        className="w-full px-3 py-2 rounded-[6px] text-[13px] mb-3"
        style={{
          background: 'var(--bg-inset)',
          border: '0.5px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />

      <div className="mb-3">
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          disabled={busy}
          aria-expanded={detailsOpen}
          className="gg-press px-3 py-1.5 rounded-[6px] text-[12px]"
          style={{
            background: 'var(--bg-inset)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          {detailsOpen ? '− Hide details' : '+ Add details (optional)'}
        </button>
        {detailsOpen && (
          <div className="mt-2 flex flex-col gap-3">
            <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              Optional — these help people find, filter and understand your post. Your
              choices are remembered for next time.
            </p>
            {detailFieldsFor(type).map((field) => (
              <DetailField
                key={field.key}
                field={field}
                value={details[memoryKey(type, field.key)]}
                disabled={busy}
                onChange={updateDetail}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-3 flex-wrap mb-3">
        <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          <span>Photos (up to {MAX_IMAGES})</span>
          <div className="mt-1">
            <FilePickerButton
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={busy}
              onFiles={pickImages}
            >
              Choose photos
            </FilePickerButton>
          </div>
        </div>
        <div className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          <span>Video (one, up to {MAX_VIDEO_MB} MB)</span>
          <div className="mt-1">
            <FilePickerButton
              accept="video/mp4,video/quicktime,video/webm"
              disabled={busy}
              onFiles={pickVideo}
            >
              Choose video
            </FilePickerButton>
          </div>
        </div>
      </div>

      {/* Live preview of what will be posted, as it is attached. */}
      {(images.length > 0 || video) && (
        <div className="mb-3" data-media-preview>
          <div className="text-[12px] mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Preview
          </div>
          <div className="flex flex-wrap gap-2">
            {video && (
              <div className="relative" style={{ width: 160 }}>
                <video
                  src={video.url}
                  className="rounded-[6px] w-full"
                  style={{ maxHeight: 160, background: 'var(--bg-inset)' }}
                  muted
                  playsInline
                />
                <button
                  type="button"
                  aria-label="Remove video"
                  onClick={removeVideo}
                  disabled={busy}
                  className="absolute top-1 right-1 rounded-full text-[11px] leading-none px-1.5 py-1"
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                >
                  ✕
                </button>
              </div>
            )}
            {images.map((img, i) => (
              <div key={img.url} className="relative" style={{ width: 96 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt=""
                  className="rounded-[6px] w-full object-cover"
                  style={{ height: 96, background: 'var(--bg-inset)' }}
                />
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => removeImage(i)}
                  disabled={busy}
                  className="absolute top-1 right-1 rounded-full text-[11px] leading-none px-1.5 py-1"
                  style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {phase && (
        <p className="text-[13px] mb-2" style={{ color: 'var(--text-secondary)' }}>
          {phase}
        </p>
      )}
      {message && (
        <p className="text-[13px] mb-2" style={{ color: 'var(--text-secondary)' }}>
          {message}
        </p>
      )}

      <p className="text-[11px] mb-2" style={{ color: 'var(--text-tertiary)' }}>
        No advertising or selling. By posting you agree to the{' '}
        <Link href="/community-guidelines" style={{ color: 'var(--red)' }}>
          Community Guidelines
        </Link>
        .
      </p>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="gg-press px-4 py-2 rounded-[6px] text-[13px]"
          style={{
            background: 'var(--bg-card)',
            border: '0.5px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !body.trim()}
          className="gg-press px-4 py-2 rounded-[6px] text-[13px] font-medium"
          style={{
            background: 'var(--red)',
            color: '#fff',
            opacity: busy || !body.trim() ? 0.6 : 1,
          }}
        >
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}
