'use client';

/**
 * THE DESK — the Member drawer. Replaces /admin/users/[id].
 *
 * 🚨 THE ONE PLACE ON THE DESK WHERE A REAL NAME AND AN IDENTITY DOCUMENT
 * LEGITIMATELY APPEAR — because a verification decision cannot be made
 * without them. Which is exactly why the rules are tighter here, not looser:
 *
 *   · The heading is the USERNAME. Always. A drawer titled with a real name
 *     puts it in a screenshot, a screen-share and a browser history, and none
 *     of those were the decision it was revealed for.
 *   · The real name, the contact details, the date of birth and the bank
 *     account holder are behind ONE deliberate reveal. They are already in
 *     the payload — the reveal costs nothing but a press, and it is the
 *     difference between an operator who opened this drawer to check a payout
 *     and an operator who chose to look at somebody's identity.
 *   · The identity DOCUMENTS are behind a second reveal, per document,
 *     because that one costs a decryption call on the server. Nothing is
 *     decrypted on open — see revealKycDocument in lib/desk-member.ts.
 *   · Every revealed document is revoked when the drawer closes. A blob URL
 *     left alive keeps a decrypted South African ID in the tab for as long as
 *     the tab lives, which is the exposure the encrypted store exists to end.
 *
 * ⚠️ NOT WIRED TO A BOARD HERE. The drawer fetches its own dossier from a
 * userId so a board only has to say which member is open.
 */
import * as React from 'react';
// Kit pieces come from their own files, the way every other file in this
// directory does it — importing the barrel from inside the barrel is how a
// circular import gets introduced the day this is added to index.ts.
import { Button, Chip, Input, Tag } from './primitives';
import { DialogFrame, Drawer, ResultBlock, Section, Timeline } from './overlays';
import { Kv, Label, formatRand } from './numbers';
import { FailedRegion, SkeletonPile } from './states';
import { RadioRow } from './forms';
import {
  IconAlert,
  IconBanknote,
  IconCheck,
  IconExternal,
  IconInfo,
  IconLock,
  IconRefresh,
  IconShield,
  IconUser,
} from './icons';
import {
  BAN_REASONS,
  KYC_APPROVE_REASONS,
  KYC_REJECT_REASONS,
  UNBAN_REASONS,
  accountStandings,
  bankStanding,
  CLOSE_MIN_REASON,
  KYC_STATUSES,
  SELLER_TIERS,
  USERNAME_MAX,
  USERNAME_MIN,
  clearRejectStrikes,
  closeMemberAccount,
  setKycStatusDirect,
  setSellerTier,
  setUsername,
  usernameIsUsable,
  composeReason,
  describeDecisionFailure,
  faceMatchPercent,
  fetchMemberDossier,
  handleInitials,
  handleOf,
  hasKycDocument,
  identityOf,
  legacyKycUrl,
  memberDate,
  memberDateTime,
  readFindings,
  releaseKycDocument,
  rerunBankVerification,
  reviewMemberKyc,
  revealKycDocument,
  scoreKind,
  setMemberBan,
  strikeRows,
  verificationStanding,
  type KycDocumentKind,
  type MemberDossier,
  type MemberUser,
  type ReasonChoice,
  type RevealedDocument,
  type StandingKind,
} from '@/lib/desk-member';

export interface MemberDrawerProps {
  open: boolean;
  /** The User.id — a cuid, not a Clerk sub. */
  userId: string | null;
  onClose: () => void;
  /** Fired after any decision lands, so the board behind can re-read its list. */
  onChanged?: () => void;
}

type PendingAction = 'approve' | 'reject' | 'ban' | 'unban' | 'bank' | 'strikes' | 'close' | null;

interface ActionResult {
  ok: boolean;
  tag: string;
  body: string;
}

export function MemberDrawer({ open, userId, onClose, onChanged }: MemberDrawerProps) {
  /**
   * 🚨 EVERYTHING LOADED IS STAMPED WITH THE MEMBER IT BELONGS TO, and read
   * back only while the two still agree.
   *
   * The effect that clears this state runs AFTER the render that changed
   * userId, so an unstamped dossier is drawn for one frame under the NEW
   * member's drawer — on the sibling listing drawer that frame is somebody's
   * photos, and here it is their real name, their email, their phone number
   * and, if the identity was revealed, all three at once. A privacy rule that
   * only holds once the effects have run is not a privacy rule.
   */
  const [loaded, setLoaded] = React.useState<{ userId: string; dossier: MemberDossier } | null>(
    null,
  );
  const [failure, setFailure] = React.useState<{ userId: string; detail: string } | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);

  const [identityShown, setIdentityShown] = React.useState(false);
  const [docs, setDocs] = React.useState<Record<KycDocumentKind, RevealedDocument | null>>({
    id: null,
    selfie: null,
  });
  const [docBusy, setDocBusy] = React.useState<KycDocumentKind | null>(null);
  const [docError, setDocError] = React.useState<Record<KycDocumentKind, string | null>>({
    id: null,
    selfie: null,
  });

  const [action, setAction] = React.useState<PendingAction>(null);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<(ActionResult & { userId: string }) | null>(null);

  // The revoke on close has to reach the CURRENT blobs, and the cleanup below
  // closes over whatever was in scope when the effect ran — so the live ones
  // are kept on a ref alongside the state that renders them.
  const docsRef = React.useRef<Record<KycDocumentKind, RevealedDocument | null>>({
    id: null,
    selfie: null,
  });

  /**
   * 🚨 WHICH MEMBER THE DRAWER IS ACTUALLY SHOWING, readable from a promise.
   *
   * A decryption round-trip outlives both a close and a switch, and the
   * promise carries no idea of either. Without this, a reveal that lands late
   * draws the PREVIOUS member's identity document under the new member's
   * handle — and one that lands after a close creates an object URL with no
   * drawer left to revoke it, pinning a decrypted South African ID in the tab
   * for as long as the tab lives. That is the exact exposure the encrypted
   * store exists to end.
   */
  const showing = React.useRef<string | null>(null);

  const releaseAll = React.useCallback(() => {
    releaseKycDocument(docsRef.current.id);
    releaseKycDocument(docsRef.current.selfie);
    docsRef.current = { id: null, selfie: null };
    setDocs({ id: null, selfie: null });
    setDocError({ id: null, selfie: null });
    setDocBusy(null);
  }, []);

  // ⚠️ EVERY REVEAL IS PER-OPENING. Closing the drawer and reopening it — on
  // this member or the next one — starts hidden again, and the decrypted bytes
  // are freed on the way out. A reveal that persisted would mean the second
  // member's drawer opens showing the first member's document.
  React.useEffect(() => {
    if (!open) return;
    showing.current = userId;
    setIdentityShown(false);
    setAction(null);
    return () => {
      showing.current = null;
      // ⚠️ HIDDEN ON THE WAY OUT, NOT ONLY ON THE WAY IN. This state outlives a
      // close, and the reset above lands only after the reopened drawer has
      // already painted — so a drawer closed with the identity showing would
      // paint that identity again, unasked, the moment it reopens.
      setIdentityShown(false);
      // The outcome belongs to the sitting the operator did it in. Kept across
      // the refetch it triggers (the reload key does not run this cleanup),
      // dropped on the way out — "@boetie is banned. They have been messaged."
      // is true when it lands and stale when the drawer reopens an hour later.
      setResult(null);
      releaseAll();
    };
  }, [open, userId, releaseAll]);

  React.useEffect(() => {
    if (!open || !userId) return;
    let live = true;
    // Back to a skeleton for the length of the read. A decision bumps the
    // reload key, and leaving the pre-decision dossier on screen would draw
    // "not banned" tags underneath a banner saying the ban landed. The banner
    // itself sits above this branch, so the operator is not left guessing.
    setLoaded(null);
    setFailure(null);
    (async () => {
      try {
        const d = await fetchMemberDossier(userId);
        if (live) setLoaded({ userId, dossier: d });
      } catch (err) {
        if (live) setFailure({ userId, detail: describeDecisionFailure(err) });
      }
    })();
    // Nothing is written once the drawer has moved on — the stamp above keeps
    // a late arrival off the screen, and this keeps it out of state entirely.
    return () => {
      live = false;
    };
  }, [open, userId, reloadKey]);

  async function reveal(which: KycDocumentKind) {
    if (!userId) return;
    const forUser = userId;
    setDocBusy(which);
    setDocError((e) => ({ ...e, [which]: null }));
    try {
      const doc = await revealKycDocument(forUser, which);
      // ⚠️ THE DRAWER MAY HAVE MOVED ON. Revoke rather than render: these are
      // decrypted identity bytes, and the member they belong to is no longer
      // the member on screen.
      if (showing.current !== forUser) {
        releaseKycDocument(doc);
        return;
      }
      releaseKycDocument(docsRef.current[which]);
      docsRef.current = { ...docsRef.current, [which]: doc };
      setDocs((d) => ({ ...d, [which]: doc }));
    } catch (err) {
      if (showing.current !== forUser) return;
      setDocError((e) => ({ ...e, [which]: describeDecisionFailure(err) }));
    } finally {
      if (showing.current === forUser) setDocBusy(null);
    }
  }

  function hide(which: KycDocumentKind) {
    releaseKycDocument(docsRef.current[which]);
    docsRef.current = { ...docsRef.current, [which]: null };
    setDocs((d) => ({ ...d, [which]: null }));
  }

  /**
   * ⚠️ THE SUCCESS MESSAGE IS OURS, NEVER THE RESPONSE BODY.
   *
   * PATCH /admin/users/:id answers with the whole updated User row — real
   * name, email, phone, the encrypted SA ID, the bank account number. Echoing
   * a response into the drawer the way a failure is echoed would put every one
   * of those on screen for an operator who only pressed Ban. Failures are
   * printed verbatim because a refusal is a sentence written for a human;
   * successes get a sentence written here.
   */
  async function run(tag: string, done: string, fn: () => Promise<unknown>) {
    // ⚠️ ONE PRESS, ONE CALL. `loading` on a Button dims it, it does not
    // disable it — so without this guard a double-click on "Re-run the check"
    // spends a second real, billed Peach BANV call and decrypts the member's
    // SA ID again. The buttons are disabled while busy as well; this is the
    // half that cannot be styled away.
    if (busy || !userId) return;
    const forUser = userId;
    setBusy(true);
    try {
      await fn();
      setResult({ ok: true, tag, body: done, userId: forUser });
      setAction(null);
      setReloadKey((k) => k + 1);
      onChanged?.();
    } catch (err) {
      // ⚠️ THE REFUSAL IS THE MESSAGE. The backend's guards speak in full
      // sentences — "This verification is not awaiting review (status: …)",
      // "Already decided by another admin — refresh the page" — and rewriting
      // either as "Something went wrong" costs a support call.
      setResult({ ok: false, tag, body: describeDecisionFailure(err), userId: forUser });
      setAction(null);
    } finally {
      setBusy(false);
    }
  }

  // The stamps, read back. A dossier, a failure or an outcome belonging to
  // another member is not this member's, and reads here as "not loaded yet".
  const dossier = loaded && loaded.userId === userId ? loaded.dossier : null;
  const loadError = failure && failure.userId === userId ? failure.detail : null;
  const outcome = result && result.userId === userId ? result : null;

  const user = dossier?.user ?? null;
  const handle = dossier ? handleOf(dossier) : 'Member';
  const verification = user ? verificationStanding(user) : null;
  const standings = dossier ? accountStandings(dossier) : [];

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        typeLabel="Member"
        icon={IconUser}
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {dossier ? <Avatar initials={handleInitials(dossier)} /> : null}
            {/* ⚠️ THE HANDLE, NEVER THE NAME. */}
            {handle}
          </span>
        }
        meta={
          user
            ? `Joined ${memberDate(user.createdAt)} · ${(user.sellerTier ?? 'NEW').toLowerCase().replace('_', ' ')}`
            : 'Loading the dossier…'
        }
        tags={
          user ? (
            <>
              {verification ? (
                <Tag kind={verification.kind} icon={verification.kind === 'ok' ? IconCheck : undefined}>
                  {verification.label}
                </Tag>
              ) : null}
              {standings.map((s) => (
                <Tag key={s.label} kind={s.kind}>
                  {s.label}
                </Tag>
              ))}
            </>
          ) : null
        }
        note={
          verification?.awaitingDecision
            ? 'Approving lets this member sell and be paid. Both decisions message the member and record your reason.'
            : 'Only a verification that is awaiting review can be decided here. A ban leaves their listings up — cancel those separately.'
        }
        footer={
          user ? (
            <>
              {user.isBanned ? (
                <Button variant="secondary" onClick={() => setAction('unban')}>
                  Unban…
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setAction('ban')}>
                  Ban…
                </Button>
              )}
              <span style={{ flex: 1 }} />
              {verification?.awaitingDecision ? (
                <>
                  <Button variant="danger" onClick={() => setAction('reject')}>
                    Reject…
                  </Button>
                  <Button variant="primary" icon={IconCheck} onClick={() => setAction('approve')}>
                    Approve selling
                  </Button>
                </>
              ) : null}
            </>
          ) : null
        }
      >
        {/* ⚠️ ABOVE THE LOADING BRANCHES, DELIBERATELY. A decision bumps the
            reload key, so the dossier goes back to a skeleton for the length
            of the refetch — and inside that branch the one sentence saying the
            ban landed would blink out, or vanish for good if the refetch then
            failed. The operator would have no way to know whether to do it
            again. */}
        {outcome ? (
          <div style={{ padding: '16px 20px 0' }}>
            <ResultBlock ok={outcome.ok} tag={outcome.tag} body={outcome.body} />
          </div>
        ) : null}

        {loadError ? (
          <div style={{ padding: 20 }}>
            <FailedRegion
              title="Couldn't load this member"
              detail={loadError}
              onRetry={() => setReloadKey((k) => k + 1)}
              scopeNote="the board behind is unaffected"
            />
          </div>
        ) : !dossier || !user ? (
          <div style={{ padding: 20 }}>
            <SkeletonPile count={2} />
          </div>
        ) : (
          <>
            <Section label="Identity and standing">
              <Kv k="Handle" v={handle} />
              <Kv k="Member id" v={user.id} />
              <Kv k="Joined" v={memberDate(user.createdAt)} />
              <Kv k="Seller tier" v={user.sellerTier ?? 'NEW'} />
              <Kv k="Trust score" v={`${user.trustScore} / 100`} />
              <Kv
                k="Rating"
                v={user.averageRating !== null ? `${user.averageRating.toFixed(1)} / 5` : '—'}
              />
              <Kv k="Seller profile completed" v={memberDate(user.profileCompletedAt)} />
              <Kv
                k="Account"
                v={
                  user.accountClosedAt
                    ? `Closed ${memberDate(user.accountClosedAt)}`
                    : user.isBanned
                      ? `Banned ${memberDate(user.bannedAt)}`
                      : 'Active'
                }
                tone={user.isBanned ? 'bad' : user.accountClosedAt ? 'unknown' : 'ok'}
                last
              />

              {dossier.closure ? (
                <Callout tone="neutral" icon={IconInfo}>
                  {/* ⚠️ Closing is not misconduct. The wording keeps the two
                      apart on the one screen where they could be confused. */}
                  Closed by {dossier.closure.closedBy.toLowerCase()} on{' '}
                  {memberDate(dossier.closure.closedAt)} — “{dossier.closure.reason}”.
                  {dossier.closure.wasBanned ? ' They were banned at the time.' : ''} Their
                  transactions, ratings and complaints stay attached to this row.
                </Callout>
              ) : null}

              <IdentityBlock
                dossier={dossier}
                shown={identityShown}
                onShow={() => setIdentityShown(true)}
                onHide={() => setIdentityShown(false)}
              />
            </Section>

            <Section label="Verification">
              <Kv k="Status" v={user.kycStatus} tone={toneOf(verification?.kind)} />
              <Kv k="Pipeline" v={user.kycMethod ?? 'VERIFYNOW'} />
              {user.kycTier ? <Kv k="Scan tier" v={user.kycTier} /> : null}
              <Kv k="Required at" v={memberDateTime(user.kycRequiredAt)} />
              <Kv k="Attempts" v={String(user.kycAttempts)} />
              {/* ⚠️ NOT × 100. The score is stored 0–100; see faceMatchPercent,
                  which holds the scale and is asserted by the spec. */}
              <Kv k="Face match" v={faceMatchPercent(user.kycFaceMatchScore)} />
              <Kv k="Verified at" v={memberDateTime(user.kycVerifiedAt)} />
              {user.kycReviewedAt ? (
                <>
                  <Kv k="Decided by a human" v={memberDateTime(user.kycReviewedAt)} />
                  <Kv k="Their note" v={user.kycReviewNote ?? '—'} mono={false} last />
                </>
              ) : null}

              <FindingsBlock user={user} />

              <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Label>Identity documents</Label>
                <DocumentReveal
                  which="id"
                  title="ID document"
                  user={user}
                  doc={docs.id}
                  busy={docBusy === 'id'}
                  error={docError.id}
                  onReveal={() => void reveal('id')}
                  onHide={() => hide('id')}
                />
                <DocumentReveal
                  which="selfie"
                  title="Selfie"
                  user={user}
                  doc={docs.selfie}
                  busy={docBusy === 'selfie'}
                  error={docError.selfie}
                  onReveal={() => void reveal('selfie')}
                  onHide={() => hide('selfie')}
                />
              </div>
            </Section>

            <Section label="Selling activity">
              <Kv k="Listings" v={user._count.listings.toLocaleString('en-ZA')} />
              <Kv k="Sales made" v={user._count.sellerTransactions.toLocaleString('en-ZA')} />
              <Kv k="Purchases" v={user._count.buyerTransactions.toLocaleString('en-ZA')} />
              <Kv k="Offers placed" v={user._count.offersPlaced.toLocaleString('en-ZA')} last />

              {dossier.listings.length > 0 ? (
                <MiniList
                  caption={`Newest ${Math.min(5, dossier.listings.length)} of ${user._count.listings} listings`}
                  rows={dossier.listings.slice(0, 5).map((l) => ({
                    key: l.id,
                    primary: l.title,
                    secondary: `${l.listingType} · ${l.status.toLowerCase().replace(/_/g, ' ')}`,
                    trailing: l.price !== null ? formatRand(l.price) : '—',
                  }))}
                />
              ) : null}

              {dossier.sellerTransactions.length > 0 ? (
                <MiniList
                  // ⚠️ THE CAPTION NAMES THE FIGURE. The trailing number is
                  // Transaction.sellerPayout as the server stored it — what
                  // this seller received, not what the buyer paid. Under a bare
                  // "Most recent sales" it reads as the sale price, and the two
                  // differ by the fees. Nothing here re-derives either: fee
                  // lines belong to payments/fee-presentation.ts, server-side.
                  caption="Most recent sales · what they were paid"
                  rows={dossier.sellerTransactions.slice(0, 3).map((t) => ({
                    key: t.id,
                    primary: t.listing?.title ?? 'Sale',
                    secondary: `${t.paymentStatus.toLowerCase().replace(/_/g, ' ')} · ${memberDate(t.createdAt)}`,
                    trailing: formatRand(t.sellerPayout),
                  }))}
                />
              ) : null}
            </Section>

            <PayoutSection
              dossier={dossier}
              identityShown={identityShown}
              onRerun={() => setAction('bank')}
            />

            <StrikesSection dossier={dossier} onClearStrikes={() => setAction('strikes')} />

            {/* ⚠️ IT USES THE DRAWER'S OWN `run`, NOT ITS OWN RESULT HANDLING.
                That function already carries the one-press guard, the reload
                bump, the onChanged callback and — most importantly — the rule
                that a REFUSAL is printed verbatim, because the backend's guards
                speak in full sentences and rewriting one as "something went
                wrong" costs a support call. A second implementation beside it
                would drift from all four. */}
            <AccountAdmin user={user} handle={handle} busy={busy} run={run} />

            <Section label="Admin history" last>
              {dossier.auditEvents.length === 0 ? (
                <Quiet>Nothing has been done to this account from the admin side.</Quiet>
              ) : (
                <Timeline
                  steps={dossier.auditEvents.slice(0, 8).map((e) => ({
                    title: humaniseAction(e.action),
                    sub: [
                      memberDateTime(e.createdAt),
                      e.adminUser?.email ?? 'system',
                      e.reason ?? undefined,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    state: /BAN|REJECT/.test(e.action) && !/UNBAN/.test(e.action) ? 'bad' : 'done',
                  }))}
                />
              )}
            </Section>
          </>
        )}
      </Drawer>

      {/* ── The confirms. Each one restates who it hits, by handle. ── */}
      {user ? (
        <>
          <ReasonConfirm
            open={action === 'approve'}
            label="Verification · confirm"
            title={`Approve ${handle} to sell`}
            lines={[
              ['Member', handle],
              ['Then', 'They can list, sell and be paid out'],
              ['They get', 'An SMS and an email saying they are verified'],
            ]}
            options={KYC_APPROVE_REASONS}
            noteHint="Recorded on the audit trail and on their verification record. The member does not see it."
            confirmLabel="Approve selling"
            tone="primary"
            busy={busy}
            onCancel={() => setAction(null)}
            onConfirm={(reason) =>
              void run(
                'KYC APPROVED',
                `${handle} can now list, sell and be paid. They have been messaged.`,
                () => reviewMemberKyc(user.id, 'APPROVE', reason),
              )
            }
          />

          <ReasonConfirm
            open={action === 'reject'}
            label="Verification · reason"
            title={`Reject ${handle}'s verification`}
            lines={[
              ['Member', handle],
              ['Then', 'They stay unverified and cannot be paid out'],
              ['They get', '“We could not verify your identity” — never your reason'],
            ]}
            options={KYC_REJECT_REASONS}
            noteHint="Recorded on the audit trail. The member is told to contact support, not what you chose."
            confirmLabel="Reject verification"
            tone="danger"
            busy={busy}
            onCancel={() => setAction(null)}
            onConfirm={(reason) =>
              void run(
                'KYC REJECTED',
                `${handle} stays unverified and cannot be paid out. They have been told to contact support.`,
                () => reviewMemberKyc(user.id, 'REJECT', reason),
              )
            }
          />

          <ReasonConfirm
            open={action === 'ban'}
            label="Ban · reason"
            title={`Ban ${handle}`}
            lines={[
              ['Member', handle],
              ['Then', 'Every gate refuses them'],
              ['Not affected', 'Their listings stay up — cancel those separately'],
              ['Not the same as', 'Closing the account, which releases their handle'],
            ]}
            options={BAN_REASONS}
            noteHint="Written to the audit trail against this account."
            confirmLabel="Ban this member"
            tone="danger"
            busy={busy}
            onCancel={() => setAction(null)}
            onConfirm={(reason) => void run(
                'BANNED',
                `${handle} is banned. Their listings are still up — cancel those separately.`,
                () => setMemberBan(user.id, true, reason),
              )}
          />

          <ReasonConfirm
            open={action === 'unban'}
            label="Unban · reason"
            title={`Lift the ban on ${handle}`}
            lines={[
              ['Member', handle],
              ['Banned', memberDateTime(user.bannedAt)],
              ['Then', 'They can buy, list and sell again'],
            ]}
            options={UNBAN_REASONS}
            noteHint="Written to the audit trail against this account."
            confirmLabel="Lift the ban"
            tone="primary"
            busy={busy}
            onCancel={() => setAction(null)}
            onConfirm={(reason) => void run(
                'UNBANNED',
                `${handle} can buy, list and sell again.`,
                () => setMemberBan(user.id, false, reason),
              )}
          />

          <PlainConfirm
            open={action === 'bank'}
            label="Bank check · confirm"
            title={`Re-run the bank check on ${handle}`}
            lines={[
              ['Member', handle],
              ['Account', bankStanding(user).accountMasked ?? 'none on file'],
              // ⚠️ The consequence an operator gets wrong: this CLEARS the
              // current stamp before Peach answers, so a payable seller stops
              // being payable until the webhook lands.
              ['Right away', 'Their current bank stamp is cleared'],
              ['Then', 'Peach is asked again — a real, billed call'],
            ]}
            confirmLabel="Re-run the check"
            tone="primary"
            busy={busy}
            onCancel={() => setAction(null)}
            onConfirm={() => void run(
                'BANK CHECK REQUESTED',
                'Peach has been asked. Until it answers, this seller reads as unverified for payout.',
                () => rerunBankVerification(user.id),
              )}
          />

          <PlainConfirm
            open={action === 'strikes'}
            label="Strikes · confirm"
            title={`Clear ${handle}'s reject strikes`}
            lines={[
              ['Member', handle],
              ['Strikes now', String(user.sellerRejectStrikes)],
              ['Then', 'Strikes go to zero and any listing ban is lifted'],
              ['Also', 'Open strike alerts on this member are resolved'],
            ]}
            confirmLabel="Clear the strikes"
            tone="primary"
            busy={busy}
            onCancel={() => setAction(null)}
            onConfirm={() => void run(
                'STRIKES CLEARED',
                `${handle} is back to zero reject strikes and may list again.`,
                () => clearRejectStrikes(user.id),
              )}
          />
        </>
      ) : null}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Identity — the one deliberate reveal
 * ──────────────────────────────────────────────────────────────────────── */

function IdentityBlock({
  dossier,
  shown,
  onShow,
  onHide,
}: {
  dossier: MemberDossier;
  shown: boolean;
  onShow: () => void;
  onHide: () => void;
}) {
  const identity = identityOf(dossier);

  if (!shown) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginTop: 12,
          padding: '12px 14px',
          background: 'var(--dk-inset)',
          border: '1px solid var(--dk-line-2)',
          borderRadius: 'var(--dk-radius-control)',
        }}
      >
        <IconLock size={14} style={{ color: 'var(--dk-ink-3)', flex: 'none' }} />
        <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--dk-ink-3)', minWidth: 0 }}>
          Real name, contact details and date of birth are hidden. Show them for a decision that
          needs them.
        </span>
        <span style={{ flex: 1 }} />
        <Button variant="outline" onClick={onShow}>
          Show identity
        </Button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <Label>Identity</Label>
        <span style={{ flex: 1 }} />
        <Button variant="ghost" onClick={onHide}>
          Hide
        </Button>
      </div>
      <Kv k="Full name" v={identity.fullName ?? '—'} mono={false} />
      <Kv k="Date of birth" v={identity.dateOfBirth ?? '—'} />
      <Kv k="Email" v={identity.email ?? '—'} />
      <Kv
        k="Phone"
        v={identity.phone ? `${identity.phone}${identity.phoneVerified ? ' ✓' : ' (unverified)'}` : '—'}
        last
      />
      {identity.fromClosure ? (
        <Callout tone="neutral" icon={IconInfo}>
          From the closure record. The live account no longer holds these — they were released so
          the same person could register again, and this snapshot is the only remaining answer to
          “who was this”.
        </Callout>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The documents — a second, per-document reveal that costs a decryption call
 * ──────────────────────────────────────────────────────────────────────── */

function DocumentReveal({
  which,
  title,
  user,
  doc,
  busy,
  error,
  onReveal,
  onHide,
}: {
  which: KycDocumentKind;
  title: string;
  user: MemberDossier['user'];
  doc: RevealedDocument | null;
  busy: boolean;
  error: string | null;
  onReveal: () => void;
  onHide: () => void;
}) {
  const present = hasKycDocument(user, which);
  const legacy = legacyKycUrl(user, which);

  if (!present) {
    return (
      <Row>
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink-2)' }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>Not uploaded</span>
      </Row>
    );
  }

  return (
    <div
      style={{
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line-2)',
        borderRadius: 'var(--dk-radius-control)',
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
        <IconShield size={14} style={{ color: 'var(--dk-ink-3)', flex: 'none' }} />
        <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{title}</span>
        <span style={{ flex: 1 }} />
        {doc ? (
          <Button variant="ghost" onClick={onHide}>
            Hide
          </Button>
        ) : (
          <Button variant="outline" loading={busy} onClick={onReveal}>
            Reveal
          </Button>
        )}
      </div>

      {doc ? (
        <div style={{ padding: '0 12px 12px' }}>
          {doc.isImage ? (
            // alt says WHAT it is, never WHOSE it is — an alt string ends up
            // read aloud, copied into a bug report and indexed by the browser.
            <img
              src={doc.objectUrl}
              alt={title}
              style={{
                display: 'block',
                width: '100%',
                borderRadius: 8,
                border: '1px solid var(--dk-line)',
              }}
            />
          ) : (
            // Kept INSIDE the drawer rather than opened in a tab: a new tab
            // outlives the drawer and its revoke, and a decrypted ID sitting
            // in a background tab is the thing we are trying not to do.
            <object
              data={doc.objectUrl}
              type={doc.mimeType}
              aria-label={title}
              style={{
                display: 'block',
                width: '100%',
                height: 420,
                borderRadius: 8,
                border: '1px solid var(--dk-line)',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>
                This browser will not display a {doc.mimeType} inline.
              </span>
            </object>
          )}
        </div>
      ) : null}

      {error ? (
        <div style={{ padding: '0 12px 12px' }}>
          <ResultBlock ok={false} tag="COULD NOT OPEN" body={error} />
          {legacy ? (
            <div style={{ marginTop: 10 }}>
              <Callout tone="warn" icon={IconAlert}>
                {/* ⚠️ These links pre-date the encrypted store and have NO
                    access control — anybody holding one can fetch a South
                    African identity document with no login and no audit
                    trail. Offered only here, only after the authenticated
                    read failed, because an unmigrated row is otherwise a
                    member who can never be verified. */}
                There is still an old copy on the public CDN. That link has no access control and
                no audit trail — open it only if this decision cannot wait for the file to be
                migrated.
              </Callout>
              <div style={{ marginTop: 8 }}>
                <a
                  href={legacy}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: 'var(--dk-warn)',
                    textDecoration: 'underline',
                  }}
                >
                  Open the unprotected copy
                  <IconExternal size={12} />
                </a>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The automated verdict — the evidence the decision rests on
 * ──────────────────────────────────────────────────────────────────────── */

function FindingsBlock({ user }: { user: MemberDossier['user'] }) {
  const f = readFindings(user.kycClaudeFindings);
  if (!f) return null;

  return (
    <div
      style={{
        marginTop: 14,
        padding: '12px 14px',
        background: 'var(--dk-surface)',
        border: '1px solid var(--dk-line)',
        borderRadius: 'var(--dk-radius-control)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Label>Automated findings</Label>
        {f.mode ? <Tag kind="neutral">{f.mode}</Tag> : null}
        {f.scanFailed ? <Tag kind="bad">Scan failed</Tag> : null}
      </div>

      {f.scores.map((s, i) => (
        <Kv
          key={s.label}
          k={s.label}
          v={s.value === null ? '—' : `${s.value}%`}
          tone={toneOf(scoreKind(s.value))}
          last={i === f.scores.length - 1}
        />
      ))}

      {f.recommendation ? (
        <p style={{ margin: '10px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>
          <strong style={{ color: 'var(--dk-ink)' }}>Model says {f.recommendation}</strong>
          {f.recommendationReason ? ` — ${f.recommendationReason}` : ''}
        </p>
      ) : null}

      {f.hardFails.length > 0 ? (
        <Callout tone="bad" icon={IconAlert}>
          Cross-check hard fails: {f.hardFails.join(', ')}
        </Callout>
      ) : null}
      {f.softFails.length > 0 ? (
        <Callout tone="warn" icon={IconAlert}>
          Cross-check soft fails: {f.softFails.join(', ')}
        </Callout>
      ) : null}
      {f.issues.length > 0 ? (
        <Callout tone="warn" icon={IconAlert}>
          {f.issues.join('; ')}
        </Callout>
      ) : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Payouts
 * ──────────────────────────────────────────────────────────────────────── */

function PayoutSection({
  dossier,
  identityShown,
  onRerun,
}: {
  dossier: MemberDossier;
  identityShown: boolean;
  onRerun: () => void;
}) {
  const bank = bankStanding(dossier.user);

  return (
    <Section
      label="Payout standing"
      action={
        <Button variant="outline" icon={IconRefresh} onClick={onRerun}>
          Re-run bank check…
        </Button>
      }
    >
      {!bank.hasDetails ? (
        <Callout tone="warn" icon={IconBanknote}>
          No banking details on file. This seller cannot be paid until they finish their seller
          profile.
        </Callout>
      ) : (
        <>
          <Kv k="Bank" v={bank.bankName ?? '—'} />
          {/* ⚠️ The account holder is a real name, so it lives behind the same
              reveal as the rest of the identity — and comparing it against the
              member's name IS the check, which is why the hint says so. */}
          <Kv
            k="Account holder"
            v={identityShown ? (bank.accountHolder ?? '—') : 'Hidden — show identity to compare'}
            mono={false}
          />
          <Kv k="Account" v={bank.accountMasked ?? '—'} />
          {/* ⚠️ NOT "AVS verified". Bank-ownership review is manual until
              Peach BANV is live, and this is the one screen where claiming an
              automated check would decide whether money leaves. */}
          <Kv k="Bank details reviewed (manual)" v={memberDateTime(bank.reviewedAt)} />
          <Kv k="Last Peach check" v={bank.avs.label} tone={toneOf(bank.avs.kind)} last />
          {bank.awaitingPeach ? (
            <Callout tone="info" icon={IconInfo}>
              A check has been asked for and Peach has not answered yet. Until it does, this seller
              reads as unverified for payout.
            </Callout>
          ) : null}
        </>
      )}
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Strikes and bans
 * ──────────────────────────────────────────────────────────────────────── */

function StrikesSection({
  dossier,
  onClearStrikes,
}: {
  dossier: MemberDossier;
  onClearStrikes: () => void;
}) {
  const user = dossier.user;
  const rows = strikeRows(user);
  const clearable = user.sellerRejectStrikes > 0 || Boolean(user.sellingBannedAt);
  const openAlerts = dossier.systemAlerts.filter((a) => !a.resolved);

  return (
    <Section
      label="Strikes and bans"
      action={
        clearable ? (
          <Button variant="outline" onClick={onClearStrikes}>
            Clear reject strikes…
          </Button>
        ) : undefined
      }
    >
      {rows.map((r) => (
        <Kv
          key={r.label}
          k={
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
              <span>{r.label}</span>
              {/* The CONSEQUENCE of a strike — what the member actually loses.
                  It was the faintest text in the drawer at 2.8:1, below AA,
                  while the strike label above it was fully legible. ink-3 is
                  5.1:1 and is the Desk's floor for text that means something. */}
              <span style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>{r.consequence}</span>
            </span>
          }
          v={String(r.count)}
          tone={r.hit ? 'bad' : r.count > 0 ? 'warn' : undefined}
        />
      ))}
      <Kv
        k="Banned from listing"
        v={user.sellingBannedAt ? memberDate(user.sellingBannedAt) : 'No'}
        tone={user.sellingBannedAt ? 'bad' : undefined}
      />
      <Kv
        k="Complaints against their sales"
        v={String(dossier.complaintsAgainst.length)}
        tone={dossier.complaintsAgainst.length > 0 ? 'warn' : undefined}
      />
      <Kv k="Complaints they lodged" v={String(dossier.complaintsLodged.length)} />
      <Kv
        k="Open alerts"
        v={String(openAlerts.length)}
        tone={openAlerts.some((a) => a.urgent) ? 'bad' : openAlerts.length > 0 ? 'warn' : undefined}
        last
      />

      {dossier.complaintsAgainst.length > 0 ? (
        <MiniList
          caption="Most recent complaints against them"
          rows={dossier.complaintsAgainst.slice(0, 3).map((c) => ({
            key: c.id,
            primary: c.subject ?? c.category,
            secondary: `${c.status.toLowerCase().replace(/_/g, ' ')} · ${memberDate(c.createdAt)}`,
            trailing: c.referenceNumber ?? '',
          }))}
        />
      ) : null}
    </Section>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * The confirms
 * ──────────────────────────────────────────────────────────────────────── */

type ConfirmLine = [string, string];
type ConfirmTone = 'primary' | 'danger';

/**
 * ⚠️ THE REASON IS A TICKLIST, AND THE CONFIRM NAMES THE MEMBER BY HANDLE.
 * Every one of these writes an audit row that somebody reads back months
 * later — during an appeal, a complaint, or a police request — so a typed
 * sentence alone would leave a decision nobody can count and a member
 * identified by nothing.
 */
function ReasonConfirm({
  open,
  label,
  title,
  lines,
  options,
  noteHint,
  confirmLabel,
  tone,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  label: string;
  title: string;
  lines: ConfirmLine[];
  options: ReasonChoice[];
  noteHint: string;
  confirmLabel: string;
  tone: ConfirmTone;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [choice, setChoice] = React.useState('');
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (open) {
      setChoice('');
      setNote('');
    }
  }, [open]);

  if (!open) return null;

  return (
    <DialogFrame
      label={label}
      title={title}
      onClose={onCancel}
      assertive={tone === 'danger'}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone}
            // No reason, no action — the backend refuses it anyway, and a
            // control that says why beats one that is greyed out in silence.
            //
            // ⚠️ AND NOT WHILE ONE IS ALREADY IN FLIGHT. `loading` dims a
            // Button; it does not disable it. Left clickable across the
            // round-trip this is a second confirm button, and on a slow
            // network one rejection becomes two SMSes to the same member.
            disabled={busy || !choice}
            loading={busy}
            onClick={() => onConfirm(composeReason(choice, note))}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <ConfirmLines lines={lines} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {options.map((o) => (
          <RadioRow
            key={o.value}
            name="desk-member-reason"
            checked={choice === o.value}
            onChange={() => setChoice(o.value)}
            label={o.value}
            sub={o.consequence}
          />
        ))}
      </div>
      <Input placeholder="Anything to add?" value={note} onChange={(e) => setNote(e.target.value)} />
      <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{noteHint}</span>
    </DialogFrame>
  );
}

/**
 * A confirm with no reason field — for the two actions where the backend
 * writes its own audit reason and takes no body. It still restates the member
 * and the consequence, because that is the part an operator gets wrong.
 */
function PlainConfirm({
  open,
  label,
  title,
  lines,
  confirmLabel,
  tone,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  label: string;
  title: string;
  lines: ConfirmLine[];
  confirmLabel: string;
  tone: ConfirmTone;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <DialogFrame
      label={label}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          {/* ⚠️ DISABLED WHILE IT RUNS. `loading` only dims a Button, and the
              action behind this one is "Re-run the check": a second press is a
              second real, billed Peach BANV call and a second decryption of
              the member's SA ID. */}
          <Button variant={tone} disabled={busy} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <ConfirmLines lines={lines} />
    </DialogFrame>
  );
}

function ConfirmLines({ lines }: { lines: ConfirmLine[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {lines.map(([k, v], i) => (
        <Kv key={k} k={k} v={v} mono={false} last={i === lines.length - 1} />
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Small shared bits
 * ──────────────────────────────────────────────────────────────────────── */

function Avatar({ initials }: { initials: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        width: 28,
        height: 28,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
        background: 'var(--dk-inset)',
        border: '1px solid var(--dk-line-2)',
        fontSize: 10.5,
        fontWeight: 600,
        color: 'var(--dk-ink-2)',
      }}
    >
      {initials}
    </span>
  );
}

const CALLOUT_TONE: Record<'neutral' | 'ok' | 'warn' | 'bad' | 'info', { ink: string; line: string; wash: string }> = {
  neutral: { ink: 'var(--dk-ink-3)', line: 'var(--dk-line-2)', wash: 'var(--dk-inset)' },
  ok: { ink: 'var(--dk-ok)', line: 'var(--dk-ok-line)', wash: 'var(--dk-ok-wash)' },
  warn: { ink: 'var(--dk-warn)', line: 'var(--dk-warn-line)', wash: 'var(--dk-warn-wash)' },
  bad: { ink: 'var(--dk-bad)', line: 'var(--dk-bad-line)', wash: 'var(--dk-bad-wash)' },
  info: { ink: 'var(--dk-info)', line: 'var(--dk-info-line)', wash: 'var(--dk-info-wash)' },
};

function Callout({
  tone,
  icon: Icon,
  children,
}: {
  tone: keyof typeof CALLOUT_TONE;
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>;
  children: React.ReactNode;
}) {
  const t = CALLOUT_TONE[tone];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        marginTop: 10,
        padding: '10px 12px',
        background: t.wash,
        border: `1px solid ${t.line}`,
        borderRadius: 'var(--dk-radius-control)',
      }}
    >
      <Icon size={13} style={{ color: t.ink, flex: 'none', marginTop: 2 }} />
      <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>{children}</span>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0' }}>{children}</div>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 12, color: 'var(--dk-ink-3)' }}>{children}</span>;
}

function MiniList({
  caption,
  rows,
}: {
  caption: string;
  rows: { key: string; primary: string; secondary: string; trailing: string }[];
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <Label>{caption}</Label>
      <div style={{ marginTop: 8 }}>
        {rows.map((r, i) => (
          <div
            key={r.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '8px 0',
              borderBottom: i === rows.length - 1 ? undefined : '1px solid var(--dk-line)',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
              <span
                style={{
                  fontSize: 12.5,
                  color: 'var(--dk-ink)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.primary}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>{r.secondary}</span>
            </span>
            <span className="dk-mono" style={{ fontSize: 12, color: 'var(--dk-ink-2)', flex: 'none' }}>
              {r.trailing}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Kv speaks 'unknown' where the rest of the Desk says 'neutral'. */
function toneOf(kind: StandingKind | undefined): 'ok' | 'warn' | 'bad' | 'info' | 'unknown' | undefined {
  if (!kind) return undefined;
  return kind === 'neutral' ? 'unknown' : kind;
}

/** USER_KYC_REVIEW → "User kyc review". The audit action, said out loud. */
function humaniseAction(action: string): string {
  const words = action.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The writes the legacy per-row actions menu carried and the cutover dropped.
 *
 * 🚨 THIS WAS A STRAIGHT REMOVAL OF WORKING CAPABILITY, recorded in the map as
 * "the entire per-row actions menu, which was not recorded here at all".
 * Legacy rendered UserActions on every row of /admin/users AND on
 * /admin/users/[id]; the Desk carried three of its writes and lost the rest.
 *
 * ⚠️ THEY LIVE IN A SECTION, NOT THE FOOTER. The footer holds the decisions an
 * operator opened the drawer TO MAKE — approve, reject, ban. These are repairs
 * and administration, and putting them beside a verification decision would
 * make a stuck-state fix look like one.
 *
 * ⚠️ AND THE SECTION IS FOLDED BY DEFAULT. Four destructive-ish controls
 * standing open under every member is an invitation; opening it is a small
 * deliberate act, which is the right weight for what is inside.
 */
function AccountAdmin({
  user,
  handle,
  busy,
  run,
}: {
  user: MemberUser;
  handle: string;
  busy: boolean;
  run: (tag: string, done: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [open, setOpen] = React.useState(false);
  const [rename, setRename] = React.useState('');
  const [closing, setClosing] = React.useState(false);
  const [closeReason, setCloseReason] = React.useState('');

  return (
    <Section label="Account admin">
      {!open ? (
        <Button variant="ghost" onClick={() => setOpen(true)}>
          Change tier, status or handle…
        </Button>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Seller tier</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SELLER_TIERS.map((t) => (
                <Chip
                  key={t}
                  active={user.sellerTier === t}
                  onClick={() => {
                    if (user.sellerTier === t || busy) return;
                    void run(
                      'TIER CHANGED',
                      `${handle} is now ${t.replace(/_/g, ' ').toLowerCase()}.`,
                      () => setSellerTier(user.id, t),
                    );
                  }}
                >
                  {t.replace(/_/g, ' ').toLowerCase()}
                </Chip>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Verification status — direct</Label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {KYC_STATUSES.map((k) => (
                <Chip
                  key={k}
                  active={user.kycStatus === k}
                  onClick={() => {
                    if (user.kycStatus === k || busy) return;
                    void run(
                      'STATUS SET',
                      `${handle}'s verification status is now ${k
                        .replace(/_/g, ' ')
                        .toLowerCase()}. Nobody was messaged and no reviewer was recorded.`,
                      () => setKycStatusDirect(user.id, k),
                    );
                  }}
                >
                  {k.replace(/_/g, ' ').toLowerCase()}
                </Chip>
              ))}
            </div>
            {/* 🚨 THE MOST IMPORTANT SENTENCE IN THIS SECTION. Approve and
                Reject in the footer run the real path: they record the
                decision, message the member and leave a reviewer on the
                record. This writes the column and nothing else — which makes
                it the right tool for a stuck state and the wrong one for
                deciding a verification. Unsaid, it is simply the faster
                Approve button, and someone will use it as one. */}
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
              This writes the column and nothing else — nobody is messaged and no
              reviewer is recorded against it. To DECIDE a verification, use Approve
              or Reject at the foot of this drawer. Use this only to repair a status
              that is stuck.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Username</Label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Input
                value={rename}
                onChange={(e) => setRename(e.target.value)}
                placeholder={user.username ?? 'no username'}
                aria-label="New username"
              />
              <Button
                variant="secondary"
                disabled={busy || !usernameIsUsable(rename) || rename.trim() === user.username}
                onClick={() =>
                  void run('RENAMED', `${handle} is now ${rename.trim()}.`, () =>
                    setUsername(user.id, rename),
                  )
                }
              >
                Rename
              </Button>
            </div>
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
              {/* ⚠️ firstName AND lastName ARE DELIBERATELY NOT EDITABLE HERE
                  even though UpdateUserDto accepts them: they are the identity
                  fields the KYC decision was made against, and changing one
                  from this drawer would quietly break the link between a
                  verification and the person it verified. */}
              {`${USERNAME_MIN}–${USERNAME_MAX} characters. For an offensive or impersonating handle — the one thing about a member that appears on every public surface. Their real name is not editable from here; it is what the verification was decided against.`}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Label>Close this account</Label>
            {!closing ? (
              <div>
                <Button variant="danger" onClick={() => setClosing(true)}>
                  Close account…
                </Button>
              </div>
            ) : (
              <>
                {/* 🚨 NOT A BAN AND NOT A DELETE, AND THE OPERATOR HAS TO KNOW
                    BOTH. A ban keeps the profile and the listings up. This
                    takes them off the public side and RELEASES the handle,
                    email and phone back into the uniqueness namespace so the
                    person can register again — while every transaction, rating
                    and complaint stays attached to the row.
                    ⚠️ It is also the ONLY route by which a banned member can be
                    closed: the self-service button refuses a restricted
                    account, precisely so closing can never launder a ban. */}
                <Kv k="Not a ban" v="A ban keeps their profile and listings up" mono={false} />
                <Kv
                  k="Releases"
                  v="Their handle, email and phone — they can register again"
                  mono={false}
                />
                <Kv
                  k="Keeps"
                  v="Every transaction, rating and complaint stays on the record"
                  mono={false}
                  last
                />
                <Input
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder={`Why — at least ${CLOSE_MIN_REASON} characters, written onto the closure record`}
                  aria-label="Reason for closing"
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="ghost" onClick={() => setClosing(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy || closeReason.trim().length < CLOSE_MIN_REASON}
                    onClick={() =>
                      void run(
                        'CLOSED',
                        `${handle}'s account is closed. Their handle, email and phone are released; their history stays on the record.`,
                        () => closeMemberAccount(user.id, closeReason),
                      )
                    }
                  >
                    Close the account
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
