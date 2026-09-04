# AWS setup for KYC (Textract + Rekognition)

Everything here is done by the operator in the AWS console. **Nobody else ever
handles the secret access key** — it is shown once at creation and goes straight
onto the server.

## Region: eu-west-1 (Ireland). Not negotiable.

It is the only European region carrying all three of Textract, Rekognition and
Rekognition **Face Liveness** together:

| Region | Textract | Rekognition | Face Liveness |
|---|---|---|---|
| eu-north-1 (Stockholm) | ❌ | ❌ | ❌ |
| eu-central-1 (Frankfurt) | ✅ | ✅ | **❌** |
| **eu-west-1 (Ireland)** | ✅ | ✅ | ✅ |

Verified against the service consoles themselves, not the documentation.

`kyc-iam-policy.json` **denies** `textract:*` and `rekognition:*` outside
eu-west-1, so a misconfigured region fails loudly rather than quietly sending
South African identity documents somewhere unintended.

## The `alloutdoor-kyc` IAM user

A dedicated user, so KYC access can be rotated or revoked without touching
anything else, and so CloudTrail shows plainly which calls were identity checks.

1. **IAM → Policies → Create policy → JSON.** Paste the contents of
   [`kyc-iam-policy.json`](./kyc-iam-policy.json). Name it `alloutdoor-kyc-policy`.
2. **IAM → Users → Create user.** Name it `alloutdoor-kyc`. Do **not** tick
   "Provide user access to the AWS Management Console" — this identity is for the
   server only and should not be able to log in.
3. **Attach policies directly** → select `alloutdoor-kyc-policy`. Create.
4. Open the user → **Security credentials** → **Create access key** → choose
   **Application running outside AWS** → Create.
5. The secret is shown **once**. Put it straight on the server with the command
   below — do not paste it into chat, a ticket, or a file in this repo.

```bash
ssh -t alloutdoor 'set -e; f=/home/alloutdoor/app/backend/.env; cp "$f" "$f.bak-$(date +%F-%H%M%S)"; \
  read -p "AWS_ACCESS_KEY_ID: " k; read -s -p "AWS_SECRET_ACCESS_KEY: " s; echo; \
  sed -i "/^AWS_REGION=/d;/^AWS_ACCESS_KEY_ID=/d;/^AWS_SECRET_ACCESS_KEY=/d" "$f"; \
  printf "AWS_REGION=eu-west-1\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\n" "$k" "$s" >> "$f"; \
  echo "written; keys present:"; grep -c "^AWS_" "$f"'
```

Then restart the backend so it re-reads the environment. The values are never
echoed, and the previous `.env` is backed up first.

6. **Retire the old key.** The scan previously ran under a general-purpose user.
   Once `alloutdoor-kyc` is confirmed working, deactivate that user's access key
   (deactivate first, delete a few days later — deleting immediately leaves no way
   back if something else was quietly using it).

## Checking it works

There is no local credential; the box is the only place this runs. After the
restart, a KYC attempt should produce Textract and Rekognition entries in
CloudTrail under `alloutdoor-kyc`. A call from any region other than eu-west-1
should appear as an explicit **deny** — that is the region lock doing its job,
not a fault.

## What the policy grants, and why each line is there

- `textract:DetectDocumentText`, `AnalyzeDocument`, `AnalyzeID` — reading the
  identity document.
- `rekognition:CompareFaces`, `DetectFaces` — matching the selfie to the photo on
  the document and, for high-value sellers, to the official Home Affairs
  photograph.
- `rekognition:CreateFaceLivenessSession`, `GetFaceLivenessSessionResults` —
  opening the anti-spoofing challenge and reading its verdict.

`rekognition:StartFaceLivenessSession` is deliberately **not** here. That call
is made by the browser, never by this server, so granting it to the server's
own key would widen what a leaked key could do for no benefit. The browser
gets it through the role below instead.

## The `alloutdoor-kyc-liveness-browser` role

The liveness challenge is a video stream from the seller's camera straight to
Rekognition, so the **browser** needs AWS credentials. Ours must never go
there: the server key can read identity documents and pull liveness verdicts,
and a page holding it could call Rekognition against this account at will.

AWS documents Cognito Identity Pools for this, which means standing up a
public unauthenticated identity anyone can draw credentials from. We do not
need it — the seller is signed in and mid-verification — so the server assumes
a role scoped to exactly one action and hands the temporary credentials to the
page from behind our own auth guard.

1. **IAM → Roles → Create role → Custom trust policy.** Paste
   [`kyc-liveness-role-trust-policy.json`](./kyc-liveness-role-trust-policy.json),
   replacing `<ACCOUNT_ID>` with this account's id (top right of the console).
2. Attach a new policy built from
   [`kyc-liveness-role-policy.json`](./kyc-liveness-role-policy.json) —
   `StartFaceLivenessSession` and nothing else, region-locked to eu-west-1 the
   same way the server's policy is.
3. Name the role **`alloutdoor-kyc-liveness-browser`**.
4. Edit `alloutdoor-kyc-policy` and replace `<ACCOUNT_ID>` in its
   `AssumeOnlyTheBrowserLivenessRole` statement with the same id. The user can
   assume that one role and no other.
5. Put the role's ARN on the box:

```bash
ssh -t alloutdoor 'f=/home/alloutdoor/app/backend/.env; cp "$f" "$f.bak-$(date +%F-%H%M%S)"; \
  read -p "AWS_KYC_LIVENESS_ROLE_ARN: " a; \
  sed -i "/^AWS_KYC_LIVENESS_ROLE_ARN=/d" "$f"; \
  echo "AWS_KYC_LIVENESS_ROLE_ARN=$a" >> "$f"; grep "^AWS_KYC" "$f"'
```

⚠️ **Until that ARN is set, no liveness challenge can run.** The endpoint
reports itself unavailable, the wizard submits the selfie on its own, and
every verdict parks in `UNDER_REVIEW` for a human — because anti-spoofing was
never checked. That is the intended degraded state, not a bug; the thing that
must never happen is a seller auto-approving on a check nobody ran.
