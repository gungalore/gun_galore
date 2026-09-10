# BUILD PLAN — "Close my account"

> ⚠️ **RE-DERIVED AFTER THE AUTH REWRITE (2026-09-10).** This plan was written against a
> third-party identity provider, and roughly a third of it was about the handshake with
> that provider rather than about closing an account. Clerk is gone: sessions, passwords
> and sign-up are ours, `User.clerkId` no longer exists and `User.id` is the only user
> identifier. **Steps 3–5 of §4 collapsed into one call, `sessions.revokeAllForUser`,**
> and the `clerkId` tombstone was replaced by a **username rename**. Findings that were
> about the handshake (H5, H10, H18, and half of H23) are marked *resolved by removal*
> rather than deleted, because a reader who remembers them needs to know where they went.
> Everything about *what a closure means* is unchanged.

**Scope decision up front:** this is **not** a POPIA erasure button. It is *public disappearance + access revocation + accountability preservation*. Erasure requests stay a separate, support-reviewed path. Conflating the two is what makes today's code destroy the complaints register (`prisma/schema.prisma:3667`, `onDelete: Cascade`) for exactly the members who never traded.

---

## 0. THE ONE-LINE DIAGNOSIS

Today's only erasure path — `UsersService.deleteById` (`backend/src/users/users.service.ts:448`; it was `deleteByClerkId`, and it was reached by a `user.deleted` webhook that no longer exists) — gets all three requirements backwards:

| Requirement | Today |
|---|---|
| **A** disappear from public | **Not met at all.** `sellers-public.controller.ts:36-38` has no filter of any kind; `PUBLIC_LISTING_SELECT.seller` (`listings/listings.service.ts:146-166`) still renders `username`; listings stay `ACTIVE`. |
| **B** accountability survives | **Destroyed** when the hard delete at `users.service.ts:714` succeeds — `Complaint` + `ComplaintPhoto`, `SupportTicket`, `Subscription`, `LoginEvent`, `AskGgConversation` all cascade away, and `ContactDetailRejection` (the off-platform-coordination log) is SET NULL. **Also destroyed** on the scrub branch, differently: `firstName`, `lastName`, `phone`, `email`, `idNumberEncrypted` are all nulled (`:725-735`) and `Transaction` carries **no identity snapshot** (`schema.prisma:1415-1445` — buyerId/sellerId FKs and nothing else). |
| **C** sign up again | **Dead.** `kycIdHash` (`schema.prisma:288`, `@unique`) is never released, blocking re-verification at `kyc/kyc.service.ts:211-219`, `:585-593`, `users.service.ts:838-847`. `username` (`schema.prisma:246`, `@unique`) is never released, blocking the signup form at `users/users-public.controller.ts:56-62`. |

Everything below inverts that.

⚠️ **AND `deleteById` NOW HAS NO CALLER AT ALL.** Its only trigger was the `user.deleted` webhook, which went with the identity provider. The method survives — it still carries the POPIA erasure for motivations, Licence Centre documents and KYC files, and it still holds the SAP 534 identity and the bank quartet back where a firearm transfer or an unpaid payout exists — but nothing routes to it. **A POPIA erasure request is therefore a hand-run today.** That is a gap to close deliberately (an admin route, support-reviewed), not by wiring the closure button to it: closure is not erasure, and §1.3 is the reason.

---

## 1. THE MODEL — `accountClosedAt` **and** an immutable `AccountClosure` row

### 1.1 Why both, not one

**`User.accountClosedAt DateTime?`** is required because every read filter, every write gate and every uniqueness release has to be answerable from the row itself in one query. `isBanned` cannot carry this meaning — it is a write-gate flag that no public read consults anywhere in the backend, and reusing it means Unban (`admin/admin.service.ts:486-494`) silently reopens a closed account with one click.

**A separate `AccountClosure` model** is required for three reasons the column cannot cover:

1. **`AdminAuditEvent` is unusable.** `adminUserId String` is a **required** FK to `AdminUser` (`schema.prisma:2124-2125`). A member-initiated closure has no admin actor, so the event cannot be written there. There is currently **no record anywhere** that a closure happened.
2. **The identity has to survive the columns being cleared.** Requirement B is not satisfied by preserving FK targets; it is satisfied by preserving *who the FK points at*. Once `username`/`email`/`phone` are released back into the namespace (which requirement C demands), the only place the answer can live is a row nothing else writes to.
3. **Enforcement state has to survive re-registration.** Every ban and strike is a `@default` column on `User` (`isBanned :401`, `bannedAt :402`, `auctionStrikes :437`, `dispatchStrikes :445`, `sellerRejectStrikes :450`, `sellingBannedAt :451`, `trustScore :256`). A new row is a clean row. The closure record is what carries them forward.

### 1.2 The schema

```prisma
/// One row per account closure. IMMUTABLE — written once in the closure
/// transaction and never updated except by the re-registration relink
/// (reRegisteredAsUserId / reRegisteredAt).
///
/// This is the accountability record. The User row it points at keeps every
/// financial FK (Transaction, Order, Rating, Offer, Bid, Swap, ListingQuestion
/// are all ON DELETE RESTRICT) but has had its identifying columns released
/// back into the uniqueness namespaces so the same human can register again.
/// The values released are snapshotted HERE so "who was this" is still
/// answerable for a law-enforcement or dispute request.
///
/// ⚠️ NEVER add this relation to any public select. Not PUBLIC_LISTING_SELECT
/// (listings.service.ts:61), not SellersPublicController (sellers-public.controller.ts:35).
model AccountClosure {
  id     String @id @default(cuid())
  userId String @unique
  /// RESTRICT deliberately — the closure record must outlive any attempt to
  /// delete the User row it explains.
  user   User   @relation(fields: [userId], references: [id], onDelete: Restrict)

  closedAt        DateTime @default(now())
  /// 'MEMBER' | 'ADMIN' — how the closure was triggered.
  ///
  /// ⚠️ There was a third value, 'CLERK_WEBHOOK', for a closure that reached us
  /// because somebody deleted the member in the identity provider's own
  /// dashboard. There is no such dashboard now — we are the identity provider —
  /// so a closure can only start from the member or from an admin, and the
  /// union is closed.
  closedBy        String
  /// AdminUser.id when closedBy = 'ADMIN'. Null for a self-service close.
  closedByAdminId String?
  /// Ticklist reason the member chose. Free text is NOT accepted here.
  reason          String

  // ── Identity snapshot. IN THE CLEAR, admin-only. See the rationale below. ──
  closedUsername  String?
  closedEmail     String
  closedPhone     String?
  closedFirstName String?
  closedLastName  String?

  /// Non-unique copy of User.kycIdHash. The live hash STAYS on the User row
  /// (see §2); this copy survives the relink moving it onto a new row.
  kycIdHashArchived String?

  // ── Enforcement carry-forward. Read by the re-registration relink. ──
  wasBanned           Boolean   @default(false)
  wasBannedAt         DateTime?
  wasSellingBannedAt  DateTime?
  wasSellerRejectStrikes Int    @default(0)
  wasAuctionStrikes      Int    @default(0)
  wasDispatchStrikes     Int    @default(0)
  wasTrustScore          Int    @default(0)

  /// Set by the relink when the same SA ID re-verifies on a new account.
  reRegisteredAsUserId String?
  reRegisteredAt       DateTime?

  /// Listing ids cancelled by this closure, for the reindex retry sweep.
  cancelledListingIds String[]

  @@index([closedAt])
  @@index([kycIdHashArchived])
  @@index([closedUsername])
}
```

And on `User`:

```prisma
  /// Set-once. Non-null = the member closed their account (or an admin closed
  /// it for them). DISTINCT from isBanned (:401) — a closure is not an
  /// enforcement action and must never render as one.
  accountClosedAt DateTime?
  closure         AccountClosure?
```

### 1.3 What is in the clear, and why — stated explicitly

| Field | Clear / encrypted / hashed | Why |
|---|---|---|
| `closedUsername` | **Clear** | It was a public handle. It is the only join key between the surviving rows and the human — `Notification.body` and `AdminAlert.context` both freeze it in prose (`common/seller-reject-policy.ts:158` writes `username` into the alert JSON), and `AdminAuditEvent.oldValue` records it as `username: old → new` (`admin/admin.service.ts:501-512`). Encrypting it buys no privacy (it was published) and breaks admin search. |
| `closedEmail`, `closedPhone`, `closedFirstName`, `closedLastName` | **Clear** | `adminSearch` keys on exactly `email / username / firstName / lastName / phone` (`admin/admin.service.ts:1046-1053`). A law-enforcement or dispute request arrives as a name or a phone number, never as a cuid. These sit in the clear on `User` today (`schema.prisma:217, 227, 241-242`); moving them to an admin-only table is a **net improvement**, not a new exposure. Protection is access control, not encryption. |
| `kycIdHashArchived` | **Salted SHA-256** (already) | `hashSaIdNumber` (`common/id-crypto.ts:84`). Not reversible; clear storage is correct and it is the relink key. |
| **SA ID number** | **Stays where it is** — `User.idNumberEncrypted` (`schema.prisma:298`), AES-GCM via `common/id-crypto.ts:47`. **Not copied, not nulled.** | See §7-H1: `assembleSaps534Data` (`payments/transactions.service.ts:5247-5300`) reads Section C **live** off the seller row. Nulling it, as the current scrub does at `users.service.ts:735`, makes the SAP 534 unregenerable. `schema.prisma:289-297` already states the retention basis (FCA s125 / SAP 534); `privacy/page.tsx:284` already promises it. |
| Document bytes | **Untouched by closure** | The encrypted stores (`common/secure-file-storage.service.ts:52` — `'motivations' | 'credentials' | 'kyc'`) are *not* purged by the close button. Today `deleteById` purges all three unconditionally, **before** the FK branch. Putting that behind a member-clickable control turns "Close my account" into a self-service document shredder — the exact thing the operator is trying to prevent. Document deletion stays on the erasure path. |

---

## 2. RELEASED vs HELD — the definitive uniqueness table

| Claim | Constraint | Released at closure? | Goes to | Failure if held |
|---|---|---|---|---|
| `username` (+ `usernameLower`) | `schema.prisma:246-247`, both `@unique` | **RELEASED — RENAMED, not nulled**, to `closed-<last 10 of userId>` | `AccountClosure.closedUsername` | Signup form hard-disables submit on "Already taken" from `users-public.controller.ts:56-62`, and there is no healer to fall back on any more — the one that used to free a handle by asking the identity provider whether its holder still existed went with the provider. **⚠️ `username` is now non-null** (`String @unique`, not `String?`) because it is the only name other members ever see, so a closed row cannot simply drop it: it takes an unclaimable one of its own instead. `usernameLower` moves with it or the second unique index keeps the original reserved, which is the exact bug the release exists to fix. |
| `email` | `schema.prisma:217` `@unique` | **RELEASED — rewritten** to `closed+<userId>@accounts.invalid` | `AccountClosure.closedEmail` | Blocks re-signup on the same address. **Not `@gungalore.local`** — see §7-H8. |
| `phone` | app-code only, `users.service.ts:1131-1140` | **RELEASED — `null`**, plus `phoneVerified: false`, `phoneOtpHash: null`, `phoneOtpExpiresAt: null` | `AccountClosure.closedPhone` | Re-signup dies at the OTP step with *"That phone number is already linked to another All Outdoor account."* Note `phoneVerified` must be reset too — today's scrub nulls `phone` at `:728` and leaves `phoneVerified` true (`schema.prisma:232`). |
| `bankVerificationId` | `schema.prisma:431` `@unique` | **RELEASED — `null`** | not retained | Latent `P2002` with no friendly handler. |
| `peachCustomerId` | `schema.prisma:588` `@unique` | **RELEASED — `null`** | not retained | Latent. Dormant today (nothing in `src/` writes it). |
| ~~`clerkId`~~ | — | **RESOLVED BY REMOVAL. The column is gone and so is the tombstone.** | — | This row used to carry the trickiest ordering constraint in the whole plan: hold the identity-provider subject through steps 1–3, then overwrite it with `closed_<userId>` in step 4, because tombstoning it any earlier made the webhook's own lookup miss and turned the handler into a silent no-op. `User.id` is the only user identifier now, it is a primary key, and it is never rewritten. **Nothing replaced the tombstone because nothing needed to** — it existed solely to stop the provider re-creating a closed account, and the username, email and phone releases below are the whole of what "the claims go back into the namespace" ever meant. |
| `kycIdHash` | `schema.prisma:288` `@unique` | **HELD — and the block becomes a relink.** See below. | copy in `AccountClosure.kycIdHashArchived` | This is the whole ban-evasion question. |
| `idNumberEncrypted` | not unique | **HELD** | stays on `User` | SAP 534 Section C. |

### 2.1 ⚠️ THE BAN-EVASION QUESTION — resolved

Retaining `kycIdHash` is, by accident, **the only identity-anchored enforcement barrier in the entire codebase.** Every other flag is a `@default` column that resets on a new row. There is no blocklist table keyed on a person: `FeaturedSlotBidderBan.userId` has no FK and is keyed on the old `User.id`; `AdminAlert.referenceId` and `AdminAuditEvent.resourceId` are bare strings.

So the naive reading of requirement C — "release the hash" — hands every banned seller a clean slate. That is not acceptable and it is not necessary.

**RECOMMENDED: Option A — convert the block into a relink.**

At all three dup-check sites, when the colliding row has `accountClosedAt != null`, **do not throw**:

- `kyc/kyc.service.ts:211-219` (VerifyNow flow)
- `kyc/kyc.service.ts:585-593` (Claude-vision flow)
- `users/users.service.ts:838-847` (`completeProfile`)

Instead, run `UsersService.relinkFromClosure(closedUserId, newUserId)` in one transaction:
1. Copy the enforcement state forward: `isBanned`, `bannedAt`, `sellingBannedAt`, `sellerRejectStrikes`, `auctionStrikes`, `dispatchStrikes`, `trustScore` from `AccountClosure.was*` onto the new row.
2. Move `kycIdHash` from the closed row onto the new row (the archived copy stays on the closure record, so the history of "this ID has been here before" is never lost).
3. Stamp `AccountClosure.reRegisteredAsUserId` + `reRegisteredAt`.

This mirrors the shape that already exists and is already trusted: the relink-by-email branch at `users.service.ts:412-437`.

**Plus the closure-side guard that actually resolves the conflict:** a member with `isBanned: true` or `sellingBannedAt != null` **cannot use the self-service button at all** (§6). A ban can only be closed through a support-reviewed admin closure. So the button can never launder a ban, and the relink catches anyone who was banned *after* closing.

**Rejected alternatives, for the record:**
- **Option B — release the hash.** Requirement C works with zero relink code; every strike and ban resets. Reject.
- **Option C — hold and keep blocking (today).** Requirement C dead; the member is told their own ID belongs to someone else and the only escape is a manual DB edit. Reject.

**⚠️ Honest limit, for the operator.** The ID-hash relink is a **seller-side** control only. KYC fires at first payment as a seller; the buy-side gate is one line — `if (buyer.isBanned)` at `payments/transactions.service.ts:158-160` — with no identity requirement anywhere. A member banned for buyer-side misconduct (`auctionStrikes`, `schema.prisma:437`) can close, re-register on a new email, and buy immediately, forever, regardless of what we do with `kycIdHash`. Closing that hole requires KYC at signup, which is a business decision the operator has not made. **This plan does not claim to close it. Do not tell the bank or the attorney that it does.**

### 2.2 Policy conflict the operator must resolve

`frontend/app/(legal)/privacy/page.tsx:283` already publishes: KYC ID hash *"retained while your account is active, plus 12 months after deletion to prevent duplicate registration."*

Option A keeps the hash and keeps duplicate registration prevented in the sense that matters — you still cannot hold two live accounts on one SA ID; the old one is closed and the new one inherits it. But "prevent duplicate registration" reads as an absolute block. **Recommend an attorney-reviewed edit** to: *"retained while your account is active, and after closure so that we can reattach your record if you register again and so that one identity cannot hold two accounts."* Three other rows on that page are already false against the code — see §7-H12.

---

## 3. PUBLIC ERASURE — surface by surface

**Decision: gone from surfaces we own; nameless on surfaces that belong to other members.** No "Former member" chip. A tombstone label invites clicking; the existing null-fallbacks already read correctly and cost nothing.

### 3.1 What changes

| # | Surface | Change | file:line |
|---|---|---|---|
| 1 | Seller profile `/sellers/:userId` | **404.** Add `accountClosedAt: null` to the `where`. ⚠️ **This is now the ONLY thing doing the job, not the belt-and-braces half of a pair.** It was written to cover the window between the member clicking Close and the identity-provider tombstone landing; with the tombstone gone the row keeps its `id` forever, so without this line every `/sellers/<id>` link the member ever shared keeps serving their storefront header. | `users/sellers-public.controller.ts:36-38` |
| 2 | Reviews received | 404s with #1 — `findForSeller` throws `NotFoundException` when the seller lookup misses. Nothing to change. | `ratings/ratings.service.ts:211-213` |
| 3 | Storefront grid on the profile | Empties with #4. | `listings/listings.service.ts:2715` |
| 4 | Browse / homepage / category grids / `?q=` search | Listings cancelled **and individually re-indexed**. `reindexById` removes any non-ACTIVE doc from Meili (`:3600-3613` → `removeFromIndex :3636`). **Do not copy `common/seller-reject-policy.ts:144-147`** — its `updateMany` never re-indexes, so cancelled listings stay searchable. | `listings.service.ts:3600` |
| 5 | SOLD / EXPIRED PDPs | **Stay up** — they are the sale record behind a `Transaction`, an `Order`, a `Rating` and (for a firearm) the SAP 534 chain. Seller chip renders `username: null` → frontend `'Anonymous seller'` fallback. | `listings.service.ts:192-197` (`PUBLICLY_VISIBLE_STATUSES`), seller block `:146-166` |
| 6 | Reviews they **wrote** on other sellers | Row kept (deleting it would silently lower another seller's review count and re-trigger `recalcSeller`). `rater.username` is now null. | `ratings.service.ts:237` |
| 7 | Public Q&A they **asked** | Row kept (the seller's answer is the seller's content). `asker.username` null. Frontend needs a fallback — the backend select returns it raw. | `listings/listing-questions.service.ts:133-158` |
| 8 | Auction bid history | Rows kept — the bid history is how a price was reached, and `auctions.service.ts` picks a runner-up from it on non-payment. **Degrades for free:** `'Anonymous'` at `auctions.service.ts:162`, `'Anonymous bidder'` at `:139`. | — |
| 9 | Prize-draw winners | **Degrades for free:** `?? 'a member'` at `raffle/raffle.service.ts:104` and `:111`. | — |
| 10 | Featured slot | Release it via the existing CAS-guarded expire path in `featured/featured.service.ts`. Never hand-roll. | — |
| 11 | Cart snapshot | `sellerUsername: string` is non-null in the type (`frontend/lib/cart-store.ts:21`) and rendered raw **and used as a React key** at `frontend/app/cart/page.tsx:424, :447, :456`. Two closed sellers in one cart collide on `key={null}`. Make it nullable + fallback. | — |
| 12 | Sitemap | Self-heals — `sitemapEntries` filters `status: 'ACTIVE'`. Nothing to do. | `listings.service.ts:2132-2143` |
| 13 | Ask Boet tools | Read through the same listing queries. Verify after, do not patch separately. | — |

### 3.2 Accepted residuals — state these, do not pretend to fix them

- **`Notification.body`** on *other members'* inboxes carries the handle frozen in prose (written with `proposerName` / `bidderName` at swap and auction notification sites). Private inboxes, not public surfaces. Rewriting historical free text retroactively is more risk than value.
- **`AdminAlert.context`** stores `username` verbatim (`common/seller-reject-policy.ts:158`). Admin-only, and it is *supposed* to be the accountability trail.
- **`Listing.pickup*`** and **`Address`** rows keep the residential address. `Address` is `onDelete: Cascade` and is untouched by any scrub today. Out of scope for closure (it is not a public surface); flag it for the erasure path.

### 3.3 What happens to live commitments at the moment they close

Nothing surprising happens, **because none of it is allowed to be open.** §6 refuses closure while any open offer, live auction with bids, pending order, in-flight shipment or unresolved complaint exists. What closure actually acts on is only:

- `Listing` in `DRAFT | PENDING_REVIEW | ACTIVE` (with `bidCount = 0` for auctions) → `CANCELLED`, then `reindexById` each.
- `ActionToken` rows → **deleted.** These are a **second auth rail that owes nothing to the session**: `kyc-or-token.guard.ts:76` resolves the user by `authorisedUserId`, with no session token in the request at all — which is the point, because the recipient of a `WITNESS_STATEMENT` or `SELLER_CONSENT` link is often not the member. Revoking every session (§4 step 3) therefore does **not** reach them. `onDelete: Cascade` only fires on a hard delete, so a soft closure would leave every outstanding SMS link live.
- Notification channels → all three off (`notifyEmailEnabled`, `notifySmsEnabled`, `notifyWhatsappEnabled`, `schema.prisma:504-512`).

---

## 4. ORDERING — and why each step is safe if the next fails

> **The rule the whole ordering exists to protect:** the erasure path must never hard-delete. Not for a closed account, not for any account.

⚠️ **THIS SECTION RAN 0–5 AND NOW RUNS 0–3.** The old steps 3 (delete the member from the identity provider), 4 (handle the `user.deleted` webhook that came back) and 5 (guard against a late `user.updated` resurrecting the row) were an entire distributed handshake between our database and somebody else's, and most of the ordering hazards in §7 were about it. There is no longer a second system to delete from and no webhook to guard against. What took their place is one call, the new step 3 below.

**Step 0 — precheck (read-only, `GET /users/me/closure-eligibility`).** Runs the §6 query. Returns the open items so the UI can show them *before* the member types anything.

**Step 1 — our DB, one `prisma.$transaction`.**
1. **Re-run every §6 check inside the transaction.** Step 0 is UX; this is the guard.
2. `create AccountClosure { ...snapshot, kycIdHashArchived, was* enforcement state, cancelledListingIds }`.
3. `update User`:
   - `accountClosedAt: now`
   - `username` **and** `usernameLower` → `closed-<last 10 of userId>` (a rename, not a null — see §2), `email: closed+<userId>@accounts.invalid`, `phone: null`, `phoneVerified: false`, `phoneOtpHash: null`, `phoneOtpExpiresAt: null`, `avatarUrl: null`
   - `bankVerificationId: null`, `peachCustomerId: null`
   - bank quartet (`bankName`, `bankAccountHolder`, `bankAccountNumber`, `bankBranchCode`, `bankAccountType`, `schema.prisma:417-421`) → `null`. **Safe only because §6 already proved no payout or refund is owed** — which is exactly the carve-out `privacy/page.tsx:290` already promises and the code has never honoured.
   - all three notify flags → `false`
   - **NOT touched:** `isBanned`, `bannedAt`, `kycIdHash`, `idNumberEncrypted`, `kycStatus`.
4. `deleteMany ActionToken { authorisedUserId }`.
5. Collect listing ids, `updateMany` → `CANCELLED`.

**Step 2 — reindex (outside the transaction, best-effort, idempotent).** `for (const id of cancelledIds) await this.listings.reindexById(id)`. Outside on purpose: a Meili failure must not roll back the closure.

**Step 3 — revoke every session.** `sessions.revokeAllForUser(user.id)`, immediately after the commit, in both `UsersService.closeMyAccount` and `AdminService.closeAccount`. **This is what now stops somebody using a closed account**, and it is the whole of what replaced steps 3–5 of the old plan.

- **Outside the transaction and FAIL-SOFT.** It is wrapped in `try`/`catch` and a failure is logged, never rethrown. A closure the member has already been told about must not roll back because the session table was briefly unhappy — and closed-in-our-database-with-a-live-token is strictly the safer of the two failures, because every write gate already refuses the row.
- ⚠️ **IT KILLS THE REFRESH SIDE, NOT THE ACCESS TOKEN.** `Session` holds a sha256 of the rotating refresh token; revoking marks those rows and the next refresh fails. The access JWT is stateless and lives **15 minutes**, so a closed member can still hold a working token for up to that long. That is the honest ceiling — do not describe closure as instantaneous sign-out.
- ⚠️ **IT DOES NOT REACH `ActionToken`.** Those resolve a user without a session at all (§3.3), which is why closure deletes them explicitly in step 1.4 rather than trusting this.
- Step 2 and step 3 are both post-commit and neither can roll the closure back, so their order relative to each other does not matter.

**Steps 4 and 5 — GONE, and resolved by removal rather than deferred.**

The old step 4 handled the `user.deleted` webhook coming back from the identity provider, and the old step 5 was three "resurrection guards" stopping a late `user.updated` from writing the real email and handle back onto a closed row. Both existed only because a second system also believed it owned the member. It does not exist any more:

- There is no `POST /webhooks/clerk`, no `svix` signature to verify, and no `user.deleted` event.
- `upsertFromClerk`, `resolveUsernameConflict` and the relink-by-email branch went with it. **Nothing syncs a member's identity columns from an outside system any more.** Sign-up writes them once, against a username and email it has already proved are free; the only other writer is a deliberate admin support edit.
- **The one line that mattered most is still deleted.** `await this.prisma.user.deleteMany(...)` was the only way `Complaint` (`schema.prisma:3667`), `ComplaintPhoto` (`:3705`), `SupportTicket`, `Subscription`, `LoginEvent` and `AskGgConversation` could ever be destroyed, and the only way `ContactDetailRejection.userId` could be orphaned. `deleteById` now always takes the preserve-and-scrub path; keep it that way.

### 4.1 What each failure costs

| Step fails | State | Cost |
|---|---|---|
| 1 | Atomic — nothing happened | Member retries. |
| 2 | Closed, listings CANCELLED, some Meili docs stale | A cancelled listing may surface in `?q=` until the sweep. Its PDP already 404s for non-owners (`PUBLICLY_VISIBLE_STATUSES`, `listings.service.ts:192-197`), so **no live listing is ever exposed**. Self-healing. |
| 3 | Closed in our DB, sessions still live | The member keeps a working refresh cookie until it expires on its own. Every money gate refuses them (§8 Phase 1 adds `accountClosedAt` alongside the existing `isBanned` checks) and every public surface has already gone, so this is a nuisance, not an exposure. **Logged, never thrown** — see step 3. Re-running the closure is a safe no-op and revokes again. |
| ~~4~~ | ~~Webhook lost / duplicated / reordered~~ | **Cannot happen — there is no webhook.** The old note here (no `svix-id` dedupe anywhere, so idempotency had to come from the handler rather than the transport) is moot. The idempotency it argued for stayed regardless and is still worth having: `accountClosedAt` is set-once and `close()` checks it before anything else, so a double-submitting member closes once. |

---

## 5. MEMBER-FACING FLOW

**Where:** `/settings`, a new section at the bottom, below "Saved addresses" (`frontend/app/settings/page.tsx:683+`). Not in the account menu (`frontend/lib/account-menu-data.tsx:245-249`) — it is a setting, not a destination.

**✅ RESOLVED BY REMOVAL — there is no second delete button to worry about.** This used to warn that the settings page mounted a vendor profile modal whose "Delete account" section was gated by an *instance-level dashboard setting*, so a flip in somebody else's console could surface a self-delete button in our shipped UI with **zero code change** and fire `user.deleted` straight at the webhook. That modal is gone with the provider. **The screens below are now the only way to close an account**, which is the property the warning was asking for — keep it that way, and treat any new "delete" affordance in settings as a change to this document.

### 5.1 Settings section — ready to paste

> ### Close your account
>
> Closing your account takes your profile and your listings off All Outdoor and signs you out permanently. You will not be able to sign back in to this account.
>
> This is not the same as deleting everything we hold about you. We keep a record of your dealings on the platform. Read what that means before you decide.
>
> **[ Close my account ]**

### 5.2 Confirmation screen — ready to paste

> ## Close your account?
>
> **What happens straight away**
>
> - Your seller profile page stops working. Anyone with the link gets a "not found" page.
> - Your listings are cancelled and removed from search.
> - Your username is released. Someone else may take it.
> - Your phone number and email address are released from your account.
> - Your banking details are deleted.
> - Any pending links we sent you by SMS stop working.
> - You are signed out and cannot sign in again with this account.
>
> **What we keep, and why**
>
> We keep a record of what you did on All Outdoor: your sales and purchases, the offers and bids you made, ratings written by you and about you, any complaints you or another member lodged, and any statutory firearm transfer paperwork we completed for you.
>
> That record stays linked to your name, your ID number and your contact details. It is not visible to other members — only to our staff, and to the authorities where the law requires us to hand it over.
>
> We keep it because a marketplace where anybody can erase what they did by closing an account is a marketplace where nobody can be held to anything. Transaction records are also kept for five years under FICA record-keeping rules, and firearm transfer records for the period the firearms legislation requires.
>
> Our full retention periods are in the [Privacy Policy](/privacy).
>
> **If you want to come back**
>
> You can register again with the same email address, the same phone number and the same ID number. Your previous record is reattached to your new account when you verify your identity, including anything outstanding against it.
>
> **If you want your data deleted**
>
> Closing your account is not a deletion request. If you want us to delete what we are not legally required to keep, contact us and we will deal with it as a request under section 24 of POPIA.
>
> ---
>
> Why are you closing your account?
>
> ○ I am not using All Outdoor
> ○ I did not find what I was looking for
> ○ I had a bad experience
> ○ I am worried about my privacy
> ○ I am opening a different account
> ○ Other
>
> Type **CLOSE** to confirm.
>
> `[________]`
>
> **[ Close my account ]** [ Cancel ]

### 5.3 Blocked screen — ready to paste

> ## We cannot close your account yet
>
> Some things on your account are still open. Closing now would leave another member, or you, without a way to finish them.
>
> *(list of the specific open items, each linking to its page)*
>
> Once these are finished, come back to Settings and close your account then. If something here looks stuck, contact support and we will sort it out.

### 5.4 Banned screen — ready to paste

> ## Contact support to close your account
>
> There is a restriction on your account, so it cannot be closed from here. Contact support and we will handle it.

---

## 6. WHAT BLOCKS CLOSURE — enumerated from the code

All predicates below are evaluated for the member as **buyer or seller**, and re-evaluated inside the closure transaction.

### Money in flight

| Check | Predicate | file:line |
|---|---|---|
| Funds held | `Transaction.paymentStatus IN (HELD, PENDING_ADMIN_VERIFICATION, DISPUTED)` | `schema.prisma:59-65`, `:1507` |
| Payout owed | `paymentStatus = RELEASED AND sellerPayout > 0 AND paidOutAt = null AND refundOfId = null AND payoutHeldAt = null` — the **exact** `getPayoutsDue` predicate | `manual-payments/manual-payments.service.ts:493-504`, `schema.prisma:1531, 1537` |
| Payout on admin hold | `payoutHeldAt != null` | `schema.prisma:1537` |

> This block is what makes it safe to null the bank quartet in Step 1. `hasBank()` (`manual-payments.service.ts:601-605`) is the readiness predicate for every payout run; nulling it while a payout is due makes that money **permanently unpayable with no alert**, and there is no re-collection path once the account is gone. It also honours `privacy/page.tsx:290`, which already promises this carve-out.

**Told:** *"We are still holding or still owe money on N of your orders. These have to settle first."*

### Undelivered goods

`Transaction.paidAt != null AND shippingStatus IN (PENDING, COLLECTED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERY_FAILED)` — `schema.prisma:111-119`, `:1546`.

**Told:** *"N orders are paid for and not delivered yet."*

### Undelivered firearm / pending SAP 534

`listing.isFirearm = true AND shippingMethod = DEALER_TRANSFER AND paidAt != null AND (dealerVerifiedAt = null OR dealerVerificationStatus IN ('PENDING_UPLOAD','PENDING_CLAUDE','PENDING_ADMIN_REVIEW'))` — `schema.prisma:1840-1858`.

**Told:** *"A firearm sale is still going through a dealer. The transfer paperwork has to be finished before you can close."*

### Open dispute or complaint

- Lodged by them: `Complaint.userId = me AND status NOT IN ('RESOLVED','CLOSED')` — `schema.prisma:3667, :3681`.
- **Lodged against them:** `Complaint.transaction.sellerId = me OR .buyerId = me`, same status filter. This is the one that matters most for the operator's stated fear.
- `Transaction.paymentStatus = DISPUTED` (covered above).

**Told:** *"There is an open complaint involving one of your orders (case CO0001xx). It has to be closed out first."*

### Live commitments

| Check | Predicate | file:line |
|---|---|---|
| Buyer mid-checkout | `Listing.status = PAYMENT_PENDING` | `schema.prisma:52` |
| Live auction with bidders | `listingType = AUCTION AND status = ACTIVE AND bidCount > 0` | `schema.prisma:42-47` |
| Open offers (either side) | `Offer.status IN (PENDING, COUNTERED, ACCEPTED)` | `schema.prisma:32-40` |
| Open swap proposals | `SwapProposal.status IN (PENDING, COUNTERED, ACCEPTED)` | `schema.prisma:3826-3834` |
| Live swaps | `Swap.status IN (AWAITING_FUNDING, LOCKED, IN_TRANSIT, AWAITING_VERIFICATION, DISPUTED)` | `schema.prisma:3836-3844` |
| Open orders | `Order.status IN (AWAITING_PAYMENT, PAID, PARTIALLY_FULFILLED)` | `schema.prisma:3722-3729` |

**Told, per item:** *"You have N open offers"*, *"An auction of yours has bids on it and ends on <date>"*, etc., each linking to the page.

### Enforcement — refuse the button entirely

`isBanned = true` (`schema.prisma:401`) **or** `sellingBannedAt != null` (`:451`) → the §5.4 screen. This is the ban-evasion resolution: a restricted account can only be closed through an admin closure that records `closedByAdminId`.

### Warning, not a block

Active `Subscription` (`status = ACTIVE`, `schema.prisma:3032`). There is no auto-renew on this rail, so a closed account is not billed again — but tell them the subscription ends.

---

## 7. HAZARD LIST

**BLOCKER**

- **H1 — SAP 534 Section C is assembled LIVE off the seller row.** `assembleSaps534Data` (`payments/transactions.service.ts:5247-5300`) reads `firstName`, `lastName`, `idNumberEncrypted`, `phone`, `email`, `addrBuilding/Street/Address2/Suburb/City/PostalCode` directly from `tx.seller`. `Transaction` carries **no** identity snapshot (`schema.prisma:1415-1445`). Today's scrub nulls all six inputs (`users.service.ts:725-735, :753-760`), so a re-download via `getSaps534Pdf` (`:5311-5333`) produces a form with the whole of Section C blank and the email reading `deleted+…@gungalore.local`. The comment at `users.service.ts:733-735` claiming this "lives on the Transaction, not here" is **false**. **Mitigation in this plan:** closure never nulls those columns; Phase 0 makes the same true for the webhook path.
- **H2 — the hard delete at `users.service.ts:714` runs first.** Everything else is a `catch`. The member with the *cleanest* trading record gets the *most thorough* evidence wipe. Deleted entirely in Phase 0.
- **H3 — `Complaint` (`schema.prisma:3667`) and `ComplaintPhoto` (`:3705`) are `onDelete: Cascade`.** The CPA/TPPP register, its case numbers and its private evidence rows go with the member. `SupportTicket`, `Subscription`, `AskGgConversation`, `LoginEvent`, `Address`, `ActionToken`, `Notification` likewise (confirmed against `prisma/migrations/20260812000000_baseline/migration.sql`). `ContactDetailRejection.userId` is `ON DELETE SET NULL` — the off-platform-coordination log survives with its actor removed.
- **H4 — `kycIdHash` is currently the only ban-evasion barrier.** Releasing it, as the obvious reading of requirement C suggests, resets every enforcement column. §2.1.
- **~~H5~~ — RESOLVED BY REMOVAL, not fixed.** The hazard was that tombstoning `clerkId` before the identity-provider delete made the webhook a *total* no-op: the handler looked the row up by `clerkId`, and `deleteMany` on a miss deletes 0 rows **without throwing**, so even the `catch` never ran. It forced the counter-intuitive ordering in §4 (tombstone *after* the webhook, not before). There is no `clerkId`, no tombstone and no webhook, so the constraint that shaped the whole ordering section is simply gone. **Nothing in the current flow depends on a lookup by anything but `User.id`.**
- **H6 — `ActionToken` is an auth rail that owes nothing to the session. STILL LIVE, and now the *only* thing of its kind.** `auth/kyc-or-token.guard.ts:76` resolves by `authorisedUserId` with no session token in the request. Cascade only fires on a hard delete. Closure must delete these explicitly (Step 1.4) or an outstanding SMS link lets a closed account still bid or complete a checkout. ⚠️ **Revoking sessions (§4 step 3) does not touch them** — the two rails are independent by design, because the person opening a `WITNESS_STATEMENT` or `SELLER_CONSENT` link is usually not the member. Note `/a/(.*)` is a public route in `frontend/middleware.ts`.
- **H7 — nulling the bank quartet strands in-flight money.** `hasBank()` (`manual-payments.service.ts:601-605`) is the payout readiness gate; refunds read the same fields. §6 blocks closure while any payout or refund is due, which is the only safe way to do this.

**SERIOUS**

- **H8 — `deleted+<ts>@gungalore.local` is unroutable and nothing filters on it.** It is the only occurrence of that domain in the backend; no notification path or cron excludes it, so every closed row keeps generating hard bounces. Use `@accounts.invalid` (RFC 2606 reserved) **and** switch all three `notify*Enabled` flags off in Step 1.
- **H9 — `isBanned: true` on the scrub branch (`users.service.ts:767`) conflates closure with enforcement, in both directions.** It puts closed accounts in the admin `'banned'` filter (`admin/admin.service.ts:396`) with no `bannedAt` and no audit event, and **one click on Unban (`:486-494`) silently reopens a closed account** — it is the only control that touches the flag. Closure must never write `isBanned`.
- **~~H10~~ — RESOLVED BY REMOVAL.** The hazard was that the provider-sync upsert wrote `email`, `username` and `avatarUrl` onto a matched row unconditionally on every `user.updated`, and the existing guard checked row *existence* rather than closure — so one late event could write the real email and handle straight back onto a closed account. That whole sync path is deleted along with the webhook. **No outside system writes a member's identity columns any more** — sign-up writes them once, and the only other writer is a deliberate admin support edit. ⚠️ The general shape is still worth watching: **any future path that writes `email`/`username` onto an existing row must exclude `accountClosedAt != null`**, or it re-creates this exactly.
- **H11 — admin cannot clear a username.** `admin/admin.service.ts:501` marks it non-clearable (`false`), documented at `:497-499` as *"public identity — listings/ratings render it"*. This plan overrides that documented invariant deliberately; the admin path must change with it, or a closure that fails halfway cannot be finished by hand.
- **H12 — four published privacy commitments are false against the code.** `privacy/page.tsx:282` ("permanently de-identified within 90 days") — nothing implements it. `:283` (12-month hash hold) — held forever, no expiry job. `:284` (encrypted ID kept where a statutory document exists) — nulled unconditionally at `users.service.ts:735`. `:290` (bank details kept where a transaction is unresolved) — nulled unconditionally at `:761-765`. `:286-287` (Cloudinary images "not deleted at present") is now stale in our favour. **The page must be revised in the same release as the button.**
- **H13 — `updateMany` never re-indexes.** `common/seller-reject-policy.ts:144-147` cancels every ACTIVE listing on a selling ban and calls nothing; Meili filters on the *indexed* status, so those listings stay searchable. Do not copy the pattern; use `reindexById` per id (`listings.service.ts:3600`).
- **H14 — a `User`-level flag cannot hide stock from `?q=`.** The Meili document carries `sellerId` and nothing else about the seller, and Meili cannot join. A relation filter would work on `browseViaPrisma` and be **silently ignored** on `browseViaSearch`. Cancelling + reindexing sidesteps this entirely; do not solve it with a seller-relation filter.
- **H15 — the verification badge outlives its evidence.** `kycStatus`, `sellerTier`, `averageRating`, `totalSales`, `isVerifiedExpert` all survive the scrub, and `sellers-public.controller.ts:58` publishes `idVerified: kycStatus === 'VERIFIED'`. A profile that 404s (§3) makes this moot — but only if the 404 lands.
- **H16 — the document purges run unconditionally, before the FK branch.** `users.service.ts:658, :679, :698` destroy motivations, Licence Centre credentials and KYC files for **any** matched row. Putting that behind a member-clickable button is a self-service shredder. This plan keeps closure out of the document stores entirely.
- **H17 — `phoneVerified` is left `true` on a row with `phone: null`.** Cosmetic today; a landmine for any future "verified phone" query. Reset it in Step 1.

**MINOR**

- **~~H18~~ — RESOLVED BY REMOVAL.** There was no `svix-id` dedupe on the webhook transport, so each replay of the handler minted a *different* sentinel email. No webhook, no replay. The handler-level idempotency it argued for was built anyway and still earns its place against a double-submitting member: `close()` returns quietly when `accountClosedAt` is already set, **before** it evaluates the blockers, so a repeat never throws ALREADY_CLOSED at somebody whose account is in exactly the state they asked for.
- **H19 — `AdminAuditEvent.adminUserId` is a required FK** (`schema.prisma:2124-2125`), so a self-service closure cannot be audited there. `AccountClosure` is the audit record.
- **H20 — cart `sellerUsername` is typed non-null and used as a React key.** `frontend/lib/cart-store.ts:21`, rendered at `frontend/app/cart/page.tsx:424, :447, :456`.
- **H21 — reserved-handle list does not reserve the de-identification fallbacks.** `users-public.controller.ts` `RESERVED` contains `'anonymous'` but not `'seller'` or `'a_member'`. Low risk with our null-fallback approach, but add them.
- **H22 — two existing tests assert the hard delete and will fail on Phase 0.** `src/users/users.service.spec.ts:307` (`expect(prisma.user.deleteMany).toHaveBeenCalled()`), `:308`, `:320`, `:334` (`expect(order).toContain('user.delete')`). They must be **rewritten to assert the opposite**, not deleted.
- **H23 — `UserEvent` has no FK** (`userId`, `deviceId`, `sessionId` all bare optional strings, `schema.prisma:3966-3970`) and survives everything, orphaned, until the 12-month prune. The `clerkId` column this finding also named is gone; the finding itself is not, because the analytics trail still outlives the account either way. Out of scope; note it.

---

## 8. BUILD ORDER — each phase shippable on its own

### Phase 0 — Stop the destruction *(no UI, no schema, ship immediately)*

Nothing here depends on any decision above, and every day it is not shipped is a day a `user.deleted` can destroy a complaints register.

1. Delete `await this.prisma.user.deleteMany(...)` from `users.service.ts:714`. Always take the preserve path.
2. Remove `isBanned: true` from the scrub block (`:767`).
3. Stop nulling `idNumberEncrypted` (`:735`) and the bank quartet (`:761-765`).
4. Change the sentinel email to `@accounts.invalid` and switch `notifyEmailEnabled` / `notifySmsEnabled` / `notifyWhatsappEnabled` to `false`.
5. Reset `phoneVerified` / `phoneOtpHash` / `phoneOtpExpiresAt` alongside `phone`.
6. ~~Verify the identity provider's `delete_self_enabled` is off in its dashboard.~~ **Resolved by removal** — no vendor dashboard, no second delete button. §5.

**Tests:** rewrite `users.service.spec.ts:307, :308, :320, :334` to assert `prisma.user.deleteMany` is **never** called and the order contains no `user.delete`. New: a user with only a `Complaint` survives an erasure with the complaint intact. New: `assembleSaps534Data` still returns a full Section C after `deleteById`. New: no notification is dispatched to a scrubbed row.

### Phase 1 — The model and the closure service *(admin-triggered only)*

1. Migration: `User.accountClosedAt`, `AccountClosure`.
2. `AccountClosureService.close(userId, { closedBy, closedByAdminId?, reason })` — steps 1–3 of §4.
3. `canClose(userId)` — the whole §6 predicate set, returning structured blockers.
4. `deleteById` becomes closure-aware — an already-closed row is logged and left alone, never re-scrubbed. ~~…including the `clerkId` tombstone.~~ **Resolved by removal.**
5. ~~Resurrection guards in `upsertFromClerk`, `resolveUsernameConflict`, the relink-by-email branch.~~ **Resolved by removal** — all three paths are deleted. §4.
6. Add `accountClosedAt` to every existing `isBanned` write-gate (`listings.service.ts:813, 838, 915, 1174`; `offers.service.ts:63`; `auctions.service.ts:303`; `payments/transactions.service.ts:158-160`; `swaps/swap-proposals.service.ts:126`; `featured.service.ts:490, 648`; `subscriptions.service.ts:145`) with a distinct message — *"This account has been closed"*, never *"suspended"*.
7. Admin: a **Close account** action distinct from Ban; an `accountClosedAt != null` chip in the user list that is **not** the red BANNED chip; a `'closed'` filter; and make `username` clearable at `admin.service.ts:501` (H11).

**Tests:** each §6 blocker independently refuses; `canClose` and the in-transaction guard agree; a banned user is refused; closure is atomic (a forced failure at step 1.5 rolls back the `AccountClosure` row); closure is idempotent (second call is a no-op); the enforcement snapshot is complete; `deleteById` on a closed row is a no-op; the scrubbed row's `username` and `usernameLower` are both the `closed-…` form and the original handle is claimable again; **`sessions.revokeAllForUser` is called after the commit, and a throw from it does not fail the closure**; every money gate rejects a closed user with the closed-not-banned message.

### Phase 2 — Public erasure

1. `accountClosedAt: null` on `sellers-public.controller.ts:36-38`.
2. Cancel + `reindexById` per listing in the closure transaction's follow-up.
3. Release the featured slot via the existing CAS path.
4. Frontend null-fallbacks: Q&A asker (`questions-panel`), cart `sellerUsername` (`cart-store.ts:21` → nullable, plus `cart/page.tsx:447` key fix).
5. A reindex retry sweep reading `AccountClosure.cancelledListingIds`.
6. Add `'seller'`, `'a_member'` to `RESERVED`.

**Tests:** integration — close a seller with one ACTIVE, one SOLD and one EXPIRED listing, then assert: profile 404s, the ACTIVE listing is absent from `browseViaPrisma` **and** from `browseViaSearch`, the SOLD PDP still loads with a null seller username, the review they wrote still renders on the other seller's profile without a handle, bid history renders `'Anonymous'`, the sitemap no longer contains the cancelled listing.

### Phase 3 — The member-facing button

1. `GET /users/me/closure-eligibility` and `POST /users/me/close` (`AuthGuard`, tight throttle) on `users.controller.ts`.
2. The `/settings` section, confirmation screen, blocked screen and banned screen (§5, copy is ready to paste).
3. A closed-account screen behind `/users/me` for the case where step 3 fails and a live token outlives the closure.
4. **Privacy policy revisions** (H12) — this ships in the same release, attorney-reviewed.

**Tests:** E2E happy path; E2E blocked path renders each specific open item; the confirm gate requires the literal `CLOSE`; a banned member sees the support screen; double-submit closes once.

### Phase 4 — Re-registration relink

1. `UsersService.relinkFromClosure(closedUserId, newUserId)`.
2. Convert the three dup-checks from throw to relink at `kyc/kyc.service.ts:211-219`, `:585-593`, `users/users.service.ts:838-847`.

**Tests:** a clean closed member re-registers, re-verifies with the same SA ID, and lands with `isBanned: false` and zero strikes, with `reRegisteredAsUserId` stamped. A member closed with 2 `sellerRejectStrikes` re-registers and lands **with 2 strikes**. A member banned *after* closing re-registers and lands **banned**. `kycIdHashArchived` survives the hash moving to the new row. A *live* account's ID hash still hard-blocks with the original message.

### Phase 5 — Cleanups

Notification suppression for `accountClosedAt != null` in `NotificationsService.send`; admin dossier renders the `AccountClosure` snapshot (this is the "who was this" answer for a law-enforcement request); a 12-month `kycIdHashArchived` expiry job if the operator keeps the published hold; `AdminAlert` for a closure with anything unusual attached.

---

## 9. THE THREE THINGS THAT NEED AN OPERATOR OR ATTORNEY DECISION

1. **`kycIdHash` — Option A (relink) is the recommendation.** It needs a small wording change at `privacy/page.tsx:283`. Options B and C are set out in §2.1 with why they are rejected.
2. **The buy-side ban-evasion hole is not closed by this plan** and cannot be closed without KYC at signup (§2.1). Do not represent otherwise to the bank.
3. **Four published retention promises are currently false** (H12) and must be corrected in the same release as the button, or the button makes them worse rather than better.