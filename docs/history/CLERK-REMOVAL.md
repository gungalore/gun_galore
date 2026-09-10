# Removing Clerk — what went, and where its behaviour lives now

**True on 2026-09-10.** This is a record of a removal, not a description of the
running system. `CLAUDE.md` and `docs/ARCHITECTURE.md` describe what exists.

It is here for one reason: a removal deletes the code AND the explanation, and
six months from now the question will not be "what does auth do" — it will be
"there used to be a thing that handled X, where did it go". Every row below
answers that.

---

## Why

The operator's call: move off a hosted identity provider onto something we run,
and put identity, email and phone verification through Didit on its free tier.
Production held two users, two listings and zero transactions, and the operator
authorised deleting both users and their data — which removed the hardest part
of the change (a migration) entirely and let `User.id` become the single user
identifier.

---

## Where each piece of behaviour went

| Clerk did this | Now |
|---|---|
| `verifyClerkToken()` — the one seam every guard called | `SessionService.verify()`, `backend/src/auth/session.service.ts` |
| `ClerkGuard` (~80 routes) | `AuthGuard`, minus the lazy-provisioning branch |
| `OptionalClerkGuard` (11 routes) | `OptionalAuthGuard` — same contract: never rejects |
| `ClerkOrTokenGuard` (3 routes) | `AuthOrTokenGuard` |
| `KycOrTokenGuard`, `ScanHandoffGuard` | Same names, session-backed |
| `request.clerkUserId` | `request.userId`, holding `User.id` |
| `User.clerkId` (a second identifier) | Dropped. `User.id` only |
| `POST /webhooks/clerk` + `svix` | Nothing. Sign-up writes the row itself |
| `upsertFromClerk`, `lazyProvisionFromClerk` | Nothing — we create the row before a token exists |
| Sign-up consent in `unsafeMetadata` | The `POST /api/auth/register` body, written in the same transaction |
| `<ConsentSync/>` (the OAuth consent fallback) | Deleted with the OAuth path |
| `clerk.users.deleteUser()` on account closure | `SessionService.revokeAllForUser()` |
| The `closed_<id>` clerkId tombstone | Gone. Closure renames `username`/`usernameLower` to `closed-<id>` to free the name |
| `LoginEvent.clerkSessionId` | `LoginEvent.sessionId`, FK to the new `Session` |
| `user.setProfileImage()` | `POST /users/me/avatar` → Cloudinary → `User.avatarUrl` |
| `user.updatePassword()` | `POST /api/auth/change-password` |
| `useAuth` / `useUser` / `useClerk` / `SignInButton` | `frontend/lib/auth.tsx`, same shapes |
| `auth()` from `@clerk/nextjs/server` | `serverAuth()` in `frontend/lib/auth-server.ts` |
| `clerkMiddleware` + `createRouteMatcher` | `frontend/middleware.ts` + `frontend/lib/route-matcher.ts` |
| VerifyNow (SA ID + Home Affairs) | Didit's document read — **see the loss below** |
| AWS Rekognition face-match + Face Liveness | Didit passive liveness + face match |
| Gemini KYC identity read | Didit OCR. Gemini keeps the Licence Centre reader and `readFirearm()` |

---

## What was NOT rebuilt

- **Google sign-in.** It relied on Clerk's hosted OAuth redirect. Replacing it
  needs an OAuth client of our own; the brief was a username, a password and an
  email address.
- **Two-factor authentication.** It lived in Clerk's hosted profile modal. The
  Settings page now offers a password change and states plainly that 2FA is not
  available — a row with a dead button would have told sellers their account
  had a control it does not have.

---

## The one capability that was LOST, not moved

VerifyNow's Home Affairs lookup returned the applicant's official first name,
surname and date of birth. That is what let the KYC verdict cross-check what
the member **typed** against the **state's** record, and it backed a hard
cross-check rule (`dob-ha-mismatch`) plus the anchored high-value re-check
(`maybeUpgradeKycTier`, which pulled the DHA photograph and re-matched it
against the stored selfie on any sale above a threshold).

Didit's free tier has no equivalent. Today:

- Names come from the document Didit reads, and nothing else.
- The date of birth is checked against the ID number's own digits, and against
  the date printed on the document — never against an authoritative source.
- There is no anchored tier. Every verified seller is the equivalent of the old
  `STANDARD`.

The paid replacements exist and are priced: `zaf_africa_national_id` (DHA ID
verification, $1.10) and `zaf_dha_photo` (DHA photo retrieval, $1.10). Turning
them on is a pricing decision the operator has not made. Both call sites carry
a comment saying so.

**No user-facing copy may claim a Home Affairs verification while this stands.**

Also worth knowing, for a different decision: `zaf_bank_account_holder` ($0.40)
would close the manual bank-holder review that Peach BANV currently leaves to
an admin.

---

## Traps found on the way, recorded so they are not re-learned

- **`cookie-parser` was never installed.** `res.cookie()` needs no middleware,
  which is why the admin login had been writing `gg_admin_sess` for months and
  nothing had ever read it back. `req.cookies` did not exist.
- **`docs/ARCHITECTURE.md` was wrong about the topology**, claiming an
  `api.gungalore.co.za` vhost and that CORS mattered because the origins
  differed. nginx proxies `alloutdoor.co.za/api/` to `127.0.0.1:3001` — it is
  same-origin, which is what makes cookie auth work at all. Corrected.
- **Two tabs refreshing at once used to be a sign-out.** Both wake with the
  same refresh cookie; one rotates, the other presents a hash matching nothing.
  `Session.prevRefreshHash` honours the just-rotated token for 30 seconds.
- **`select: { clerkId: true }` on `AdminUser` is not `select: { id: true }`.**
  A blunt codemod made that substitution in `activity.service.ts`, where it
  would have excluded the admin records' own primary keys from analytics and
  let every operator's browsing into the member statistics. `AdminUser.userId`
  is the linked member.
- **A `$\`` in a replacement string duplicates the file.** `String.replace`
  expands it to "everything before the match". It silently doubled
  `users.service.ts` mid-refactor.
- **`/admin(.*)` matches `/administrivia`.** Inherited from Clerk's matcher and
  harmless for the patterns in the list, but `/deal(.*)` would quietly publish
  `/dealer-transfers`. Locked in `lib/route-matcher.spec.ts`.

---

## Decommissioning still outstanding

- `frontend/.env.local` and `frontend/.env.local.bak-20260825-214941` both hold
  a live `sk_live_` Clerk secret in plaintext. Neither is tracked. **Delete the
  `.bak` and rotate the key in the Clerk dashboard** before closing the account.
- On the box: remove the Clerk vars from `frontend/.env.production`, **then
  rebuild** — `NEXT_PUBLIC_*` is inlined at `next build`, so removing the
  variable without a rebuild leaves the old key in the served bundle while
  Warden reports it gone.
- Do not close the Clerk account until the new system has run in production
  long enough to be trusted.
- **`infra/nginx/alloutdoor.conf:30-31` records that Clerk's FAPI domain was
  blocking the `gungalore.co.za` → `alloutdoor.co.za` rename.** That blocker is
  now gone.
