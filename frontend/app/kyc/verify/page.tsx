'use client';

import { useState, useEffect, useRef, Suspense, type CSSProperties } from 'react';
import { av } from '@/lib/asset-version';
import { SUPPORT_EMAIL } from '@/lib/brand';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Image from 'next/image';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { HelpTip } from '@/components/help-tip';
import ScanButton from '@/components/scan/scan-button';
import { shapeForKind } from '@/lib/scan/shapes';
import { processImage } from '@/lib/process-image';
import DateField from '@/components/date-field';
import { shiftYears, toIso, todayYmd } from '@/lib/date-picker-model';
import { licenceCentreApi } from '@/lib/licence-centre-api';
import { StepRail, type StepRailStep } from '@/components/step-rail';
import { useShellStep } from '@/components/shell/shell-step';

// TWO FLOWS live on this page, branched by GET /kyc/status → `flow`:
//
//   VERIFYNOW (legacy, flag off): consent → id (Home Affairs photo pull)
//   → selfie (VerifyNow facematch). PORTED from the old project.
//   IMPORTANT: do not "improve" the VerifyNow request bodies or response
//   parsing without re-testing against the real API.
//
//   CLAUDE (kyc_claude_flow_enabled): consent → details (ID number + DOB)
//   → document (upload ID as photo/PDF) → selfie (live capture → Claude
//   vision verdict). Every step persists server-side, so "save & finish
//   later" is just leaving — on return, status.nextStep resumes the
//   wizard at the first incomplete step (works for SMS-token arrivals
//   too). NOTE: the DOB input is deliberately NOT validated against the
//   ID number client-side — that cross-check is a silent server-side
//   anti-fraud measure. Do not add it here.
//
// Camera-less devices get the QR handoff plus an "SMS me the link"
// button (Claude flow) for sellers who don't know what a QR code is.

type Step =
  | 'loading'
  | 'consent'
  | 'details'
  | 'id'
  | 'document'
  | 'selfie'
  | 'review'
  | 'success'
  | 'failed';

interface KycStatus {
  flow: 'CLAUDE' | 'VERIFYNOW';
  kycStatus: string;
  kycAttempts: number;
  nextStep:
    | 'consent'
    | 'details'
    | 'document'
    | 'selfie'
    | 'review'
    | 'done'
    | 'failed';
  steps: {
    consent: boolean;
    details: boolean;
    document: boolean;
    selfie: boolean;
  };
  phoneMasked: string | null;
}

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--bg-inset)',
  border: '0.5px solid var(--border)',
  borderRadius: 6,
  padding: '12px 14px',
  fontSize: 14,
  color: 'var(--text-primary)',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
};

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--text-secondary)',
  marginBottom: 6,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const cardStyle: CSSProperties = {
  background: 'var(--bg-card)',
  border: '0.5px solid var(--border)',
  borderRadius: 8,
  padding: 24,
};

function primaryButton(disabled: boolean): CSSProperties {
  return {
    width: '100%',
    background: disabled ? 'var(--bg-inset)' : 'var(--red)',
    color: disabled ? 'var(--text-tertiary)' : '#fff',
    border: 'none',
    borderRadius: 6,
    padding: 14,
    fontSize: 14,
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit',
  };
}

function ErrorBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: 'rgba(192,57,43,0.1)',
        border: '0.5px solid rgba(192,57,43,0.3)',
        borderRadius: 6,
        fontSize: 13,
        color: 'var(--red)',
        marginBottom: 14,
        lineHeight: 1.4,
      }}
    >

      {children}
    </div>
  );
}

// Next 16 requires useSearchParams() to be wrapped in a Suspense
// boundary at build time, even on a fully client-rendered page.
// Inner function holds the body; default export wraps it so the
// production build can prerender the shell without bailing.
export default function VerifyKycPage() {
  return (
    <Suspense fallback={null}>
      <VerifyKycPageInner />
    </Suspense>
  );
}

function VerifyKycPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getToken, isLoaded, isSignedIn } = useAuth();

  const [step, setStep] = useState<Step>('loading');
  const [flow, setFlow] = useState<'CLAUDE' | 'VERIFYNOW'>('VERIFYNOW');
  const [phoneMasked, setPhoneMasked] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [dob, setDob] = useState('');
  const [docFileName, setDocFileName] = useState('');
  const [docPreviewUrl, setDocPreviewUrl] = useState<string | null>(null);
  const [verifiedName, setVerifiedName] = useState('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [attempts, setAttempts] = useState(0);
  // ── THE ID THEY HAVE ALREADY GIVEN US ──────────────────────────────
  //
  // Operator, 2026-08-22: "When they are approved, we can ask them if we can
  // add their ID to their Document Centre... it will create awareness of the
  // Document and Motivation Centres."
  //
  // 'idle' until the offer comes back, then 'offer' | 'saving' | 'kept' |
  // 'declined'. Anything that fails collapses to 'idle', because a missing
  // optional offer must never become an error on the page somebody sees the
  // moment they are told they passed.
  const [idOffer, setIdOffer] = useState<
    'idle' | 'offer' | 'saving' | 'answered'
  >('idle');
  // ⚠️ HOLDS THE 3-SECOND REDIRECT. Without this the card renders, the offer
  // is readable for about a second, and the page navigates away underneath
  // somebody halfway through reading it.
  const [holdRedirect, setHoldRedirect] = useState(false);
  // ⚠️ A REF ALONGSIDE THE STATE, and it is load-bearing. The redirect timer
  // is scheduled the moment the success screen appears and the offer arrives
  // a beat later — so a timer that closed over the state variable would read
  // `false` forever and navigate away regardless. The state drives the render;
  // the ref is what the timer reads.
  const holdRedirectRef = useRef(false);
  useEffect(() => {
    holdRedirectRef.current = holdRedirect;
  }, [holdRedirect]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** The short pause after the phone reports in — see onDocArrivedFromPhone. */
  const phoneArrivalTimer = useRef<number | null>(null);

  // ── MAY WE KEEP THE ID YOU JUST HANDED OVER? ────────────────────────
  //
  // Operator, 2026-08-23: "As soon as the KYC is done a window must pop up
  // asking for permission and a short explanation. Does not matter if the KYC
  // has passed or not."
  //
  // ⚠️ ALL THREE TERMINAL STEPS, AND THE OUTCOME IS BESIDE THE POINT. We are
  // holding their ID whether the face-match passed, went to a human, or
  // failed — so the question is the same in all three cases, and asking only
  // on success meant never asking the two groups who are arguably most likely
  // to come back and try again.
  //
  // ⚠️ AND AT SUBMISSION RATHER THAN AT APPROVAL, which is where this lived
  // for about an hour. Approval can land days later, by which time the
  // question is about a document they have stopped thinking about; here they
  // photographed it thirty seconds ago. This is now the ONLY place it is
  // asked — the approval email, the in-app notification and the Document
  // Centre card were all removed on the same instruction.
  //
  // ⚠️ FAILS TO SILENCE: the client falls back to { available: false } rather
  // than throwing, so a Centre that is switched off, a slow call or a network
  // blip costs the question and never puts an error in front of somebody who
  // has just finished verifying.
  useEffect(() => {
    if (step !== 'success' && step !== 'review' && step !== 'failed') return;
    let cancelled = false;
    void (async () => {
      const r = await licenceCentreApi
        .kycIdOffer(getToken)
        .catch(() => ({ available: false, alreadyThere: false }));
      if (cancelled || !r.available) return;
      setHoldRedirect(true);
      setIdOffer('offer');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // DOB input ceiling: sellers must be 18+. This is the only DOB
  // validation on the client — see the flow note at the top of the file.
  //
  // ⚠️ WAS toISOString().slice(0, 10), WHICH IS A DAY EARLY IN SOUTH AFRICA.
  // That converts a LOCAL instant to UTC, so between midnight and 02:00 SAST
  // it returned yesterday — and somebody who turned 18 today was told they
  // had not. toIso() emits the local calendar date directly.
  const dobMax = toIso(shiftYears(todayYmd(), -18));

  // Action-token auth: when the seller arrives via the SMS one-tap link
  // (/a/<token> → /kyc/verify?t=<token>) there's no Clerk session, so we
  // authorise the KYC API calls with the token instead of a Bearer JWT.
  const actionToken = searchParams.get('t');

  // returnTo lets us send the seller back to where they came from (e.g.
  // the transaction page that prompted them). For token arrivals (no
  // session) default to home, NOT /dashboard — that would itself bounce
  // to sign-in and re-create the wall we're removing.
  // Only honour a SAME-ORIGIN, single-slash-rooted relative path — never an
  // absolute or protocol-relative ("//evil.example") URL, which would let a
  // crafted /kyc/verify?returnTo=… link bounce the user off-site (phishing) at
  // a high-trust identity/banking moment.
  const rawReturnTo = searchParams.get('returnTo');
  const returnTo =
    rawReturnTo &&
    rawReturnTo.startsWith('/') &&
    !rawReturnTo.startsWith('//') &&
    !rawReturnTo.includes('\\') // "\" is normalised to "/" by browsers → treat as protocol-relative
      ? rawReturnTo
      : actionToken
        ? '/'
        : '/dashboard';

  useEffect(() => {
    // The token flow runs without a Clerk session — don't force sign-in.
    if (!actionToken && isLoaded && !isSignedIn) {
      router.push('/sign-in?redirect_url=/kyc/verify');
    }
  }, [actionToken, isLoaded, isSignedIn, router]);

  // Stop the camera stream on unmount so it doesn't keep recording.
  useEffect(() => {
    return () => {
      stopCamera();
      // And drop the pending step change, so a seller who navigates away in
      // that 1.7-second window is not moved on by a timer after they left.
      if (phoneArrivalTimer.current !== null) {
        window.clearTimeout(phoneArrivalTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flow branch + save-&-resume: GET /kyc/status decides which pipeline
  // renders AND (Claude flow) which step to resume at — every completed
  // step is already persisted server-side. Status failure falls back to
  // the legacy flow at consent, which is always safe.
  useEffect(() => {
    if (!actionToken && !(isLoaded && isSignedIn)) return;
    let cancelled = false;
    (async () => {
      try {
        const s = (await apiGet('status')) as unknown as KycStatus;
        if (cancelled) return;
        setPhoneMasked(s.phoneMasked ?? null);
        setAttempts(s.kycAttempts ?? 0);
        if (s.flow !== 'CLAUDE') {
          setFlow('VERIFYNOW');
          setStep('consent');
          return;
        }
        setFlow('CLAUDE');
        switch (s.nextStep) {
          case 'done':
            setStep('success');
            setTimeout(() => {
              if (holdRedirectRef.current) return;
              router.push(returnTo);
            }, 3000);
            break;
          case 'review':
            setStep('review');
            break;
          case 'failed':
            setError(
              'Please contact support for assistance with identity verification.',
            );
            setStep('failed');
            break;
          case 'selfie':
            setStep('selfie');
            void detectCameraAndProceed();
            break;
          default:
            setStep(s.nextStep);
        }
      } catch {
        if (!cancelled) {
          setFlow('VERIFYNOW');
          setStep('consent');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionToken, isLoaded, isSignedIn]);

  async function authedUrlAndHeaders(path: string) {
    // Token flow: authorise via ?t=<token> (no Clerk session). Otherwise
    // send the Clerk JWT as a Bearer header (signed-in path).
    let url = `${API_URL}/kyc/${path}`;
    const headers: Record<string, string> = {};
    if (actionToken) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}t=${encodeURIComponent(actionToken)}`;
    } else {
      const token = await getToken();
      headers.Authorization = `Bearer ${token}`;
    }
    return { url, headers };
  }

  async function apiPost(path: string, body?: object | FormData) {
    const { url, headers } = await authedUrlAndHeaders(path);
    const isForm = body instanceof FormData;
    // FormData sets its own multipart boundary — never set Content-Type.
    if (!isForm) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        (data?.message as string) || `Request failed (${res.status})`,
      );
    }
    return data;
  }

  async function apiGet(path: string) {
    const { url, headers } = await authedUrlAndHeaders(path);
    const res = await fetch(url, { headers, cache: 'no-store' });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        (data?.message as string) || `Request failed (${res.status})`,
      );
    }
    return data;
  }

  // ─── Step 1: consent ─────────────────────────────────────────────
  async function handleConsent() {
    setLoading(true);
    setError('');
    try {
      await apiPost('consent');
      setStep(flow === 'CLAUDE' ? 'details' : 'id');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  // ─── Claude flow Step 2: ID number + date of birth ───────────────
  async function handleDetailsSubmit() {
    if (idNumber.length !== 13 || !dob) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiPost('details', { idNumber, dob });
      if (data.success) {
        setVerifiedName(
          `${(data.firstName as string) ?? ''} ${(data.surname as string) ?? ''}`.trim(),
        );
        // Short pause so the seller sees the "Welcome, NAME" confirmation.
        setTimeout(() => setStep('document'), 1500);
      } else {
        setError(
          (data.message as string) ||
            'ID could not be verified. Check the number and try again.',
        );
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Verification service unavailable.',
      );
    } finally {
      setLoading(false);
    }
  }

  // ─── Claude flow Step 3: ID document upload ──────────────────────
  async function handleDocumentUpload(file: File) {
    setLoading(true);
    setError('');
    try {
      let toSend = file;
      if (file.type !== 'application/pdf') {
        // Downscale/re-encode client-side when the browser can decode it.
        // HEIC on desktop can't be decoded here — upload the original and
        // let the backend transcode via Cloudinary before the vision call.
        try {
          toSend = await processImage(file);
        } catch {
          toSend = file;
        }
      }
      const form = new FormData();
      form.append('document', toSend);
      await apiPost('id-document', form);
      setDocFileName(file.name);
      setStep('selfie');
      void detectCameraAndProceed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed — try again.');
    } finally {
      setLoading(false);
    }
  }

  function onDocPicked(file: File | null) {
    if (!file) return;
    setDocFileName(file.name);
    if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    setDocPreviewUrl(
      file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    );
    void handleDocumentUpload(file);
  }

  /**
   * The phone has already uploaded the ID; this side only has to catch up.
   *
   * ⚠️ NOTHING IS RE-UPLOADED HERE. The document went straight from the phone
   * into the encrypted store through /kyc/scan, so the desktop's job is the
   * step change and nothing else — exactly what handleDocumentUpload does
   * after its own POST returns. Uploading again from here would mean asking
   * the phone to send the file back to a browser that never had it.
   *
   * ⚠️ AND THE STEP CHANGE WAITS A BEAT, which is not decoration. Changing it
   * here unmounts the whole document step — ScanButton and the QR dialog with
   * it — in the same render as the dialog setting itself to "Your ID arrived".
   * That copy was written for this moment and never once painted: the seller
   * was still holding their phone while the screen they were about to look at
   * jumped, with nothing having said the photograph landed. The dialog closes
   * itself at 1.6s; this follows it out.
   */
  function onDocArrivedFromPhone() {
    if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    setDocPreviewUrl(null);
    setDocFileName('Photographed on your phone');
    setError('');
    if (phoneArrivalTimer.current !== null) {
      window.clearTimeout(phoneArrivalTimer.current);
    }
    phoneArrivalTimer.current = window.setTimeout(() => {
      phoneArrivalTimer.current = null;
      setStep('selfie');
      // Left until now on purpose: startCamera asks for the webcam, and a
      // permission prompt firing while the dialog is still up would land on
      // top of the one thing telling the seller their ID arrived.
      void detectCameraAndProceed();
    }, 1700);
  }

  // ─── Step 2: SA ID number → Home Affairs lookup ──────────────────
  async function handleIdSubmit() {
    if (idNumber.length !== 13) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiPost('verify-id', { idNumber });
      if (data.success) {
        setVerifiedName(`${data.firstName ?? ''} ${data.surname ?? ''}`.trim());
        // Short pause so the seller sees the "Welcome, NAME" confirmation
        // before we whisk them off to the selfie step.
        setTimeout(() => detectCameraAndProceed(), 1500);
      } else {
        setError(
          (data.message as string) ||
            'ID could not be verified. Check the number and try again.',
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification service unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function detectCameraAndProceed() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const hasVideo = devices.some((d) => d.kind === 'videoinput');
      if (!hasVideo) {
        setStep('selfie');
        setCameraUnavailable(true);
        return;
      }
      setStep('selfie');
      await startCamera();
    } catch {
      setStep('selfie');
      setCameraUnavailable(true);
    }
  }

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setCameraUnavailable(false);
    } catch {
      setCameraActive(false);
      setCameraUnavailable(true);
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  }

  function captureFrame() {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    const size = Math.min(
      videoRef.current.videoWidth,
      videoRef.current.videoHeight,
    );
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const offsetX = (videoRef.current.videoWidth - size) / 2;
    ctx.drawImage(videoRef.current, offsetX, 0, size, size, 0, 0, size, size);
    // VerifyNow strips the data URL prefix either way, but we send just
    // the bare base64 to keep payload size tighter.
    const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
    setCapturedImage(base64);
    stopCamera();
  }

  function retake() {
    setCapturedImage(null);
    setError('');
    void startCamera();
  }

  // ─── Final step: submit selfie ───────────────────────────────────
  async function submitSelfie(base64: string) {
    setLoading(true);
    setError('');
    try {
      if (flow === 'CLAUDE') {
        // One call: uploads the selfie, runs the vision verdict, returns
        // VERIFIED | UNDER_REVIEW | REJECTED.
        const data = await apiPost('selfie', { selfieBase64: base64 });
        const status = data.status as string | undefined;
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);
        if (status === 'VERIFIED') {
          setStep('success');
          setTimeout(() => {
              if (holdRedirectRef.current) return;
              router.push(returnTo);
            }, 3000);
        } else if (status === 'UNDER_REVIEW') {
          setStep('review');
        } else {
          setError(
            (data.message as string) ||
              'We could not verify your identity. Please try again.',
          );
          setStep('failed');
        }
        return;
      }

      const data = await apiPost('face-match', { selfieBase64: base64, idNumber });
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      if (data.success) {
        setStep('success');
        setTimeout(() => {
              if (holdRedirectRef.current) return;
              router.push(returnTo);
            }, 3000);
      } else {
        const msg =
          nextAttempts >= 3
            ? 'Please contact support for assistance with identity verification.'
            : ((data.message as string) ||
              'Face match failed. Please try again with good lighting.');
        setError(msg);
        setStep('failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification service unavailable.');
      setStep('failed');
    } finally {
      setLoading(false);
    }
  }

  // "Save & finish later" — nothing to persist: every completed step is
  // already on the server; returning resumes at status.nextStep.
  function SaveLaterLink() {
    if (flow !== 'CLAUDE') return null;
    return (
      <button
        type="button"
        onClick={() => router.push(returnTo)}
        style={{
          display: 'block',
          margin: '12px auto 0',
          background: 'transparent',
          border: 'none',
          color: 'var(--text-tertiary)',
          fontSize: 12,
          textDecoration: 'underline',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        Save &amp; finish later — your progress is kept
      </button>
    );
  }

  // The house step rail (components/step-rail.tsx) — one system, every
  // multi-step flow, replacing what used to be a bespoke pill bar here.
  // Items depend on the active flow, same as the pill bar before it.
  //
  // ⚠️ HIDDEN ON CONSENT (index 0) AND ON THE LOADING/REVIEW/SUCCESS/FAILED
  // SCREENS, none of which appear in `kycStepItems` — matching the old pill
  // bar, which was never rendered on those screens either.
  const kycStepItems: { key: Step; label: string }[] =
    flow === 'CLAUDE'
      ? [
          { key: 'consent', label: 'Consent' },
          { key: 'details', label: 'Details' },
          { key: 'document', label: 'ID document' },
          { key: 'selfie', label: 'Selfie' },
        ]
      : [
          { key: 'consent', label: 'Consent' },
          { key: 'id', label: 'ID Verify' },
          { key: 'selfie', label: 'Face Match' },
        ];
  const kycStepOrder: Step[] = kycStepItems.map((i) => i.key);
  const kycStepIdx = kycStepOrder.indexOf(step);
  const kycStepVisible = kycStepIdx > 0;
  const kycRailSteps: StepRailStep[] = kycStepItems.map((it, i) => ({
    label: it.label,
    complete: kycStepIdx > i,
  }));

  // Mobile counterpart of the rail below — the compact "Details · Step 2 of
  // 4" row the shell header shows under 768px. Gated identically to the
  // rail so the two are never both visible and never both hidden.
  useShellStep(
    kycStepVisible
      ? {
          label: kycStepItems[kycStepIdx].label,
          current: kycStepIdx + 1,
          total: kycStepItems.length,
        }
      : null,
  );

  return (
    <main
      style={{
        minHeight: '100vh',
        background: 'var(--bg-deep)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {/* ── MAY WE KEEP THE ID YOU JUST HANDED OVER? ──────────────────
          Operator, 2026-08-23: "As soon as the KYC is done a window must pop
          up asking for permission and a short explanation. Does not matter if
          the KYC has passed or not."

          ⚠️ THIS IS THE ONLY PLACE THE QUESTION IS ASKED. The approval email,
          the in-app notification and the Document Centre card were all removed
          on the same instruction — so there is no second chance and no quiet
          dismissal. Escape and a backdrop click do nothing; an answer is
          required, because the alternative to "make them answer" here is
          "never ask them again".

          ⚠️ z-[60] AND data-blocking-overlay, both load-bearing. The bottom tab
          bar is z-55 and Boet's dock is z-60 and wins on DOM order; the
          attribute stands him down for the overlay's lifetime. */}
      {(idOffer === 'offer' || idOffer === 'saving') && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          data-blocking-overlay="true"
          role="dialog"
          aria-modal="true"
          aria-label="May we keep your ID?"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-[var(--r-lg)] bg-[var(--bg-card)] p-5 sm:rounded-[var(--r-lg)]">
            <h2 className="text-lg font-semibold">May we keep your ID?</h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              A copy of your ID is the first thing every firearm licence
              application asks for. We are already holding the one you have
              just uploaded, and we can keep a copy in your Document Centre so
              you never photograph it again.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">
              It stays encrypted on our own server. You can rename or delete it
              in your Document Centre at any time, and deleting it removes the
              file. This covers your ID and nothing else.
            </p>
            {/* ⚠️ SAY THAT THE ANSWER DOES NOT AFFECT THE VERIFICATION. Asked
                at this moment, on this screen, somebody could reasonably read
                a "no" as putting their verification at risk — and a consent
                given under that impression is not a consent. */}
            <p className="mt-3 text-xs text-[var(--text-tertiary)]">
              Your answer does not affect your verification either way.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={idOffer === 'saving'}
                onClick={() => {
                  setIdOffer('saving');
                  void licenceCentreApi
                    .adoptKycId(getToken)
                    .then(() => setIdOffer('answered'))
                    // A failure costs the shortcut, not the verification.
                    .catch(() => setIdOffer('answered'))
                    .finally(() => setHoldRedirect(false));
                }}
                className="rounded-[var(--r-sm)] bg-[var(--red)] px-4 py-2 text-sm text-white disabled:opacity-60"
              >
                {idOffer === 'saving' ? 'Saving…' : 'Yes, keep it'}
              </button>
              <button
                type="button"
                disabled={idOffer === 'saving'}
                onClick={() => {
                  setIdOffer('answered');
                  setHoldRedirect(false);
                }}
                className="rounded-[var(--r-sm)] border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] disabled:opacity-60"
              >
                No, do not keep it
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ width: '100%', maxWidth: 390 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Image
            // Nav mark — the full scene's wordmark is unreadable at 36px.
            src={av('/logo-nav-dark.svg')}
            alt="All Outdoor"
            width={96}
            height={36}
            priority
            style={{ height: 36, width: 'auto', margin: '0 auto 12px', display: 'block' }}
          />
          <div
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: 'var(--text-primary)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            Identity verification
            <HelpTip title="Identity verification (KYC)" side="bottom">
              {flow === 'CLAUDE' ? (
                <>
                  South African law (FICA + POPIA) requires us to verify
                  every seller before releasing funds. You&apos;ll enter your
                  SA ID number and date of birth (checked against Home
                  Affairs records via VerifyNow, a licensed identity
                  service), upload a photo or PDF of your ID document, and
                  take a quick selfie. Your ID number is stored encrypted;
                  the document and selfie are kept securely for our
                  verification records, as set out in our Privacy Policy.
                </>
              ) : (
                <>
                  South African law (FICA + POPIA) requires us to verify
                  every seller before releasing funds. We use VerifyNow — a
                  licensed identity-checking service — to cross-check your
                  SA ID against Home Affairs and match a selfie to your
                  official photo. Takes under a minute. Your ID number is
                  encrypted; your selfie isn&apos;t stored after the match.
                </>
              )}
            </HelpTip>
          </div>
          <div
            style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}
          >
            Required to release your payout on All Outdoor
          </div>
        </div>

        {/* The house step rail. Desktop only — below md the shell header
            shows the compact "Details · Step 2 of 4" row instead, published
            by the useShellStep call above. Indicative only: nothing here is
            clickable, matching the old pill bar it replaces. */}
        {kycStepVisible && (
          <StepRail steps={kycRailSteps} current={kycStepIdx + 1} className="mb-6" mobile="shell" />
        )}

        {/* ─── Loading (status fetch) ───────────────────────────── */}
        {step === 'loading' && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: '40px 24px' }}>
            <div
              style={{
                width: 28,
                height: 28,
                border: '2px solid var(--border)',
                borderTop: '2px solid var(--red)',
                borderRadius: '50%',
                animation: 'kyc-spin 0.8s linear infinite',
                margin: '0 auto 12px',
              }}
            />
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              Loading your verification…
            </div>
          </div>
        )}

        {/* ─── Step 1: consent ──────────────────────────────────── */}
        {step === 'consent' && (
          <div style={cardStyle}>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                marginBottom: 20,
              }}
            >
              {flow === 'CLAUDE' ? (
                <>
                  South African law requires us to verify your identity before
                  we can release the funds from your first sale. You&apos;ll
                  enter your ID details, upload a photo or PDF of your SA ID,
                  and take a quick selfie. You can stop at any point and
                  finish later — your progress is saved.
                </>
              ) : (
                <>
                  South African law requires us to verify your identity before
                  we can release the funds from your first sale. We check your
                  SA ID against Home Affairs and match a selfie to your
                  official ID photo — done in under a minute.
                </>
              )}
            </div>
            <label
              style={{
                display: 'flex',
                gap: 12,
                alignItems: 'flex-start',
                cursor: 'pointer',
                marginBottom: 24,
              }}
            >
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                style={{
                  marginTop: 2,
                  accentColor: 'var(--red)',
                  width: 16,
                  height: 16,
                  flexShrink: 0,
                }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                  lineHeight: 1.6,
                }}
              >
                {flow === 'CLAUDE' ? (
                  // POPIA s72(1)(b) — consent to a cross-border transfer is only
                  // valid if it is INFORMED. This previously said the document
                  // and selfie were assessed by "Gun Galore's automated systems",
                  // which named no processor and no transfer, while the Privacy
                  // Policy relied on this checkbox as the basis for sending
                  // biometric data to the United States. Say what actually
                  // happens, or the consent carries nothing.
                  <>
                    I consent to All Outdoor verifying my identity using my SA
                    ID number, date of birth, ID document and a selfie. The ID
                    number is checked against official records by VerifyNow
                    (Pty) Ltd. My ID document and selfie are stored with our
                    image-hosting provider and sent to our AI provider, both in
                    the United States, for an automated authenticity and
                    face-match check, and are reviewed by our staff where
                    needed — all in accordance with POPIA and the{' '}
                    <a
                      href="/privacy"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--red)' }}
                    >
                      Privacy Policy
                    </a>
                    .
                  </>
                ) : (
                  <>
                    I consent to All Outdoor verifying my identity using my SA
                    ID number and a selfie. This check is performed by
                    VerifyNow (Pty) Ltd in accordance with POPIA.
                  </>
                )}
              </span>
            </label>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <button
              onClick={handleConsent}
              disabled={!consentChecked || loading}
              style={primaryButton(!consentChecked || loading)}
            >
              {loading ? 'Please wait…' : 'Continue'}
            </button>
          </div>
        )}

        {/* ─── Claude Step 2: ID number + date of birth ─────────── */}
        {step === 'details' && (
          <div style={cardStyle}>
            {verifiedName && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(34,197,94,0.1)',
                  border: '0.5px solid rgba(34,197,94,0.3)',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#22c55e',
                  marginBottom: 16,
                  textAlign: 'center',
                }}
              >
                Welcome, {verifiedName}
              </div>
            )}
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                marginBottom: 20,
                lineHeight: 1.5,
              }}
            >
              Enter your South African ID number and your date of birth. We
              check the ID number against official records.
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={labelStyle}>SA ID Number *</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={13}
                placeholder="13-digit ID number"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value.replace(/\D/g, ''))}
                style={inputStyle}
              />
              {idNumber.length > 0 && idNumber.length !== 13 && (
                <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
                  Must be 13 digits ({idNumber.length}/13)
                </div>
              )}
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>Date of birth *</label>
              {/* reach="far" puts a decade strip above the years: a
                  fifty-year-old should not tap the arrow four times to reach
                  the decade they were born in. */}
              <DateField
                label="Date of birth"
                value={dob}
                onChange={setDob}
                style={inputStyle}
                min="1900-01-01"
                max={dobMax}
                focusYear={todayYmd().y - 40}
                reach="far"
                required
              />
            </div>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <button
              onClick={handleDetailsSubmit}
              disabled={loading || idNumber.length !== 13 || !dob}
              style={primaryButton(loading || idNumber.length !== 13 || !dob)}
            >
              {loading ? 'Checking your details…' : 'Continue'}
            </button>
            <SaveLaterLink />
          </div>
        )}

        {/* ─── Claude Step 3: ID document upload ────────────────── */}
        {step === 'document' && (
          <div style={cardStyle}>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              {/* Reworded when the camera joined the picker: "Upload" was the
                  only verb, and it named the one method that is now not the
                  quickest for most people. */}
              Photograph or upload your South African ID — smart card (photo
              side) or green ID book (photo page). Make sure the photo, ID
              number and date of birth are readable.
            </div>

            {docPreviewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={docPreviewUrl}
                alt="ID document preview"
                style={{
                  width: '100%',
                  maxHeight: 220,
                  objectFit: 'contain',
                  borderRadius: 8,
                  background: 'var(--bg-deep)',
                  marginBottom: 14,
                }}
              />
            )}
            {!docPreviewUrl && docFileName && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                  marginBottom: 14,
                }}
              >
                📄 {docFileName}
              </div>
            )}

            {error && <ErrorBanner>{error}</ErrorBanner>}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf"
              style={{ display: 'none' }}
              onChange={(e) => onDocPicked(e.target.files?.[0] ?? null)}
            />
            {/* THE SAME TWO PEERS THE DOCUMENT CENTRE OFFERS.
                Operator, 2026-08-23: "on the KYC of the ID, use the same
                capture methods as we do with the Document centre. Upload or QR
                code to take a picture of it."

                ScanButton decides which camera is worth offering: on a phone
                the scanner opens with an aim guide, and on a desktop it offers
                the phone in the seller's pocket instead of a webcam that
                focuses at half a metre and cannot resolve an ID number. The
                picker is never replaced, only joined — a seller with a PDF scan
                from the bank still uses it. */}
            <ScanButton
              // Green book by default; the smart card is one tap away on the
              // chooser, and the guide is a suggestion either way.
              shape={shapeForKind('IDENTITY_DOCUMENT')}
              kind="IDENTITY_DOCUMENT"
              title="Photograph your ID"
              label="Photograph my ID"
              disabled={loading}
              onFiles={(files) => onDocPicked(files[0] ?? null)}
              // ⚠️ ONLY WITH A CLERK SESSION. Minting the hand-off link goes
              // through viewerFetch; a seller who arrived on the SMS token has
              // no session, so the mint would 401 — and they are already on the
              // phone, where the scanner above is the direct answer.
              handoff={actionToken ? undefined : { dest: 'kyc' }}
              onHandoffArrived={onDocArrivedFromPhone}
              fallback={
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  // Still the primary, still full width. The camera is the new
                  // peer beside it, not a replacement for it.
                  style={{ ...primaryButton(loading), flex: '1 1 100%' }}
                >
                  {loading
                    ? 'Uploading…'
                    : docFileName
                      ? 'Choose a different file'
                      : 'Choose photo or PDF'}
                </button>
              }
            />
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-tertiary)',
                marginTop: 10,
                textAlign: 'center',
                lineHeight: 1.5,
              }}
            >
              Max 10&nbsp;MB.
            </div>

            {/* THE SMS ESCAPE HATCH, AND ONLY THAT.
                ⚠️ THIS PANEL USED TO DRAW ITS OWN QR CODE HERE. ScanButton
                above now draws one that is strictly better — it lands the
                phone straight on the scanner with an aim guide, needs no
                sign-in there, and moves this page on by itself when the photo
                arrives — and two QR codes on one step is a choice nobody can
                make. So the QR is off and what survives is the reason this
                block was worth keeping: a seller who does not know what a QR
                code is can have the link texted to them instead.

                Still a disclosure, for the same reason as before: it is an
                option, not a fallback, and it must not push the upload button
                down the page. */}
            {flow === 'CLAUDE' && (
              <details className="gg-disclose" style={{ marginTop: 14 }}>
                <summary
                  style={{
                    cursor: 'pointer',
                    listStyle: 'none',
                    textAlign: 'center',
                    fontSize: 13,
                    color: 'var(--red)',
                  }}
                >
                  Rather have the link sent to your phone →
                </summary>
                <div style={{ marginTop: 14 }}>
                  <CameraUnavailableHandoff
                    returnTo={returnTo}
                    actionToken={actionToken}
                    phoneMasked={phoneMasked}
                    showQr={false}
                    eyebrow="Continue on your phone"
                    lead="We can text you a link that opens this same step on your phone, where you photograph your ID with the camera app. This page keeps your progress."
                    onSmsRequest={async () => {
                      const r = await apiPost('handoff-sms');
                      return (r.phoneMasked as string) ?? phoneMasked ?? '';
                    }}
                  />
                </div>
              </details>
            )}

            <SaveLaterLink />
          </div>
        )}

        {/* ─── Step 2 (legacy): SA ID number ────────────────────── */}
        {step === 'id' && (
          <div style={cardStyle}>
            {verifiedName && (
              <div
                style={{
                  padding: '10px 14px',
                  background: 'rgba(34,197,94,0.1)',
                  border: '0.5px solid rgba(34,197,94,0.3)',
                  borderRadius: 6,
                  fontSize: 13,
                  color: '#22c55e',
                  marginBottom: 16,
                  textAlign: 'center',
                }}
              >
                Welcome, {verifiedName}
              </div>
            )}
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                marginBottom: 20,
                lineHeight: 1.5,
              }}
            >
              Enter your South African ID number. We&apos;ll cross-check it
              against the Home Affairs records.
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>SA ID Number *</label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={13}
                placeholder="13-digit ID number"
                value={idNumber}
                onChange={(e) =>
                  setIdNumber(e.target.value.replace(/\D/g, ''))
                }
                style={inputStyle}
              />
              {idNumber.length > 0 && idNumber.length !== 13 && (
                <div
                  style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}
                >
                  Must be 13 digits ({idNumber.length}/13)
                </div>
              )}
            </div>
            {error && <ErrorBanner>{error}</ErrorBanner>}
            <button
              onClick={handleIdSubmit}
              disabled={loading || idNumber.length !== 13}
              style={primaryButton(loading || idNumber.length !== 13)}
            >
              {loading ? 'Checking with Home Affairs…' : 'Verify ID'}
            </button>
          </div>
        )}

        {/* ─── Step 3: selfie ───────────────────────────────────── */}
        {step === 'selfie' && (
          <div style={cardStyle}>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                marginBottom: 16,
                lineHeight: 1.5,
              }}
            >
              Position your face inside the circle and capture a clear selfie
              in good lighting.
            </div>

            {cameraUnavailable ? (
              // No camera on this device — render a QR code that
              // points to /kyc/verify so the user can scan with their
              // phone and finish the live capture there. File upload
              // is deliberately NOT offered as a fallback: it would
              // defeat the liveness check (anyone could submit any
              // photo). The phone-handoff route forces the selfie to
              // come from a real camera at the time of submission.
              <CameraUnavailableHandoff
                returnTo={returnTo}
                actionToken={actionToken}
                phoneMasked={flow === 'CLAUDE' ? phoneMasked : null}
                onSmsRequest={
                  flow === 'CLAUDE'
                    ? async () => {
                        const r = await apiPost('handoff-sms');
                        return (r.phoneMasked as string) ?? phoneMasked ?? '';
                      }
                    : undefined
                }
              />
            ) : (
              <div style={{ position: 'relative', marginBottom: 20 }}>
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '1 / 1',
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: 'var(--bg-deep)',
                    position: 'relative',
                  }}
                >
                  {!capturedImage ? (
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block',
                        // MIRROR THE PREVIEW ONLY.
                        //
                        // Raw front-camera video is not mirrored, so moving
                        // your head left moves the image right — every person
                        // reads that as broken, because a camera pointed at
                        // your own face is expected to behave like a mirror.
                        //
                        // This is CSS on the rendered element. captureFrame()
                        // draws from the <video> element's own frames, which
                        // are untouched by a CSS transform, so what we send to
                        // the face-match stays the TRUE, unmirrored image.
                        // Mirroring the captured bytes would be the actual bug.
                        //
                        // Safe here because this camera is selfie-only
                        // (facingMode: 'user'); the ID document is uploaded as
                        // a photo/PDF, never shot through this preview. If a
                        // document camera is ever added it must NOT inherit
                        // this — reversed text breaks OCR.
                        transform: 'scaleX(-1)',
                      }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`data:image/jpeg;base64,${capturedImage}`}
                      alt="Captured selfie"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  )}
                  {!capturedImage && cameraActive && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '65%',
                        height: '65%',
                        borderRadius: '50%',
                        border: '2px solid rgba(192,57,43,0.7)',
                        pointerEvents: 'none',
                      }}
                    />
                  )}
                  {loading && (
                    <div
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: 'rgba(0,0,0,0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          border: '2px solid var(--border)',
                          borderTop: '2px solid var(--red)',
                          borderRadius: '50%',
                          animation: 'kyc-spin 0.8s linear infinite',
                        }}
                      />
                      <div
                        style={{ fontSize: 12, color: 'var(--text-secondary)' }}
                      >
                        Verifying…
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {error && <ErrorBanner>{error}</ErrorBanner>}

            {!cameraUnavailable && !capturedImage && (
              <button
                onClick={captureFrame}
                disabled={!cameraActive || loading}
                style={primaryButton(!cameraActive || loading)}
              >
                Capture
              </button>
            )}
            {!cameraUnavailable && capturedImage && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={retake}
                  disabled={loading}
                  style={{
                    flex: 1,
                    background: 'transparent',
                    color: 'var(--text-secondary)',
                    border: '0.5px solid var(--border)',
                    borderRadius: 6,
                    padding: 14,
                    fontSize: 14,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  Retake
                </button>
                <button
                  onClick={() => submitSelfie(capturedImage)}
                  disabled={loading}
                  style={{ ...primaryButton(loading), flex: 2 }}
                >
                  {loading ? 'Verifying…' : 'Submit'}
                </button>
              </div>
            )}
            <SaveLaterLink />
          </div>
        )}

        {/* ─── Success ─────────────────────────────────────────── */}
        {step === 'success' && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: '32px 24px' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'rgba(34,197,94,0.1)',
                border: '0.5px solid rgba(34,197,94,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: 24,
                color: '#22c55e',
              }}
            >
              ✓
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: '#22c55e',
                marginBottom: 8,
              }}
            >
              Identity verified
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                lineHeight: 1.5,
              }}
            >
              Your pending sale can now proceed.
            </div>
            {idOffer === 'idle' && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-tertiary)',
                  marginTop: 12,
                }}
              >
                Redirecting…
              </div>
            )}
            {idOffer === 'answered' && (
              <button
                type="button"
                onClick={() => router.push(returnTo)}
                style={{
                  marginTop: 16,
                  padding: '10px 18px',
                  borderRadius: 'var(--r-sm)',
                  border: '0.5px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Continue
              </button>
            )}
          </div>
        )}

        {/* ─── Under review (Claude flow) ──────────────────────── */}
        {step === 'review' && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: '32px 24px' }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'rgba(245,158,11,0.1)',
                border: '0.5px solid rgba(245,158,11,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                fontSize: 24,
              }}
            >
              🕑
            </div>
            <div
              style={{
                fontSize: 16,
                fontWeight: 500,
                color: '#f59e0b',
                marginBottom: 8,
              }}
            >
              Verification being reviewed
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                lineHeight: 1.6,
                marginBottom: 20,
              }}
            >
              Nothing more is needed from you. Our team is double-checking
              your submission — we&apos;ll SMS you as soon as it&apos;s done.
              Your listings stay live in the meantime.
            </div>
            <Link
              href={returnTo}
              style={{
                display: 'inline-block',
                background: 'transparent',
                color: 'var(--text-secondary)',
                border: '0.5px solid var(--border)',
                borderRadius: 6,
                padding: '12px 24px',
                fontSize: 13,
                textDecoration: 'none',
              }}
            >
              Done
            </Link>
          </div>
        )}

        {/* ─── Failed ──────────────────────────────────────────── */}
        {step === 'failed' && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: '32px 24px' }}>
            <div
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--red)',
                marginBottom: 8,
              }}
            >
              Verification failed
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--text-tertiary)',
                marginBottom: 20,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
            {flow === 'CLAUDE' ? (
              // Rejected verdict → point the seller to support (the 50-69
              // band already routes borderline cases to a human). A quiet
              // retry stays available in case it was just a bad capture.
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=Identity%20verification%20help`}
                  style={{
                    ...primaryButton(false),
                    width: 'auto',
                    padding: '12px 24px',
                    textDecoration: 'none',
                    display: 'inline-block',
                  }}
                >
                  Email support
                </a>
                {attempts < 3 && (
                  <button
                    onClick={() => {
                      setStep('selfie');
                      setError('');
                      setCapturedImage(null);
                      void startCamera();
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--text-tertiary)',
                      fontSize: 12,
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Try again
                  </button>
                )}
              </div>
            ) : attempts < 3 ? (
              <button
                onClick={() => {
                  setStep('selfie');
                  setError('');
                  setCapturedImage(null);
                  void startCamera();
                }}
                style={{ ...primaryButton(false), width: 'auto', padding: '12px 24px' }}
              >
                Try again
              </button>
            ) : (
              <Link
                href="/dashboard"
                style={{
                  display: 'inline-block',
                  background: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  borderRadius: 6,
                  padding: '12px 24px',
                  fontSize: 13,
                  textDecoration: 'none',
                }}
              >
                Back to dashboard
              </Link>
            )}
          </div>
        )}

        <div
          style={{
            marginTop: 16,
            fontSize: 11,
            color: 'var(--text-tertiary)',
            textAlign: 'center',
            lineHeight: 1.5,
            opacity: 0.7,
          }}
        >
          Verified against SA Home Affairs · POPIA compliant · Never shared.
        </div>
        <style>{`@keyframes kyc-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </main>
  );
}

// Rendered on the selfie step when the user's device has no camera.
// Shows a QR code that opens /kyc/verify on whatever device scans it —
// the user signs in to All Outdoor on their phone and finishes the live
// capture there. Liveness preserved (the selfie still comes from a
// real camera at the time of capture). File upload is intentionally
// NOT offered as a workaround.
//
// Claude flow adds an "SMS me the link" button for sellers who don't
// know what a QR code is — the backend mints a 7-day token and texts
// the /a/<token> link to the phone on file.
function CameraUnavailableHandoff({
  returnTo,
  actionToken,
  phoneMasked,
  onSmsRequest,
  eyebrow,
  lead,
  showQr = true,
}: {
  returnTo: string;
  actionToken: string | null;
  phoneMasked?: string | null;
  onSmsRequest?: () => Promise<string>;
  /** Overrides for the ID-document step, where the panel is an OPTION the
   *  seller may prefer rather than a fallback for a missing camera. */
  eyebrow?: string;
  lead?: string;
  /**
   * Off on the ID-document step, where ScanButton already puts a QR on the
   * screen — and a better one, pointing at the scanner rather than at the
   * whole wizard. Two codes side by side is a decision the seller has no way
   * to make. What is left here is the SMS, which the other one does not do.
   */
  showQr?: boolean;
}) {
  const [smsState, setSmsState] = useState<
    'idle' | 'sending' | 'sent' | 'cooldown'
  >('idle');
  const [smsSentTo, setSmsSentTo] = useState('');
  const [smsError, setSmsError] = useState('');

  async function handleSms() {
    if (!onSmsRequest || smsState === 'sending' || smsState === 'cooldown')
      return;
    setSmsState('sending');
    setSmsError('');
    try {
      const masked = await onSmsRequest();
      setSmsSentTo(masked);
      setSmsState('cooldown');
      // 60s cooldown before re-enable so a slow SMS doesn't get hammered.
      setTimeout(() => setSmsState('sent'), 60_000);
    } catch (err) {
      setSmsError(
        err instanceof Error ? err.message : 'Could not send the SMS.',
      );
      setSmsState('idle');
    }
  }
  // The QR points to the same /kyc/verify URL, carrying the action token
  // (so the phone stays login-free too) AND the original returnTo so the
  // seller lands back where they came from after finishing on their
  // phone. window check covers the SSR pass.
  const handoffUrl = (() => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams();
    if (actionToken) params.set('t', actionToken);
    if (returnTo && returnTo !== '/dashboard' && returnTo !== '/') {
      params.set('returnTo', returnTo);
    }
    const qs = params.toString();
    return `${window.location.origin}/kyc/verify${qs ? `?${qs}` : ''}`;
  })();

  return (
    <div
      style={{
        padding: 20,
        background: 'var(--bg-inset)',
        borderRadius: 8,
        marginBottom: 20,
        fontSize: 13,
        color: 'var(--text-secondary)',
        lineHeight: 1.55,
      }}
    >
      <p
        className="uppercase mb-3"
        style={{
          fontSize: 11,
          color: 'var(--red)',
          letterSpacing: '0.06em',
          fontWeight: 600,
          textAlign: 'center',
        }}
      >
        {eyebrow ?? 'No camera on this device'}
      </p>
      <p style={{ marginBottom: 14, textAlign: 'center' }}>
        {lead ??
          'Scan this QR code with your phone to finish identity verification on a device with a camera.'}
      </p>

      {/* QR code on white background so dark-mode pixels stay scannable. */}
      {showQr && (
        <div
          style={{
            background: '#fff',
            padding: 16,
            borderRadius: 8,
            width: 'fit-content',
            margin: '0 auto 14px',
          }}
        >
          {handoffUrl && (
            <QRCodeSVG value={handoffUrl} size={180} level="M" includeMargin={false} />
          )}
        </div>
      )}

      <p
        style={{
          fontSize: 11,
          color: 'var(--text-tertiary)',
          textAlign: 'center',
          marginBottom: 10,
        }}
      >
        Your progress so far is saved — your phone picks up right where
        you left off.
      </p>

      {/* "SMS me the link" — same handoff for sellers who don't use QR
          codes. Hidden when there's no phone on file or no handler
          (legacy flow). */}
      {onSmsRequest && (
        <div style={{ marginTop: 14, textAlign: 'center' }}>
          {phoneMasked || smsSentTo ? (
            <>
              <button
                type="button"
                onClick={handleSms}
                disabled={smsState === 'sending' || smsState === 'cooldown'}
                style={{
                  background:
                    smsState === 'sending' || smsState === 'cooldown'
                      ? 'var(--bg-card)'
                      : 'var(--red)',
                  color:
                    smsState === 'sending' || smsState === 'cooldown'
                      ? 'var(--text-tertiary)'
                      : '#fff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '10px 18px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor:
                    smsState === 'sending' || smsState === 'cooldown'
                      ? 'not-allowed'
                      : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {smsState === 'sending'
                  ? 'Sending…'
                  : smsState === 'cooldown'
                    ? `Sent to ${smsSentTo}`
                    : smsState === 'sent'
                      ? 'SMS the link again'
                      : `Rather SMS the link to ${phoneMasked}`}
              </button>
              {smsState === 'cooldown' && (
                <p
                  style={{
                    fontSize: 11,
                    color: 'var(--text-tertiary)',
                    marginTop: 8,
                  }}
                >
                  Open the SMS on your phone and tap the link. You can
                  request another in a minute if it doesn&apos;t arrive.
                </p>
              )}
              {smsError && (
                <p style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>
                  {smsError}
                </p>
              )}
            </>
          ) : (
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              Want the link by SMS instead? Add a phone number on your
              profile first.
            </p>
          )}
        </div>
      )}

      <div
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: '0.5px solid var(--border)',
          fontSize: 11,
          color: 'var(--text-tertiary)',
          textAlign: 'center',
          lineHeight: 1.5,
        }}
      >
        No smartphone either?{' '}
        <a
          href={`mailto:${SUPPORT_EMAIL}?subject=KYC%20without%20camera`}
          style={{ color: 'var(--red)', textDecoration: 'none' }}
        >
          Email support
        </a>{' '}
        to arrange manual verification.
      </div>
    </div>
  );
}
