// backend/src/kyc/aws-kyc.service.ts
//
// The AWS half of KYC: Textract reads the identity document, Rekognition
// matches the face and runs the liveness challenge. VerifyNow is unchanged
// and still checks the ID number against the Home Affairs name and date of
// birth — AWS replaces the vision work, not the identity lookup.
//
// ⚠️ REGION IS NOT A PREFERENCE. eu-west-1 (Ireland) is the only European
// region carrying all three of Textract, Rekognition and Face Liveness:
// eu-north-1 (Stockholm) has neither service, and eu-central-1 (Frankfurt)
// has Rekognition but NOT Face Liveness. Verified against the consoles
// themselves rather than the docs. The IAM policy in
// infra/aws/kyc-iam-policy.json DENIES textract:* and rekognition:* outside
// eu-west-1, so a misconfigured region fails loudly instead of quietly
// sending South African identity documents somewhere unintended.
//
// ⚖️ POPIA §72(1)(b): the cross-border transfer consent the seller gives
// must be INFORMED, which means the consent copy has to name AWS Ireland.
// Do not put live seller documents through this service until it does.

import { Injectable, Logger } from '@nestjs/common';
import {
  AnalyzeDocumentCommand,
  TextractClient,
} from '@aws-sdk/client-textract';
import { AssumeRoleCommand, STSClient } from '@aws-sdk/client-sts';
import {
  CompareFacesCommand,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';

import { buildAwsFindings, type AwsFindings, type FaceComparison } from './aws-kyc-findings';
import type { TextractResponse } from './textract-extract';

/** The selfie itself had no detectable face — a retake, not a verdict. */
export class NoFaceInSelfieError extends Error {
  constructor() {
    super('no face detected in the selfie');
    this.name = 'NoFaceInSelfieError';
  }
}

/**
 * Short-lived AWS credentials handed to the BROWSER so it can stream the
 * liveness challenge. Shaped to match what Amplify's FaceLivenessDetectorCore
 * expects back from its `config.credentialProvider`.
 */
export interface BrowserLivenessCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ISO-8601. The browser gets ONE set: the provider is not called again. */
  expiration: string;
}

export interface LivenessOutcome {
  status: 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CREATED' | 'IN_PROGRESS' | string;
  /** 0-100, present only on a completed session. */
  confidence?: number;
  /**
   * The frame AWS captured of the live person, as raw bytes.
   *
   * 🚨 THIS IS THE SELFIE WORTH TRUSTING. A selfie posted by the browser is
   * whatever the client chose to send; this one is a frame from a challenge
   * AWS itself supervised. Prefer it for the face comparison whenever a
   * session succeeded — matching against a client-supplied image while
   * holding a server-verified one would throw away the whole point of
   * running liveness.
   */
  referenceImage?: Buffer;
}

@Injectable()
export class AwsKycService {
  private readonly log = new Logger(AwsKycService.name);
  private textractClient?: TextractClient;
  private rekognitionClient?: RekognitionClient;
  private stsClient?: STSClient;

  /** eu-west-1 unless overridden; see the region note at the top. */
  private get region(): string {
    return process.env.AWS_REGION || 'eu-west-1';
  }

  /**
   * Credentials are read by the SDK's own provider chain, so the box can
   * use an instance role later without a code change. Presence of an
   * explicit key is what tells us the feature was deliberately configured.
   */
  enabled(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    );
  }

  private textract(): TextractClient {
    this.textractClient ??= new TextractClient({ region: this.region });
    return this.textractClient;
  }

  private rekognition(): RekognitionClient {
    this.rekognitionClient ??= new RekognitionClient({ region: this.region });
    return this.rekognitionClient;
  }

  /**
   * The whole AWS scan: liveness (when a session ran), OCR, and the face
   * comparisons — composed here so the caller has one seam to stub and
   * this file owns every AWS-shaped decision.
   */
  async scan(input: {
    documentBytes: Buffer;
    selfieBase64: string;
    haPhotoBase64?: string;
    livenessSessionId?: string;
  }): Promise<AwsFindings> {
    // ── Liveness first, because it decides WHICH selfie to trust ───────
    //
    // A selfie posted by the browser is whatever the client chose to send.
    // A Face Liveness reference image is a frame from a challenge AWS
    // supervised. When a session succeeded we match against the latter:
    // comparing a client-supplied image while holding a server-verified
    // one would throw away the point of running liveness at all.
    let livenessConfidence: number | undefined;
    let faceBytes: Buffer = Buffer.from(input.selfieBase64, 'base64');
    if (input.livenessSessionId) {
      const live = await this.livenessResult(input.livenessSessionId);
      if (live.status === 'SUCCEEDED') {
        livenessConfidence = live.confidence;
        if (live.referenceImage) faceBytes = live.referenceImage;
      } else if (live.status === 'FAILED') {
        // A failed challenge is EVIDENCE, not the absence of it — 0 rejects.
        livenessConfidence = 0;
      }
      // EXPIRED and anything else stay undefined: the challenge did not
      // complete, so nothing is known either way. Never score a timeout as
      // a spoof, and never score it as a pass.
    }

    const textract = await this.analyzeDocument(input.documentBytes);
    const vsDocument = await this.compareFaces(faceBytes, input.documentBytes);
    const vsHomeAffairs = input.haPhotoBase64
      ? await this.compareFaces(
          faceBytes,
          Buffer.from(input.haPhotoBase64, 'base64'),
        )
      : undefined;

    return buildAwsFindings({
      textract,
      vsDocument,
      vsHomeAffairs,
      livenessConfidence,
    });
  }
  /**
   * OCR the identity document with FORMS, which is what produces the
   * key/value block extractIdentity() reads.
   *
   * ⚠️ SYNCHRONOUS AnalyzeDocument TAKES IMAGES. A multi-page PDF needs the
   * asynchronous S3-based API instead, which this does not implement — a
   * PDF upload will throw here and park the seller for a human rather than
   * silently returning nothing. That is the correct failure while the PDF
   * path is unbuilt; it is not a claim that PDFs work.
   */
  async analyzeDocument(bytes: Buffer): Promise<TextractResponse> {
    const res = await this.textract().send(
      new AnalyzeDocumentCommand({
        Document: { Bytes: bytes },
        FeatureTypes: ['FORMS'],
      }),
    );
    return res as unknown as TextractResponse;
  }

  /**
   * Compare the selfie against a photo, returning the similarity whatever
   * it is.
   *
   * ⚠️ SimilarityThreshold IS 0 ON PURPOSE. The default is 80, and below it
   * AWS returns an EMPTY FaceMatches list — which is indistinguishable from
   * "there was no face in the image at all". Since one of those outcomes
   * must reject and the other must ask for a retake, the score has to come
   * back every time so the two can be told apart here rather than guessed
   * at downstream.
   */
  async compareFaces(selfie: Buffer, target: Buffer): Promise<FaceComparison> {
    try {
      const res = await this.rekognition().send(
        new CompareFacesCommand({
          SourceImage: { Bytes: selfie },
          TargetImage: { Bytes: target },
          SimilarityThreshold: 0,
        }),
      );
      const matches = res.FaceMatches ?? [];
      const unmatched = res.UnmatchedFaces ?? [];
      if (matches.length === 0 && unmatched.length === 0) {
        // A face was found in the selfie (or the call would have thrown)
        // but none in the target.
        return { similarity: null, noFaceInTarget: true };
      }
      const best = matches.reduce(
        (a, m) => Math.max(a, m.Similarity ?? 0),
        0,
      );
      return { similarity: best, noFaceInTarget: false };
    } catch (err) {
      // Rekognition raises InvalidParameterException when it cannot find a
      // face in the SOURCE image. That is the selfie, and it is a retake —
      // never a rejection, and never confusable with the target case above.
      if ((err as { name?: string }).name === 'InvalidParameterException') {
        throw new NoFaceInSelfieError();
      }
      throw err;
    }
  }

  /**
   * Mint temporary credentials for the browser to run the liveness stream.
   *
   * 🚨 OUR OWN KEY MUST NEVER REACH A BROWSER. The server key can read
   * identity documents, compare faces and pull liveness RESULTS; a page that
   * held it could call Rekognition against our account at will. So the
   * browser gets a role assumed for this one purpose, whose policy grants
   * `rekognition:StartFaceLivenessSession` and nothing else, region-locked
   * the same way the server's is.
   *
   * This is deliberately NOT Cognito. The documented alternative is an
   * unauthenticated Identity Pool, which means standing up a public guest
   * identity that anyone can obtain credentials from. We already know who
   * this seller is — they are signed in and mid-verification — so vending
   * from behind our own auth guard is both smaller and tighter.
   *
   * Returns undefined when AWS_KYC_LIVENESS_ROLE_ARN is unset, which is how
   * the feature stays off: no credentials means the browser runs no
   * challenge, which means the verdict cannot auto-approve and parks for a
   * human. Degraded, never silently passed.
   */
  async vendBrowserCredentials(
    subjectRef: string,
  ): Promise<BrowserLivenessCredentials | undefined> {
    const roleArn = process.env.AWS_KYC_LIVENESS_ROLE_ARN;
    if (!roleArn) {
      this.log.warn(
        'AWS_KYC_LIVENESS_ROLE_ARN unset — no browser liveness challenge can run, so every verdict will park for human review',
      );
      return undefined;
    }
    this.stsClient ??= new STSClient({ region: this.region });
    const res = await this.stsClient.send(
      new AssumeRoleCommand({
        RoleArn: roleArn,
        // Shows up in CloudTrail against every browser-side call, so a
        // suspicious stream can be traced back to one verification attempt.
        // Sanitised because AssumeRole rejects anything outside [\w+=,.@-].
        RoleSessionName: `kyc-${subjectRef.replace(/[^\w+=,.@-]/g, '')}`.slice(0, 64),
        // 900 is the AssumeRole minimum. The liveness session itself expires
        // after 3 minutes, so the credentials always outlive what they are
        // for — we cannot make them shorter-lived than the work.
        DurationSeconds: 900,
      }),
    );
    const c = res.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
      throw new Error('AssumeRole returned no usable credentials');
    }
    return {
      accessKeyId: c.AccessKeyId,
      secretAccessKey: c.SecretAccessKey,
      sessionToken: c.SessionToken,
      expiration: (c.Expiration ?? new Date(Date.now() + 900_000)).toISOString(),
    };
  }
  /**
   * Open a Face Liveness session. The returned id goes to the browser,
   * which runs the challenge with AWS Amplify's FaceLivenessDetector; the
   * result is then read back with livenessResult().
   */
  async createLivenessSession(): Promise<string> {
    const res = await this.rekognition().send(
      new CreateFaceLivenessSessionCommand({}),
    );
    if (!res.SessionId) throw new Error('Rekognition returned no SessionId');
    return res.SessionId;
  }

  /**
   * Read a liveness session back.
   *
   * ⚠️ A SESSION RESULT CAN BE READ ONLY ONCE, and only within a few
   * minutes of the challenge. Call this at verdict time and persist what it
   * says; a second call is not a way to re-check a decision.
   */
  async livenessResult(sessionId: string): Promise<LivenessOutcome> {
    const res = await this.rekognition().send(
      new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }),
    );
    const ref = res.ReferenceImage?.Bytes;
    return {
      status: res.Status ?? 'UNKNOWN',
      confidence: typeof res.Confidence === 'number' ? res.Confidence : undefined,
      referenceImage: ref ? Buffer.from(ref) : undefined,
    };
  }
}
