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

## What actually exists today (checked in the console, 2026-09-04)

Account **369607682800**, alias **ALLOUTDOOR**.

| | |
|---|---|
| IAM user | **`turbosnail69`** — the only user in the account. Access key `AKIAVMDSVVLYMZWOM43S`, created 2026-09-04, active. |
| Its permissions | Inline policy **`KYC_ALL_OUTDOOR_OCR`**, which is `kyc-iam-policy.json` as it stood before the liveness work: Textract, CompareFaces/DetectFaces, all three liveness actions, and the eu-west-1 Deny. |
| IAM roles | None of ours. Only AWS's own service-linked roles. |
| Customer-managed policies | None. |

So the KYC scan runs as `turbosnail69`, not as a dedicated user, and the
policy is inline on that user rather than a managed policy of its own.

⚠️ **The one thing missing for the browser liveness challenge** is
`sts:GetFederationToken`. Everything else it needs — notably
`rekognition:StartFaceLivenessSession` — is already there, which is what
makes the federation path work without a role.

IAM → Users → `turbosnail69` → Permissions → **`KYC_ALL_OUTDOOR_OCR`** → Edit
→ JSON, and add:

```json
{
  "Sid": "VendShortLivedBrowserCredentials",
  "Effect": "Allow",
  "Action": ["sts:GetFederationToken"],
  "Resource": "*"
}
```

That is the only change needed to turn liveness on.

### Still outstanding: the dedicated user

The section below describes creating a separate `alloutdoor-kyc` user. **It
has not been done** — it is a hygiene improvement (rotate or revoke KYC access
without touching anything else; CloudTrail shows plainly which calls were
identity checks), not a prerequisite. Nothing is blocked on it.

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
- `rekognition:StartFaceLivenessSession` — **not called by this server.** It is
  held so the server can pass it *down* to the browser: a federated session
  can only ever narrow the caller's own permissions, never add to them, so the
  user must hold this for the browser to be given it. The optional role path
  below is what removes it from the user again.
- `sts:GetFederationToken` — minting those narrowed, short-lived browser
  credentials.

## Giving the browser credentials (no new IAM object needed)

The liveness challenge streams video from the seller's camera straight to
Rekognition, so the **browser** needs AWS credentials. Ours must never go
there: the server key can read identity documents and pull liveness verdicts,
and a page that could read its own verdict could also lie about it.

AWS documents Cognito Identity Pools for this, which means standing up a
public unauthenticated identity anyone can draw credentials from. We do not
need it — the seller is signed in and mid-verification.

**The default needs nothing beyond the user above.** The server calls
`sts:GetFederationToken` on its own identity and passes an inline session
policy; the browser's effective permissions are that policy INTERSECTED with
the user's, which comes to `rekognition:StartFaceLivenessSession` in eu-west-1
and nothing else. Not Textract, and **not** `GetFaceLivenessSessionResults`.

So the only change to what already exists is one statement in the inline
policy on `turbosnail69` — re-paste
[`kyc-iam-policy.json`](./kyc-iam-policy.json), which now includes it:

```json
{
  "Sid": "VendShortLivedBrowserCredentials",
  "Effect": "Allow",
  "Action": ["sts:GetFederationToken"],
  "Resource": "*"
}
```

IAM → Users → `turbosnail69` → Permissions → `KYC_ALL_OUTDOOR_OCR` → Edit →
JSON → replace → Save. That is the whole job; `AWS_KYC_LIVENESS_ROLE_ARN`
stays unset.

### Optional, later: the tighter role

Federation leaves `StartFaceLivenessSession` on the server user's own policy,
because an intersection cannot grant what the user lacks. A role removes even
that, so a leaked server key could not start a stream either. It is a real
improvement and it is **not worth blocking the feature on** — do it when
there is a quiet moment.

1. **IAM → Roles → Create role → Custom trust policy**, pasting
   [`kyc-liveness-role-trust-policy.json`](./kyc-liveness-role-trust-policy.json)
   with `<ACCOUNT_ID>` replaced by this account's id (top right of the console).
2. Attach a policy built from
   [`kyc-liveness-role-policy.json`](./kyc-liveness-role-policy.json).
3. Name it **`alloutdoor-kyc-liveness-browser`**.
4. In the user's policy, swap the `sts:GetFederationToken` statement for
   `sts:AssumeRole` scoped to that role's ARN, and drop
   `rekognition:StartFaceLivenessSession` from the user.
5. Put the ARN on the box:

```bash
ssh -t alloutdoor 'f=/home/alloutdoor/app/backend/.env; cp "$f" "$f.bak-$(date +%F-%H%M%S)"; \
  read -p "AWS_KYC_LIVENESS_ROLE_ARN: " a; \
  sed -i "/^AWS_KYC_LIVENESS_ROLE_ARN=/d" "$f"; \
  echo "AWS_KYC_LIVENESS_ROLE_ARN=$a" >> "$f"; grep "^AWS_KYC" "$f"'
```

The code picks the path from that variable alone: set means AssumeRole, unset
means federation. Nothing else changes.

⚠️ **If neither works, no liveness challenge runs.** The endpoint reports
itself unavailable, the wizard submits the selfie on its own, and every
verdict parks in `UNDER_REVIEW` for a human — because anti-spoofing was never
checked. That is the intended degraded state, not a bug; what must never
happen is a seller auto-approving on a check nobody ran.
