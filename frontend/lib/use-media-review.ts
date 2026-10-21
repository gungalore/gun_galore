'use client';

import { useCallback, useRef, useState } from 'react';

export type ImageScreenResult = {
  decision: 'APPROVE' | 'AUTO_FIX_AND_APPROVE' | 'REJECT' | 'HUMAN_REVIEW';
  confidence?: number;
  reasons: string[];
  publicReason?: string;
  categories?: string[];
  photoFlags?: { index: number; categories: string[]; reason: string }[];
};

export type VideoScreenResult = {
  decision: 'APPROVE' | 'REJECT' | 'HUMAN_REVIEW';
  reasons: string[];
  publicReason?: string;
};

export type MediaStatus =
  | 'checking'
  | 'clear'
  | 'needs-fix'
  | 'review'
  | 'blocked'
  | 'error';

export type ImageReview = {
  file: File;
  status: MediaStatus;
  reason?: string;
  categories: string[];
};

export type VideoReview = {
  file: File;
  audioEnabled: boolean;
  status: MediaStatus;
  decision?: VideoScreenResult['decision'];
  reason?: string;
  publicReason?: string;
};

const BLUR_CATEGORIES = new Set([
  'contact-info',
  'photo-contact-info',
  'photo-address',
  'qr-code',
  'advertising',
]);

function blurrable(flags: { categories: string[] }[] | undefined): boolean {
  return (flags ?? []).some((flag) =>
    flag.categories.some((category) => BLUR_CATEGORIES.has(category)),
  );
}

function reasonFor(result: ImageScreenResult): string {
  return (
    result.photoFlags?.[0]?.reason ??
    result.publicReason ??
    result.reasons[0] ??
    'A photo needs a closer look.'
  );
}

/**
 * Early media moderation for the sell/edit forms.
 *
 * The page owns the File[]/File state; this hook owns the screening verdicts,
 * the one-at-a-time fix queue, and the final review flags. Files are keyed by
 * object identity, so replacing or removing one naturally retires its verdict.
 */
export function useMediaReview(
  getToken: () => Promise<string | null>,
  apiUrl: string,
) {
  const [version, setVersion] = useState(0);
  const [queue, setQueue] = useState<File[]>([]);
  const [videoAction, setVideoAction] = useState<'review' | 'delete' | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const imagesRef = useRef(new Map<File, ImageReview>());
  const videoRef = useRef<VideoReview | null>(null);
  const inFlightImages = useRef(new Set<File>());
  const inFlightVideo = useRef(false);
  const blurAttempted = useRef(new Set<File>());
  const videoGeneration = useRef(0);
  const apiRef = useRef(apiUrl);
  apiRef.current = apiUrl;

  const bump = useCallback(() => setVersion((v) => v + 1), []);

  const reviewQueue = useCallback((file: File) => {
    setQueue((prev) => (prev.includes(file) ? prev : [...prev, file]));
  }, []);

  const dropFromQueue = useCallback((file: File) => {
    setQueue((prev) => prev.filter((f) => f !== file));
  }, []);

  const screenImage = useCallback(
    async (file: File, wasBlur = false) => {
      if (inFlightImages.current.has(file)) return;
      inFlightImages.current.add(file);
      if (wasBlur) blurAttempted.current.add(file);
      const existing = imagesRef.current.get(file);
      imagesRef.current.set(file, {
        file,
        status: 'checking',
        reason: existing?.reason,
        categories: existing?.categories ?? [],
      });
      bump();

      try {
        const token = await getToken();
        if (!token) throw new Error('Sign in again to check this photo.');
        const fd = new FormData();
        fd.append('image', file);
        if (wasBlur) fd.append('redacted', 'true');
        const res = await fetch(`${apiRef.current}/listings/image-screen`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as ImageScreenResult & {
          message?: string | string[];
        };
        if (!res.ok) {
          const msg = Array.isArray(data.message)
            ? data.message.join(', ')
            : data.message;
          throw new Error(msg ?? `Error ${res.status}`);
        }

        const flags = data.photoFlags ?? [];
        const categories = Array.from(
          new Set([
            ...(data.categories ?? []),
            ...flags.flatMap((flag) => flag.categories),
          ]),
        );
        if (data.decision === 'APPROVE') {
          imagesRef.current.set(file, { file, status: 'clear', categories: [] });
          dropFromQueue(file);
        } else if (data.decision === 'REJECT' && categories.includes('live-ammo')) {
          imagesRef.current.set(file, {
            file,
            status: 'blocked',
            reason: reasonFor(data),
            categories,
          });
          dropFromQueue(file);
          setNotice(
            'A photo shows live ammunition. Remove or replace it before publishing.',
          );
        } else if (blurAttempted.current.has(file)) {
          // The seller already blurred this file and it still trips. Stop the
          // blur loop; the listing goes to admin review.
          imagesRef.current.set(file, {
            file,
            status: 'review',
            reason: reasonFor(data),
            categories,
          });
          dropFromQueue(file);
          setNotice(
            'We can still see a possible contact detail. This listing will be checked by our team and will not be public until approved.',
          );
        } else if (
          data.decision === 'HUMAN_REVIEW' &&
          !blurrable(flags) &&
          !blurrable([{ categories }])
        ) {
          // Unreadable/unsure but nothing the seller can paint over: the
          // admin has to judge it.
          imagesRef.current.set(file, {
            file,
            status: 'review',
            reason: reasonFor(data),
            categories,
          });
          dropFromQueue(file);
        } else {
          imagesRef.current.set(file, {
            file,
            status: 'needs-fix',
            reason: reasonFor(data),
            categories,
          });
          reviewQueue(file);
        }
      } catch (err) {
        imagesRef.current.set(file, {
          file,
          status: 'error',
          reason:
            err instanceof Error
              ? err.message
              : 'We could not check this photo.',
          categories: [],
        });
      } finally {
        inFlightImages.current.delete(file);
        bump();
      }
    },
    [bump, dropFromQueue, getToken, reviewQueue],
  );

  const screenVideo = useCallback(
    async (file: File, audioEnabled: boolean) => {
      const generation = ++videoGeneration.current;
      inFlightVideo.current = true;
      videoRef.current = {
        file,
        audioEnabled,
        status: 'checking',
      };
      setVideoAction(null);
      bump();

      try {
        const token = await getToken();
        if (!token) throw new Error('Sign in again to check this video.');
        const fd = new FormData();
        fd.append('video', file);
        fd.append('audioEnabled', String(audioEnabled));
        const res = await fetch(`${apiRef.current}/listings/video-preflight`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const data = (await res.json().catch(() => ({}))) as VideoScreenResult & {
          message?: string | string[];
        };
        if (!res.ok) {
          const msg = Array.isArray(data.message)
            ? data.message.join(', ')
            : data.message;
          throw new Error(msg ?? `Error ${res.status}`);
        }
        if (generation !== videoGeneration.current) return;
        if (data.decision === 'APPROVE') {
          videoRef.current = { file, audioEnabled, status: 'clear' };
          dropFromQueue(file);
        } else {
          videoRef.current = {
            file,
            audioEnabled,
            status: 'needs-fix',
            decision: data.decision,
            reason: data.publicReason ?? data.reasons[0],
            publicReason: data.publicReason,
          };
          reviewQueue(file);
        }
      } catch (err) {
        if (generation !== videoGeneration.current) return;
        videoRef.current = {
          file,
          audioEnabled,
          status: 'needs-fix',
          decision: 'HUMAN_REVIEW',
          reason:
            err instanceof Error
              ? err.message
              : 'We could not check this video.',
        };
        reviewQueue(file);
      } finally {
        if (generation === videoGeneration.current) {
          inFlightVideo.current = false;
          bump();
        }
      }
    },
    [bump, dropFromQueue, getToken, reviewQueue],
  );

  const syncImages = useCallback(
    (next: File[]) => {
      const keep = new Set(next);
      for (const file of Array.from(imagesRef.current.keys())) {
        if (!keep.has(file)) {
          imagesRef.current.delete(file);
          blurAttempted.current.delete(file);
          dropFromQueue(file);
        }
      }
      for (const file of next) {
        if (!imagesRef.current.has(file)) {
          void screenImage(file);
        }
      }
      bump();
    },
    [bump, dropFromQueue, screenImage],
  );

  const syncVideo = useCallback(
    (file: File | null, audioEnabled: boolean) => {
      if (!file) {
        videoGeneration.current += 1;
        videoRef.current = null;
        inFlightVideo.current = false;
        setVideoAction(null);
        bump();
        return;
      }
      const current = videoRef.current;
      if (
        current &&
        current.file === file &&
        current.audioEnabled === audioEnabled &&
        current.status !== 'checking'
      ) {
        return;
      }
      void screenVideo(file, audioEnabled);
    },
    [bump, screenVideo],
  );

  const applyBlur = useCallback(
    (oldFile: File, newFile: File) => {
      imagesRef.current.delete(oldFile);
      blurAttempted.current.add(newFile);
      dropFromQueue(oldFile);
      bump();
      void screenImage(newFile, true);
    },
    [bump, dropFromQueue, screenImage],
  );

  const chooseVideoReview = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      videoRef.current = { ...video, status: 'review' };
      dropFromQueue(video.file);
      setVideoAction('review');
      bump();
    }
  }, [bump, dropFromQueue]);

  const chooseVideoDelete = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      dropFromQueue(video.file);
      setVideoAction('delete');
      videoRef.current = null;
      bump();
    }
  }, [bump, dropFromQueue]);

  const chooseVideoReupload = useCallback(() => {
    const video = videoRef.current;
    if (video) dropFromQueue(video.file);
    videoRef.current = null;
    setVideoAction(null);
    bump();
  }, [bump, dropFromQueue]);

  const currentFile = queue[0] ?? null;
  const currentImage = currentFile
    ? imagesRef.current.get(currentFile) ?? null
    : null;
  const currentVideo =
    currentFile && videoRef.current?.file === currentFile
      ? videoRef.current
      : null;
  const current = currentImage
    ? { kind: 'image' as const, review: currentImage }
    : currentVideo
      ? { kind: 'video' as const, review: currentVideo }
      : null;

  const checking =
    Array.from(imagesRef.current.values()).some(
      (item) => item.status === 'checking',
    ) || videoRef.current?.status === 'checking';

  const allSettled =
    !checking &&
    queue.length === 0 &&
    (!videoRef.current || videoRef.current.status !== 'checking');

  const imageStatusFor = (file: File): MediaStatus | undefined =>
    imagesRef.current.get(file)?.status;

  const imageReview = Array.from(imagesRef.current.values()).some(
    (item) => item.status === 'review',
  );

  return {
    version,
    queue,
    current,
    checking,
    allSettled,
    imageReviewRequired: imageReview,
    videoAction,
    videoReview: videoRef.current,
    notice,
    dismissNotice: () => setNotice(null),
    syncImages,
    syncVideo,
    applyBlur,
    chooseVideoReview,
    chooseVideoDelete,
    chooseVideoReupload,
    imageStatusFor,
    hasBlocked: Array.from(imagesRef.current.values()).some(
      (item) => item.status === 'blocked',
    ),
  };
}
