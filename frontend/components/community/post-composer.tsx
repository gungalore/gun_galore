'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import {
  type FeedGroup,
  createPost,
  fetchGroups,
  submitPost,
  uploadPostImage,
  uploadPostVideo,
} from '../../lib/community-api';
import { processImage } from '../../lib/process-image';
import { POST_TYPE_LABELS, POST_TYPE_ORDER, type PostTypeKey } from '../../lib/post-types';

interface Picked {
  file: File;
  url: string;
}

const MAX_IMAGES = 6;

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
  const [groups, setGroups] = useState<FeedGroup[]>([]);
  const [groupId, setGroupId] = useState('');

  useEffect(() => {
    if (!open || groups.length) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetchGroups(token);
        if (!cancelled) setGroups(res.groups);
      } catch {
        /* groups are optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, groups.length, getToken]);

  function pickImages(list: FileList | null) {
    images.forEach((i) => URL.revokeObjectURL(i.url));
    const next = Array.from(list ?? [])
      .slice(0, MAX_IMAGES)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setImages(next);
  }

  function pickVideo(list: FileList | null) {
    if (video) URL.revokeObjectURL(video.url);
    const file = list?.[0];
    setVideo(file ? { file, url: URL.createObjectURL(file) } : null);
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
    setImages([]);
    setVideo(null);
  }

  async function submit() {
    if (!body.trim() || busy) return;
    setBusy(true);
    setMessage(null);
    setPhase(null);
    try {
      const token = await getToken();
      if (!token) {
        setMessage('Please sign in again.');
        return;
      }
      const tagList = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const created = await createPost(token, {
        type,
        title: title.trim() || undefined,
        body: body.trim(),
        tags: tagList.length ? tagList : undefined,
        groupId: groupId || undefined,
      });

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
      setMessage(
        e instanceof Error && e.message.includes('400')
          ? 'That post was blocked by our moderation rules.'
          : 'Something went wrong posting. Please try again.',
      );
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
        {groups.length > 0 && (
          <select
            value={groupId}
            onChange={(e) => setGroupId(e.target.value)}
            className="px-2 py-2 rounded-[6px] text-[13px]"
            style={{
              background: 'var(--bg-inset)',
              border: '0.5px solid var(--border)',
              color: 'var(--text-primary)',
            }}
          >
            <option value="">No group</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
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

      <div className="flex gap-3 flex-wrap mb-3">
        <label className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Photos (up to {MAX_IMAGES})
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={(e) => pickImages(e.target.files)}
            className="block mt-1 text-[12px]"
            style={{ color: 'var(--text-secondary)' }}
          />
        </label>
        <label className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
          Video (one)
          <input
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            disabled={busy}
            onChange={(e) => pickVideo(e.target.files)}
            className="block mt-1 text-[12px]"
            style={{ color: 'var(--text-secondary)' }}
          />
        </label>
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
