'use client';

// components/kyc/liveness-challenge.tsx
//
// The anti-spoofing step: AWS Rekognition Face Liveness, run in the browser.
//
// WHY THIS EXISTS AT ALL. The KYC verdict has an integrity gate called
// `selfie_live_capture` — is this a live person, or a photo of a photo, or a
// face held up to the screen? Nothing on the server can answer that from a
// still image. AWS's only answer is a challenge-response video session, and a
// challenge can only be run where the camera is. Without it every seller
// parks in UNDER_REVIEW, because the alternative — scoring a check nobody ran
// as a pass — would delete the gate while still looking like it worked.
//
// ── Three things about this component that are not obvious ────────────
//
// 1. IT OWNS THE CAMERA. FaceLivenessDetectorCore opens its own getUserMedia
//    stream and renders its own UI. It cannot share the camera with the
//    wizard's manual capture, so the two are SEQUENCED, never concurrent:
//    the seller captures their selfie first, the page releases the camera,
//    and only then does this mount. See the ordering note in the wizard.
//
// 2. THE START SCREEN STAYS. `disableStartScreen` is deliberately not set.
//    The default start screen carries AWS's photosensitivity warning, and
//    the challenge flashes coloured light at the face. Removing that warning
//    to save a tap would be a real harm to a small number of people, so the
//    screen is not ours to skip.
//
// 3. THE CLOCK IS ALREADY RUNNING WHEN THIS MOUNTS. A liveness session
//    expires three minutes after the server creates it, and it is single
//    use. That is why the session is fetched at submit time rather than when
//    the step opens, and why an expiry is a fresh session — never a retry of
//    the old id.

import dynamic from 'next/dynamic';
import { useCallback } from 'react';
// Only ErrorState is re-exported at the package root; LivenessError lives in
// a deep path, so its two fields are restated here rather than imported from
// an internal one that a minor version is free to move.
import type { ErrorState } from '@aws-amplify/ui-react-liveness';

// The component's own stylesheet. It is a vendor global, imported here so it
// travels with the only route that uses it rather than the whole app.
//
// ⚠️ IT WILL RENDER FLAT. globals.css carries `* { box-shadow: none
// !important }` — a deliberate kill switch, because months of shadows were
// authored for a dark theme that no longer exists. An !important universal
// rule cannot be opted out of by a subtree, so this component's elevation is
// gone and cannot be given back without knowing its exact shadow values.
// Cosmetic only: nothing about the challenge depends on a shadow.
// ⚠️ ONE STYLESHEET, NOT TWO. @aws-amplify/ui-react-liveness ALSO exports a
// styles.css, and AWS's own sample imports only this one — which looks like
// an oversight that would leave the oval, the countdown and the freshness
// canvas unstyled. It is not: the two files are the same 339KB build (both
// carry all 77 .amplify-liveness-* rules), so importing both just ships it
// twice. Checked, rather than assumed, because unstyled camera chrome would
// be a broken challenge rather than a cosmetic slip.
import '@aws-amplify/ui-react/styles.css';

export interface LivenessSession {
  sessionId: string;
  region: string;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
    expiration: string;
  };
}

// ssr:false because the component reaches for the camera, the DOM and a WASM
// backend at module scope — none of which exist while rendering on a server.
const FaceLivenessDetectorCore = dynamic(
  () =>
    import('@aws-amplify/ui-react-liveness').then(
      (m) => m.FaceLivenessDetectorCore,
    ),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          padding: 32,
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 13,
        }}
      >
        Starting the liveness check…
      </div>
    ),
  },
);

const GENERIC_FAILURE =
  'The liveness check could not be completed. Please try again.';

/**
 * What the seller should actually DO about each failure.
 *
 * ⚠️ TYPED AS A FULL RECORD ON PURPOSE. If AWS adds an error state in a
 * later SDK version, this object stops satisfying Record<ErrorState, string>
 * and the BUILD FAILS — which is the point. The alternative is a partial map
 * that silently degrades every new failure into "please try again", and the
 * two most useful messages here (turn your phone upright; you are not alone
 * in frame) are exactly the ones that would be lost that way.
 */
const RETRY_GUIDANCE: Record<ErrorState, string> = {
  CAMERA_ACCESS_ERROR:
    'We could not use your camera. Allow camera access in your browser, then try again.',
  DEFAULT_CAMERA_NOT_FOUND_ERROR:
    'We could not find a camera on this device. Try again on your phone.',
  CAMERA_FRAMERATE_ERROR:
    'Your camera is running too slowly for this check. Close other apps that might be using it, then try again.',
  MOBILE_LANDSCAPE_ERROR:
    'Please hold your phone upright and try again.',
  MULTIPLE_FACES_ERROR:
    'More than one face was in the picture. Make sure you are alone in frame, then try again.',
  FACE_DISTANCE_ERROR:
    'Your face moved too close to the camera. Hold the phone at arm’s length and try again.',
  FRESHNESS_TIMEOUT:
    'The check timed out. Try again and hold still once the oval appears.',
  TIMEOUT: 'The check timed out. Please try again.',
  CONNECTION_TIMEOUT:
    'The connection dropped during the check. Check your signal and try again.',
  SERVER_ERROR: GENERIC_FAILURE,
  RUNTIME_ERROR:
    'The liveness check could not start on this device. Please try a different browser or device.',
};

interface Props {
  session: LivenessSession;
  /** The challenge finished. The RESULT is read server-side, not here. */
  onComplete: () => void;
  /** Something went wrong. The message is already seller-readable. */
  onFailed: (message: string) => void;
  /** The seller backed out. Not a failure — offer the choice again. */
  onCancel: () => void;
}

export default function LivenessChallenge({
  session,
  onComplete,
  onFailed,
  onCancel,
}: Props) {
  // Handed to the streaming client instead of Amplify's own auth.
  //
  // 🚨 THIS IS WHY THERE IS NO COGNITO IDENTITY POOL. The documented route is
  // an UNAUTHENTICATED Cognito identity pool — a public guest identity anyone
  // on the internet can pull credentials from. We already know exactly who
  // this person is: they are signed in and part-way through verification. So
  // the server mints credentials for one assumed role that can do nothing but
  // start a liveness stream, behind our own auth guard, and hands them over
  // here. Supplying this function makes the SDK skip fetchAuthSession()
  // entirely (see resolveCredentials in the package source).
  //
  // ⚠️ CALLED ONCE, AT THE START OF THE FLOW — there is no refresh. Whatever
  // is returned has to stay valid for the whole challenge, which is why the
  // server asks for the 900-second minimum rather than something tighter.
  const credentialProvider = useCallback(
    async () => ({
      accessKeyId: session.credentials.accessKeyId,
      secretAccessKey: session.credentials.secretAccessKey,
      sessionToken: session.credentials.sessionToken,
      expiration: new Date(session.credentials.expiration),
    }),
    [session],
  );

  return (
    <div
      // Above every other overlay in the app: modals here start at 60, and a
      // camera challenge that something else can cover is a broken challenge.
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'var(--bg-deep, #111)',
        display: 'flex',
        flexDirection: 'column',
        // 100vh, NOT 100dvh. iOS Chrome in standalone is not chromeless, and
        // dvh leaves a white bar there — the same trap the PWA shell hit.
        height: '100vh',
      }}
      data-testid="kyc-liveness-overlay"
    >
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <FaceLivenessDetectorCore
          sessionId={session.sessionId}
          // Must be the region the session was CREATED in. It comes back from
          // our own endpoint rather than being hard-coded here, because a
          // hard-coded copy is how the two drift apart.
          region={session.region}
          config={{ credentialProvider }}
          // Fires when AWS has finished analysing. The verdict itself is NOT
          // read here: GetFaceLivenessSessionResults is a server call, made
          // once, at verdict time. A browser that could read its own liveness
          // result could also lie about it.
          onAnalysisComplete={async () => {
            onComplete();
          }}
          onUserCancel={onCancel}
          onError={(err: { state: ErrorState; error: Error }) => {
            onFailed(RETRY_GUIDANCE[err.state] ?? GENERIC_FAILURE);
          }}
        />
      </div>
    </div>
  );
}
