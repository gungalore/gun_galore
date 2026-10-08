'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import {
  ValuationApiError,
  ValuationImageView,
  ValuationResult,
  PhotoChecklistItem,
  ServedQuestion,
  SavedAnswer,
  createValuation,
  uploadValuationPhoto,
  deleteValuationPhoto,
  identifyValuation,
  saveAnswers,
  startResearch,
  fetchValuation,
  createCaptureSession,
  closeCaptureSession,
  listingDraft,
} from '../../lib/valuation-api';
import { IntakeDropzone } from './intake-dropzone';
import { PhotoGrid } from './photo-grid';
import { PhotoChecklist } from './photo-checklist';
import { QrCapturePanel } from './qr-capture-panel';
import { QuestionWizard } from './question-wizard';
import { ResearchProgress } from './research-progress';
import { ResultView } from './result-view';

const MAX_PHOTOS = 8;

type Stage = 'intake' | 'questions' | 'research' | 'result';

const DEFAULT_FORM_DRAFT = {
  compareAtPriceZarCents: '',
  condition: 'GOOD',
  province: 'GAUTENG',
  passFeeToBuyer: true,
  autoAcceptThreshold: '',
  autoDeclineThreshold: '',
  durationDays: '7',
  reservePrice: '',
  offerBuyNow: false,
  buyNowPrice: '',
};

export function ValuationFlow() {
  const { getToken } = useAuth();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('intake');
  const [valuationId, setValuationId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<PhotoChecklistItem[]>([]);
  const [images, setImages] = useState<ValuationImageView[]>([]);
  const [description, setDescription] = useState('');
  const [tagForNew, setTagForNew] = useState('');
  const [questions, setQuestions] = useState<ServedQuestion[]>([]);
  const [result, setResult] = useState<ValuationResult | null>(null);
  const [legalFlags, setLegalFlags] = useState<Array<{ flag: string; message: string }>>([]);
  const [capture, setCapture] = useState<{ token: string; url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fatal, setFatal] = useState<{ code: string; message: string } | null>(null);
  const [creatingListing, setCreatingListing] = useState(false);

  const ensureValuation = useCallback(async (): Promise<string> => {
    if (valuationId) return valuationId;
    const token = await getToken();
    if (!token) throw new Error('Please sign in to continue');
    const created = await createValuation(token, description.trim() || undefined);
    setValuationId(created.id);
    setChecklist(created.photoChecklist);
    return created.id;
  }, [valuationId, description, getToken]);

  async function handleFiles(files: File[]) {
    setError(null);
    setBusy(true);
    try {
      const id = await ensureValuation();
      const token = await getToken();
      if (!token) throw new Error('Please sign in to continue');
      let current = images;
      for (const file of files) {
        if (current.length >= MAX_PHOTOS) break;
        const res = await uploadValuationPhoto(token, id, file, {
          viewTag: tagForNew || null,
          source: 'DESKTOP',
        });
        current = [
          ...current,
          { id: res.image.id, url: res.image.url, viewTag: res.image.viewTag, source: res.image.source },
        ];
        setImages(current);
        if (res.photoChecklist?.length) setChecklist(res.photoChecklist);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(photoId: string) {
    if (!valuationId) return;
    setError(null);
    setBusyId(photoId);
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in to continue');
      await deleteValuationPhoto(token, valuationId, photoId);
      setImages((prev) => prev.filter((img) => img.id !== photoId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function openCapture() {
    try {
      const id = await ensureValuation();
      const token = await getToken();
      if (!token) throw new Error('Please sign in to continue');
      const session = await createCaptureSession(token, id);
      setCapture(session);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function closeCapture() {
    if (!valuationId) return;
    const token = await getToken();
    if (token) await closeCaptureSession(token, valuationId).catch(() => {});
    setCapture(null);
  }

  // While a capture session is open, poll the valuation so phone photos appear.
  useEffect(() => {
    if (!capture || !valuationId) return;
    let active = true;
    const poll = setInterval(async () => {
      const token = await getToken();
      if (!token || !active) return;
      try {
        const state = await fetchValuation(token, valuationId);
        setImages(state.images);
        if (state.photoChecklist?.length) setChecklist(state.photoChecklist);
      } catch {
        /* transient */
      }
    }, 3000);
    return () => {
      active = false;
      clearInterval(poll);
    };
  }, [capture, valuationId, getToken]);

  async function handleEvaluate() {
    setError(null);
    setFatal(null);
    setBusy(true);
    try {
      const id = await ensureValuation();
      const token = await getToken();
      if (!token) throw new Error('Please sign in to continue');
      const res = await identifyValuation(token, id, description.trim() || undefined);
      setQuestions(res.questions);
      if (res.photoChecklist?.length) setChecklist(res.photoChecklist);
      setStage('questions');
    } catch (err) {
      if (err instanceof ValuationApiError) {
        const body = safeParse(err.message);
        if (body?.errorCode === 'OUT_OF_SCOPE' || body?.errorCode === 'BANNED_ITEM') {
          setFatal({ code: body.errorCode, message: body.message ?? 'This item cannot be valued.' });
        } else {
          setError(errorMessage(err));
        }
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleAnswers(answers: SavedAnswer[]) {
    if (!valuationId) return;
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in to continue');
      await saveAnswers(token, valuationId, answers);
      await startResearch(token, valuationId);
      setStage('research');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCreateListing() {
    if (!valuationId || !result) return;
    setCreatingListing(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in to continue');
      const draft = await listingDraft(token, valuationId);
      const existing = localStorage.getItem('gg-listing-new-draft');
      if (existing) {
        // Do not clobber a draft the seller was already working on.
      }
      localStorage.setItem(
        'gg-listing-new-draft',
        JSON.stringify({
          form: {
            ...DEFAULT_FORM_DRAFT,
            title: draft.title,
            description: draft.description,
            price: draft.price != null ? String(draft.price) : '',
            listingType: 'BUY_NOW',
            categoryId: draft.categoryId ?? '',
          },
          attrValues: draft.attributes,
          shippingMethods: draft.shippingMethods,
          valuationId,
        }),
      );
      localStorage.setItem('gg-valuation-pending', valuationId);
      router.push('/listings/new');
    } catch (err) {
      setError(errorMessage(err));
      setCreatingListing(false);
    }
  }

  if (fatal) {
    return (
      <div className="max-w-xl mx-auto text-center py-10">
        <h1 className="text-xl font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          We cannot value this item
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{fatal.message}</p>
      </div>
    );
  }

  if (stage === 'questions') {
    return <QuestionWizard questions={questions} onComplete={handleAnswers} />;
  }

  if (stage === 'research' && valuationId) {
    return (
      <ResearchProgress
        valuationId={valuationId}
        getToken={getToken}
        onDone={(r, flags) => {
          setResult(r);
          setLegalFlags(flags);
          setStage('result');
        }}
        onFailed={(message) => setError(message)}
        onRetry={() => (valuationId ? startResearchAfterRetry(valuationId) : undefined)}
      />
    );
  }

  if (stage === 'result' && result) {
    return (
      <ResultView
        result={result}
        legalFlags={legalFlags}
        onCreateListing={handleCreateListing}
        onStartAnother={() => {
          setStage('intake');
          setValuationId(null);
          setImages([]);
          setQuestions([]);
          setResult(null);
          setCapture(null);
          setDescription('');
        }}
        creatingListing={creatingListing}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl sm:text-4xl" style={{ color: 'var(--text-primary)' }}>
          Value My Item
        </h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          Add a few clear photos and we will research what your item is worth,
          based on live South African listings.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-[8px] px-4 py-3 text-sm" style={{ background: 'rgba(227,6,19,0.08)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4 order-2 lg:order-1">
          <div>
            <label htmlFor="valuation-description" className="block text-sm mb-1.5" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
              Anything you already know
            </label>
            <textarea
              id="valuation-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Model, size, age, what's included"
              className="w-full rounded-[8px] px-3 py-2.5 text-sm resize-y"
              style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="valuation-tag" className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Tag new photos</label>
            <select
              id="valuation-tag"
              value={tagForNew}
              onChange={(e) => setTagForNew(e.target.value)}
              className="text-xs rounded-[6px] px-2 py-1.5"
              style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-primary)' }}
            >
              <option value="">No tag</option>
              {checklist.map((item) => (
                <option key={item.tag} value={item.tag}>{item.label}</option>
              ))}
            </select>
          </div>

          <IntakeDropzone onFiles={handleFiles} disabled={busy || MAX_PHOTOS - images.length <= 0} remaining={MAX_PHOTOS - images.length} />

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Photos</p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{images.length} of {MAX_PHOTOS} photos</p>
            </div>
            <PhotoGrid images={images} maxPhotos={MAX_PHOTOS} onDelete={handleDelete} busyId={busyId} />
          </div>

          <button
            type="button"
            onClick={handleEvaluate}
            disabled={images.length === 0 || busy}
            className="rounded-[8px] px-5 py-3 text-sm font-semibold self-start"
            style={{
              background: images.length === 0 || busy ? 'var(--bg-inset)' : 'var(--red)',
              color: images.length === 0 || busy ? 'var(--text-tertiary)' : '#fff',
              border: 'none',
              cursor: images.length === 0 || busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Uploading...' : 'Evaluate'}
          </button>
        </div>

        <div className="order-1 lg:order-2 flex flex-col gap-4">
          <PhotoChecklist items={checklist} />
          {capture ? (
            <QrCapturePanel
              url={capture.url}
              expiresAt={capture.expiresAt}
              onRefresh={openCapture}
              onClose={closeCapture}
            />
          ) : (
            <button
              type="button"
              onClick={openCapture}
              className="rounded-[10px] p-4 text-sm text-center"
              style={{ background: 'var(--bg-inset)', border: '0.5px dashed var(--border)', color: 'var(--text-primary)', cursor: 'pointer' }}
            >
              Add photos from your phone
            </button>
          )}
        </div>
      </div>
    </div>
  );

  async function startResearchAfterRetry(id: string) {
    const token = await getToken();
    if (token) {
      setError(null);
      await startResearch(token, id).catch((err) => setError(errorMessage(err)));
    }
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof ValuationApiError) {
    if (err.status === 401) return 'Please sign in to continue.';
    if (err.status === 400) {
      const body = safeParse(err.message);
      return body?.message ?? 'That could not be accepted. Check the file and try again.';
    }
    return 'Something went wrong. Please try again.';
  }
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

function safeParse(raw: string): { errorCode?: string; message?: string } | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
