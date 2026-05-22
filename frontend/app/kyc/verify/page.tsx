'use client';

import { useState, useEffect, useRef, Suspense, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import Image from 'next/image';
import Link from 'next/link';
import { QRCodeSVG } from 'qrcode.react';
import { HelpTip } from '@/components/help-tip';

// PORTED from gun_galore_project/frontend/src/app/verify/kyc/page.tsx —
// same flow, adapted to gun-galore's design tokens (var(--bg-card),
// var(--red) etc.) so it matches every other surface. The QR-fallback
// branch from the original (for desktops with no webcam) is intentionally
// dropped — keeping the surface area small until a seller actually asks
// for it. Camera-less devices currently see a "use your phone" hint.
//
// IMPORTANT: do not "improve" the VerifyNow request bodies or response
// parsing without re-testing the full flow against the real API — both
// idNumber + selfieBase64 shapes are dictated by VerifyNow.

type Step = 'consent' | 'id' | 'selfie' | 'success' | 'failed';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

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

  const [step, setStep] = useState<Step>('consent');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [idNumber, setIdNumber] = useState('');
  const [verifiedName, setVerifiedName] = useState('');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraUnavailable, setCameraUnavailable] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // returnTo lets us send the seller back to where they came from (e.g.
  // the transaction page that prompted them).
  const returnTo = searchParams.get('returnTo') || '/dashboard';

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.push('/sign-in?redirect_url=/kyc/verify');
  }, [isLoaded, isSignedIn, router]);

  // Stop the camera stream on unmount so it doesn't keep recording.
  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apiPost(path: string, body?: object) {
    const token = await getToken();
    const res = await fetch(`${API_URL}/kyc/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
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
      setStep('id');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
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

  // ─── Step 3: submit selfie ───────────────────────────────────────
  async function submitSelfie(base64: string) {
    setLoading(true);
    setError('');
    try {
      const data = await apiPost('face-match', { selfieBase64: base64, idNumber });
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      if (data.success) {
        setStep('success');
        setTimeout(() => router.push(returnTo), 3000);
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

  // Step indicator pill bar.
  function StepBar() {
    const items: { key: Step; label: string }[] = [
      { key: 'consent', label: 'Consent' },
      { key: 'id', label: 'ID Verify' },
      { key: 'selfie', label: 'Face Match' },
    ];
    const order: Step[] = ['consent', 'id', 'selfie'];
    const currentIdx = order.indexOf(step);
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 24,
          justifyContent: 'center',
        }}
      >
        {items.map((s, i) => {
          const sIdx = order.indexOf(s.key);
          const done = currentIdx > sIdx || step === 'success';
          const active = currentIdx === sIdx;
          return (
            <div
              key={s.key}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }}
            >
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: done || active ? 'var(--red)' : 'var(--bg-inset)',
                  border: '0.5px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  color: '#fff',
                  fontWeight: 500,
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
                }}
              >
                {s.label}
              </span>
              {i < items.length - 1 && (
                <div
                  style={{ width: 24, height: '0.5px', background: 'var(--border)' }}
                />
              )}
            </div>
          );
        })}
      </div>
    );
  }

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
      <div style={{ width: '100%', maxWidth: 390 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Image
            src="/logo.svg"
            alt="Gun Galore"
            width={180}
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
              South African law (FICA + POPIA) requires us to verify
              every seller before releasing funds. We use VerifyNow — a
              licensed identity-checking service — to cross-check your
              SA ID against Home Affairs and match a selfie to your
              official photo. Takes under a minute. Your ID number is
              encrypted; your selfie isn&apos;t stored after the match.
            </HelpTip>
          </div>
          <div
            style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}
          >
            Required to release your payout on Gun Galore
          </div>
        </div>

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
              South African law requires us to verify your identity before we
              can release the funds from your first sale. We check your SA ID
              against Home Affairs and match a selfie to your official ID photo
              — done in under a minute.
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
                I consent to Gun Galore verifying my identity using my SA ID
                number and a selfie. This check is performed by VerifyNow (Pty)
                Ltd in accordance with POPIA.
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

        {/* ─── Step 2: SA ID number ─────────────────────────────── */}
        {step === 'id' && (
          <div style={cardStyle}>
            <StepBar />
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
            <StepBar />
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
              <CameraUnavailableHandoff returnTo={returnTo} />
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
            <div
              style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 12 }}
            >
              Redirecting…
            </div>
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
            {attempts < 3 ? (
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
// the user signs in to Gun Galore on their phone and finishes the live
// capture there. Liveness preserved (the selfie still comes from a
// real camera at the time of capture). File upload is intentionally
// NOT offered as a workaround.
function CameraUnavailableHandoff({ returnTo }: { returnTo: string }) {
  // The QR points to the same /kyc/verify URL, carrying the original
  // returnTo so the seller lands back where they came from after
  // finishing on their phone. window check covers the SSR pass.
  const handoffUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/kyc/verify${
          returnTo && returnTo !== '/dashboard'
            ? `?returnTo=${encodeURIComponent(returnTo)}`
            : ''
        }`
      : '';

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
        No camera on this device
      </p>
      <p style={{ marginBottom: 14, textAlign: 'center' }}>
        Scan this QR code with your phone to finish identity
        verification on a device with a camera.
      </p>

      {/* QR code on white background so dark-mode pixels stay scannable. */}
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

      <p
        style={{
          fontSize: 11,
          color: 'var(--text-tertiary)',
          textAlign: 'center',
          marginBottom: 10,
        }}
      >
        You&apos;ll be asked to sign in on your phone, then re-enter
        your ID number. The whole thing takes under a minute.
      </p>

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
          href="mailto:support@gungalore.co.za?subject=KYC%20without%20camera"
          style={{ color: 'var(--red)', textDecoration: 'none' }}
        >
          Email support
        </a>{' '}
        to arrange manual verification.
      </div>
    </div>
  );
}
