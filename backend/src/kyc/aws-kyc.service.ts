// backend/src/kyc/aws-kyc.service.ts
//
// The AWS half of KYC: Rekognition matches the face and runs the liveness
// challenge. VerifyNow is unchanged and still checks the ID number against
// the Home Affairs name and date of birth — AWS does the face vision work,
// not the identity lookup.
//
// ⚠️ TEXTRACT LEFT ON 2026-09-08. Operator: "we will also be losing AWS
// textract and only be using gemini going forward. Gemini can write
// straight into json and you can make it work from there." The identity
// DOCUMENT is now read by readIdentityDocument() below, through the same
// LlmService/Gemini adapter every model call on the platform now uses — see
// the comment on that method for exactly what changed and what a schema
// cannot do for you. Rekognition CompareFaces and Face Liveness are
// UNCHANGED: neither ever did OCR, and nothing about them depended on
// Textract being the reader.
//
// ⚠️ REGION IS NOT A PREFERENCE, FOR WHAT STAYS ON AWS. eu-west-1 (Ireland)
// is verified to carry both Rekognition and Face Liveness together:
// eu-north-1 (Stockholm) has neither service, and eu-central-1 (Frankfurt)
// has Rekognition but NOT Face Liveness. Verified against the consoles
// themselves rather than the docs. The IAM policy in
// infra/aws/kyc-iam-policy.json DENIES rekognition:* outside eu-west-1, so a
// misconfigured region fails loudly instead of quietly sending South
// African selfies and identity photos somewhere unintended. Gemini is a
// different provider on different infrastructure and is NOT bound by this
// AWS region lock at all — see LlmService for how ITS provider and model
// are chosen.
//
// ⚖️ POPIA §72(1)(b): the cross-border transfer consent the seller gives
// must be INFORMED, which means the consent copy has to name AWS Ireland
// for the face comparison and the liveness challenge. The identity DOCUMENT
// now goes to Gemini instead — the same provider kyc-model.service.ts's
// older scan already sends documents and selfies to, so this is not a NEW
// cross-border question, but it IS a different one from the AWS Ireland
// consent above, and that consent copy was written before this path also
// left AWS. Worth the operator's own look; not assumed here.

import { Injectable, Logger } from '@nestjs/common';
import {
  AssumeRoleCommand,
  GetFederationTokenCommand,
  STSClient,
} from '@aws-sdk/client-sts';
import {
  CompareFacesCommand,
  CreateFaceLivenessSessionCommand,
  GetFaceLivenessSessionResultsCommand,
  RekognitionClient,
} from '@aws-sdk/client-rekognition';

import { LlmService } from '../common/llm/llm.service';
import { LlmError, type LlmPart } from '../common/llm/llm.types';
import { sniffMime } from '../common/sniff-mime';
import { readSaId } from '../motivations/sa-id';
import {
  buildAwsFindings,
  dobFromIdNumber,
  type AwsFindings,
  type DocumentKind,
  type ExtractedIdentity,
  type FaceComparison,
} from './aws-kyc-findings';

/**
 * What readIdentityDocument() asks Gemini to do. Deliberately narrow: this
 * is an OCR read, not a verdict. Authenticity ("does this look forged?")
 * stays with document-integrity.ts's rules-based check per the operator's
 * 2026-09-04 decision recorded there, and face-matching stays with
 * Rekognition below — this prompt reads four fields and nothing else, and
 * is told explicitly never to guess one.
 */
const IDENTITY_READ_SYSTEM_PROMPT = `You are reading a South African identity document for a marketplace identity check. There are exactly two valid formats and BOTH are in wide circulation:
- GREEN_BOOK — the old green bar-coded identity book. A small booklet with a dark green cover, "I.D. No." printed above a barcode near the photo.
- SMART_ID_CARD — the newer credit-card sized card, WHITE/pale with a green-and-gold South African coat of arms and a laser-engraved portrait. Introduced in 2013.
Anything else — a passport, a foreign ID, a driving licence, a birth certificate, a competency certificate or firearm licence that happens to carry an ID number — is OTHER. Do not read identity fields off a document that is not itself proof of identity.

Read, and output ONLY what is actually printed on the document:
- the 13-digit ID number, as digits only, with no spaces, dashes or other punctuation
- the surname
- the given names (forenames)
- the date of birth, normalised to YYYY-MM-DD

If a field is not clearly legible, output null for it. NEVER guess a digit, a letter or a date you cannot actually read — an invented value is worse than an honest null, because everything downstream trusts what you report as read rather than checking your working. Report only what is printed for the date of birth; do not derive it from the ID number yourself, so the two can be checked against each other afterwards.

Output ONLY a single valid JSON object. The first character of your reply MUST be the literal '{'. No markdown fences, no commentary. Schema:
{"documentType": "SMART_ID_CARD"|"GREEN_BOOK"|"OTHER", "idNumber": "13 digits or null", "surname": "string or null", "names": "string or null", "dateOfBirth": "YYYY-MM-DD or null"}`;

/**
 * The shape readIdentityDocument()'s call must answer in. Passed as
 * LlmRequest.json.schema so the provider enforces it — see the note on
 * that method for what a schema does and does not guarantee.
 */
const IDENTITY_DOCUMENT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    documentType: {
      type: 'string',
      enum: ['SMART_ID_CARD', 'GREEN_BOOK', 'OTHER'],
      description: 'Which of the two valid SA identity documents this is, or OTHER.',
    },
    idNumber: {
      type: ['string', 'null'],
      description: '13-digit SA ID number, digits only, or null if not clearly legible.',
    },
    surname: { type: ['string', 'null'] },
    names: { type: ['string', 'null'], description: 'Given names / forenames.' },
    dateOfBirth: {
      type: ['string', 'null'],
      description: 'As printed on the document, normalised to YYYY-MM-DD, or null.',
    },
  },
  required: ['documentType', 'idNumber', 'surname', 'names', 'dateOfBirth'],
};

/**
 * The ceiling on what browser-held credentials can do, passed inline to
 * GetFederationToken. Effective permissions are this INTERSECTED with the
 * server user's own policy, so it can only ever narrow, never widen.
 *
 * One action, one region. Notably absent: GetFaceLivenessSessionResults —
 * the browser must not be able to read the verdict it is being judged by.
 */
const BROWSER_SESSION_POLICY = {
  Version: '2012-10-17',
  Statement: [
    {
      Sid: 'BrowserMayOnlyStreamALivenessChallenge',
      Effect: 'Allow',
      Action: 'rekognition:StartFaceLivenessSession',
      Resource: '*',
      Condition: {
        StringEquals: { 'aws:RequestedRegion': 'eu-west-1' },
      },
    },
  ],
};

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
  private rekognitionClient?: RekognitionClient;
  private stsClient?: STSClient;

  constructor(
    // Optional for the same reason KycModelService's LlmService is optional:
    // nothing else in this class needs a model, so a bare `new
    // AwsKycService()` — which aws-kyc.service.spec.ts and kyc.service.spec.ts
    // both use to exercise the Rekognition/STS methods off the network —
    // keeps working with no model configured at all. Only
    // readIdentityDocument() ever touches this.
    private readonly llm?: LlmService,
  ) {}

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

  private rekognition(): RekognitionClient {
    this.rekognitionClient ??= new RekognitionClient({ region: this.region });
    return this.rekognitionClient;
  }

  /**
   * The whole scan: liveness (when a session ran), the identity document
   * read, and the face comparisons — composed here so the caller has one
   * seam to stub. "AWS" in the name is now historical: the document read
   * moved to Gemini on 2026-09-08, and only the two face comparisons and
   * the liveness challenge are still AWS-shaped decisions.
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

    const identity = await this.readIdentityDocument(input.documentBytes);
    const vsDocument = await this.compareFaces(faceBytes, input.documentBytes);
    const vsHomeAffairs = input.haPhotoBase64
      ? await this.compareFaces(
          faceBytes,
          Buffer.from(input.haPhotoBase64, 'base64'),
        )
      : undefined;

    return buildAwsFindings({
      identity,
      vsDocument,
      vsHomeAffairs,
      livenessConfidence,
    });
  }

  /**
   * Read the identity document with Gemini, straight into the shape
   * buildAwsFindings() consumes — there is no separate OCR-parsing module
   * any more. Operator, 2026-09-08: "we will also be losing AWS textract
   * and only be using gemini going forward. Gemini can write straight into
   * json and you can make it work from there." This ONE call replaces what
   * used to be TWO steps — analyzeDocument() (Textract, a raw provider
   * response) then extractIdentity() (pure functions parsing that
   * response) — both gone, along with textract-extract.ts and its
   * six-real-document regression suite.
   *
   * ⚠️ A SCHEMA ENFORCES SHAPE, NEVER SEMANTICS. `json.schema` below
   * guarantees the reply parses into the right fields with the right
   * types — it does NOT guarantee the ID number printed in it is a real
   * one. Gemini can hand back a perfectly well-formed 13-digit string that
   * fails the SA ID checksum, exactly the way a typo or a hallucination
   * would, and the schema cannot see the difference. readSaId() — the SAME
   * Luhn check the licence stack runs on every ID number a member ever
   * types in — is the actual gate here: a reading that fails it is
   * discarded as though NOTHING was read, never merely flagged and passed
   * on. See legibilityScore() in aws-kyc-findings.ts for what an unread ID
   * number costs downstream.
   *
   * ⚠️ NO CONFIDENCE FIELD IS ASKED FOR, ON PURPOSE. Textract reported a
   * real per-line OCR confidence; a vision-language model has no
   * equivalent signal to report, and asking it for one ("how sure are you,
   * 0-100?") would be the model scoring its own answer — not a
   * measurement, just a number shaped like one. legibilityScore() had to
   * change what it MEANS because of this; do not paper over that by adding
   * a confidence field here and feeding it back in.
   */
  async readIdentityDocument(bytes: Buffer): Promise<ExtractedIdentity> {
    if (!this.llm?.isConfigured()) {
      throw new Error(
        'AI identity document read unavailable — no model configured',
      );
    }

    const mimeType = sniffMime(bytes);
    const content: LlmPart[] = [
      { type: 'text', text: 'South African identity document:' },
      { type: 'image', mimeType, data: bytes.toString('base64') },
    ];

    const res = await this.completeOrThrow({
      system: IDENTITY_READ_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      maxTokens: 400,
      // No `temperature` — see kyc-model.service.ts's note on its own scan
      // call: the Anthropic rollback path 400s on an explicit temperature
      // for some models, and because every call site fails soft that cost
      // two days of silence once already. The platform convention is to
      // never pass one, rather than let a rollback silently stop reading
      // documents.
      thinking: { budgetTokens: 0 },
      json: { schema: IDENTITY_DOCUMENT_SCHEMA },
      purpose: 'kyc.document-read',
    });

    // A blocked response is an outage, not "nothing was read" — same rule
    // as kyc-model.service.ts's scan(), for the same reason: a provider
    // refusing to look has told us nothing, so it must never come out
    // looking like an honest empty reading.
    if (res.stopReason === 'safety') {
      throw new Error('AI identity document read was blocked by the provider');
    }

    // ⚠️ THE REGEX STAYS EVEN THOUGH THE SCHEMA SHOULD MAKE IT UNNECESSARY —
    // same reasoning as motivation-extract.service.ts's firearm read:
    // `json.schema` is a provider constraint, not a guarantee we control,
    // and the more permissive Anthropic rollback path can still hand back a
    // fenced or prefaced answer.
    const match = res.text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI identity document read did not return JSON');
    const raw = JSON.parse(match[0]) as {
      documentType?: string | null;
      idNumber?: string | null;
      surname?: string | null;
      names?: string | null;
      dateOfBirth?: string | null;
    };

    const notes: string[] = [];
    const digits = (raw.idNumber ?? '').replace(/\D/g, '');
    const idValid = digits.length > 0 && readSaId(digits).valid;
    if (raw.idNumber && !idValid) {
      notes.push(
        `the model read an ID number ("${raw.idNumber}") but it failed the SA ID checksum — treated as unread, not corrected`,
      );
    }
    const idNumber = idValid ? digits : null;

    // The printed date and the date the ID number's own digits imply are
    // independent reads of the same fact — which is what makes disagreement
    // meaningful. Falls back to the implied date when nothing was printed
    // (or wasn't legible): the same "fill in what we can already prove"
    // rule CLAUDE.md's "Automate it" section applies everywhere else on
    // this platform.
    const printedDob = raw.dateOfBirth?.trim() || null;
    const impliedDob = idNumber ? dobFromIdNumber(idNumber) : null;
    if (printedDob && impliedDob && printedDob !== impliedDob) {
      notes.push(
        `the printed date of birth (${printedDob}) disagrees with the ID number's own digits (${impliedDob}) — one of the two was misread`,
      );
    }

    const documentType: DocumentKind =
      raw.documentType === 'SMART_ID_CARD' || raw.documentType === 'GREEN_BOOK'
        ? raw.documentType
        : 'OTHER';

    return {
      documentType,
      idNumber,
      surname: raw.surname?.trim() || null,
      names: raw.names?.trim() || null,
      dateOfBirth: printedDob ?? impliedDob,
      notes,
    };
  }

  /**
   * The model call, with the provider's own failure named in the message.
   * Same shape as KycModelService's private complete() helper, one
   * directory over — every code path out of LlmService.complete() comes out
   * as a throw here too, including 'safety' upstream in the caller, so
   * readIdentityDocument()'s try-free body never has to distinguish a
   * network failure from a bad reading.
   */
  private async completeOrThrow(
    req: Parameters<LlmService['complete']>[0],
  ): ReturnType<LlmService['complete']> {
    try {
      return await this.llm!.complete(req);
    } catch (err) {
      if (err instanceof LlmError) {
        throw new Error(
          `AI identity document read failed (${err.code}): ${err.message}`,
        );
      }
      throw err;
    }
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
   * held it could call Rekognition against our account at will — and a page
   * that could read its own liveness result could also lie about it.
   *
   * This is deliberately NOT Cognito. The documented alternative is an
   * unauthenticated Identity Pool: a public guest identity anyone on the
   * internet can draw credentials from. We already know who this seller is —
   * signed in, mid-verification — so we vend from behind our own auth guard.
   *
   * ── TWO WAYS TO DO THAT, AND THE SIMPLER ONE IS THE DEFAULT ─────────
   *
   * GetFederationToken (no extra IAM objects) takes the CALLER's own
   * permissions and INTERSECTS them with a session policy passed inline. So
   * the browser ends up with `rekognition:StartFaceLivenessSession` in
   * eu-west-1 and nothing else, minted from the same user the server already
   * runs as. Nothing to create in the console beyond one line added to that
   * user's existing policy.
   *
   * AssumeRole (tighter, optional) additionally keeps
   * StartFaceLivenessSession off the server user's own policy, so a leaked
   * server key could not start a stream either. Worth it eventually; not
   * worth blocking the feature on a second IAM object today.
   *
   * Set AWS_KYC_LIVENESS_ROLE_ARN to use the role. Leave it unset and this
   * falls back to federation, which is why the feature no longer needs it.
   *
   * ⚠️ INTERSECTION, NOT ASSIGNMENT. The session policy below cannot GRANT
   * anything the user lacks. If StartFaceLivenessSession is ever removed
   * from the user's policy, this silently returns credentials that can do
   * nothing and the challenge fails at the browser — so the two must move
   * together.
   */
  async vendBrowserCredentials(
    subjectRef: string,
  ): Promise<BrowserLivenessCredentials | undefined> {
    if (!this.enabled()) {
      this.log.warn(
        'AWS credentials unset — no browser liveness challenge can run, so every verdict will park for human review',
      );
      return undefined;
    }
    this.stsClient ??= new STSClient({ region: this.region });

    // Shows up in CloudTrail against every browser-side call, so a
    // suspicious stream traces back to one verification attempt. Sanitised
    // because STS rejects anything outside [\w+=,.@-], and truncated
    // because GetFederationToken caps Name at 32 characters (AssumeRole
    // allows 64, so the shorter limit governs).
    const sessionName = `kyc-${subjectRef.replace(/[^\w+=,.@-]/g, '')}`.slice(0, 32);

    const roleArn = process.env.AWS_KYC_LIVENESS_ROLE_ARN;
    const res = roleArn
      ? await this.stsClient.send(
          new AssumeRoleCommand({
            RoleArn: roleArn,
            RoleSessionName: sessionName,
            // 900 is the STS minimum. The liveness session itself expires
            // after 3 minutes, so the credentials always outlive the work —
            // we cannot make them shorter-lived than what they are for.
            DurationSeconds: 900,
          }),
        )
      : await this.stsClient.send(
          new GetFederationTokenCommand({
            Name: sessionName,
            DurationSeconds: 900,
            Policy: JSON.stringify(BROWSER_SESSION_POLICY),
          }),
        );

    const c = res.Credentials;
    if (!c?.AccessKeyId || !c.SecretAccessKey || !c.SessionToken) {
      throw new Error('STS returned no usable credentials');
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
