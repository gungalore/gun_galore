'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  motivationsApi,
  type CoverChoice,
  type CoverPhotoState,
} from '@/lib/motivations-api';
import MotivationCoverCropper from './motivation-cover-cropper';
import { useAuth } from '@clerk/nextjs';

// ────────────────────────────────────────────────────────────────────
// THE COVER PHOTOGRAPH — approve ours, or send your own.
//
// Operator, 2026-08-21: "if the system cant find one, the user has the option
// to upload one. We reserve the right to trim it to the correct aspect ratio.
// Then to crop it to fit into the predefined set limits. We can prescreen the
// image that we found to the user and ask if they want to keep or replace it
// with their own image as well if we did find a suitable image."
//
// ⚠️ THE PRESCREEN IS THE POINT, not the upload. Our search only accepts a
// photograph it can prove is the right make and model — see plausiblyShows in
// motivation-firearm-image, written after it stored a Japanese military rifle
// under the name of a Howa hunting rifle. That guard makes the picture safe to
// print. It does not make it the applicant's to be surprised by: this goes on
// the front of a document they sign and hand to the police, so they see it
// first, and either keep it or replace it.
//
// ⚠️ AND "NO PHOTOGRAPH" IS AN ANSWER. Somebody may simply not want a picture
// of a firearm on their application. Offering only "keep" and "replace" would
// make that the one thing they cannot ask for.
// ────────────────────────────────────────────────────────────────────

export default function MotivationCoverPhoto({
  motivationId,
  /** Called after a change, so the page can refresh anything downstream. */
  onChanged,
}: {
  motivationId: string;
  onChanged?: () => void;
}) {
  const { getToken } = useAuth();
  const [state, setState] = useState<CoverPhotoState | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // ⚠️ THE CHOSEN FILE IS HELD, NOT UPLOADED. It goes to the trim tool first.
  // The automatic centre-crop this replaced could not have worked: a rifle is
  // long and thin and rarely centred in the picture somebody took of it, so
  // cropping to the middle takes the receiver and throws away the muzzle. The
  // person who took the photograph knows which part of it is the firearm.
  const [pending, setPending] = useState<File | null>(null);

  // ⚠️ REVOKED ON REPLACEMENT AND ON UNMOUNT. Object URLs pin their blob in
  // memory until revoked, and this component replaces the picture every time
  // somebody uploads one — a member trying three photographs would otherwise
  // leave three full-size images alive for the life of the tab.
  const urlRef = useRef<string | null>(null);
  const showImage = useCallback((url: string | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = url;
    setImageUrl(url);
  }, []);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  const load = useCallback(async () => {
    const next = await motivationsApi.coverPhoto(getToken, motivationId);
    setState(next);
    // Only fetch the image when there is one to fetch — a 404 per render on a
    // pack with no photograph is noise in the log and a wasted round trip.
    if (next.hasOwn || next.stock) {
      showImage(await motivationsApi.coverPhotoUrl(getToken, motivationId));
    } else {
      showImage(null);
    }
  }, [getToken, motivationId, showImage]);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = async (choice: CoverChoice) => {
    setBusy(true);
    setError(null);
    try {
      await motivationsApi.setCoverChoice(getToken, motivationId, choice);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  /** Called by the trim tool with the bytes the applicant actually chose. */
  const upload = async (blob: Blob) => {
    setBusy(true);
    setError(null);
    try {
      await motivationsApi.uploadCoverPhoto(getToken, motivationId, blob);
      setPending(null);
      await load();
      onChanged?.();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'We could not use that photograph. Please try another one.',
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await motivationsApi.removeCoverPhoto(getToken, motivationId);
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove that.');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return null;

  const nothingFound = !state.stock && !state.hasOwn;
  const printing =
    state.choice === 'NONE' ? 'none' : state.hasOwn && state.choice !== 'STOCK' ? 'own' : state.stock ? 'stock' : 'none';

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-medium">Photograph on the cover</h3>
        <p className="text-xs text-[var(--text-secondary)]">
          {state.firearmLine
            ? `Captioned “${state.firearmLine}”`
            : 'Optional'}
        </p>
      </div>

      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        {nothingFound
          ? 'We could not find a photograph of this model, so the cover will print without one. You can add your own.'
          : printing === 'own'
            ? 'Your own photograph will print on the cover.'
            : printing === 'none'
              ? 'The cover will print without a photograph.'
              : // ⚠️ SAY WHOSE PICTURE IT IS. It is a photograph of the MODEL,
                // not of their firearm, and somebody approving it for a police
                // document should not have to guess which.
                'We found a photograph of this model. It is a stock picture of the type, not of your own firearm.'}
      </p>

      {error && (
        <p role="alert" className="mt-2 text-sm text-[var(--red)]">
          {error}
        </p>
      )}

      {imageUrl && state.choice !== 'NONE' && (
        <figure className="mt-3">
          {/* The frame's own proportions, so this IS the prescreen rather than
              a picture of the picture. eslint-disable: the src is an object
              URL from an authenticated fetch, which next/image cannot take. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={
              state.firearmLine
                ? `Cover photograph: ${state.firearmLine}`
                : 'Cover photograph'
            }
            // The frame's own proportions. Everything the trim tool produces
            // is already exactly this shape; a stock photograph off Commons
            // may not be, and object-cover previews the same trim the renderer
            // will apply to it.
            className="w-full max-w-[320px] rounded border border-[var(--border)] bg-[var(--bg-inset)] object-cover"
            style={{ aspectRatio: String(state.aspect) }}
          />
          {state.stock && printing === 'stock' && state.stock.source && (
            <figcaption className="mt-1 text-xs text-[var(--text-secondary)]">
              Source: {state.stock.source.replace(/^File:/, '')} · Wikimedia
              Commons
            </figcaption>
          )}
        </figure>
      )}

      {pending && (
        <MotivationCoverCropper
          file={pending}
          limits={{
            aspect: state.aspect,
            frameMm: state.frameMm,
            maxPx: state.maxPx,
          }}
          onCancel={() => {
            setPending(null);
            if (fileRef.current) fileRef.current.value = '';
          }}
          onDone={(blob) => void upload(blob)}
        />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {state.stock && printing !== 'stock' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => choose('STOCK')}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Use the one we found
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {state.hasOwn ? 'Replace my photograph' : 'Upload my own photograph'}
        </button>
        {state.hasOwn && (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Remove mine
          </button>
        )}
        {printing !== 'none' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => choose('NONE')}
            className="rounded px-3 py-1.5 text-sm text-[var(--text-secondary)] underline disabled:opacity-50"
          >
            No photograph
          </button>
        )}
        {state.choice === 'NONE' && (
          <button
            type="button"
            disabled={busy}
            onClick={() => choose(state.hasOwn ? 'OWN' : 'STOCK')}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Put the photograph back
          </button>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) {
            setError(null);
            setPending(f);
          }
        }}
      />

      <p className="mt-2 text-xs text-[var(--text-secondary)]">
        You set the trim yourself, and the frame on the cover takes the shape
        you choose. A photograph of your own firearm is fine — the cover
        already names its make, model and serial.
      </p>
    </div>
  );
}
