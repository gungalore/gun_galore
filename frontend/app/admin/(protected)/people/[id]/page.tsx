'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  EmptyState,
  Icon,
  NeonCard,
  Pill,
  SkeletonRows,
  type AdminTone,
} from '@/components/admin/admin-ui';
import { UserActions } from '@/components/admin/user-actions';
import { useAdminSession } from '@/components/admin/admin-session';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminFetch,
  adminFetchBlob,
  formatWhen,
  revealIdNumber,
  type AdminUserDossier,
  type AdminUserProfile,
} from '@/lib/admin-api';

const KYC_TONE: Record<string, AdminTone> = {
  VERIFIED: 'green',
  PENDING: 'amber',
  UNDER_REVIEW: 'purple',
  REJECTED: 'red',
  NONE: 'muted',
};

/**
 * THE FULL MEMBER PROFILE.
 *
 * ⚠️ THE FIRST SECTION IS A VERIFICATION CHECKLIST, AND THAT ORDER IS THE
 * POINT. The question an operator actually asks about a seller is "is this
 * person verified, and in what?" — not "what is their surname". Leading with
 * the checklist means the answer is the first thing on the screen, and the
 * supporting detail is underneath it for when something looks wrong.
 *
 * Read-only apart from the enforcement controls (shared with the People
 * drawer) and the ID-number reveal, which is deliberately a separate, audited
 * ask rather than a field on the page.
 */
export default function MemberProfilePage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { isGod } = useAdminSession();

  const dossier = useAdminPoll<AdminUserDossier>(
    () => adminFetch<AdminUserDossier>(`/admin/users/${id}/dossier`),
    60_000,
    [id],
  );

  const user: AdminUserProfile | null = dossier.data?.user ?? null;

  if (dossier.error && !user) {
    return (
      <NeonCard title="Member">
        <EmptyState icon="alert" title="Could not load this member" caption={dossier.error} />
        <Link href="/admin/people" className="adm-btn" data-tone="ghost" style={{ textDecoration: 'none' }}>
          Back to the roster
        </Link>
      </NeonCard>
    );
  }

  if (!user) {
    return (
      <NeonCard title="Member">
        <SkeletonRows rows={6} />
      </NeonCard>
    );
  }

  const handle = user.username ? `@${user.username}` : user.id.slice(0, 10);
  const realName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  const d = dossier.data;
  const counts = {
    listings: d?.listings?.length ?? 0,
    buys: d?.buyerTransactions?.length ?? 0,
    sales: d?.sellerTransactions?.length ?? 0,
    offers: d?.buyerOffers?.length ?? 0,
    bids: d?.bids?.length ?? 0,
    complaints: d?.complaintsAgainst?.length ?? 0,
    alerts: d?.systemAlerts?.length ?? 0,
  };

  return (
    <>
      <Link
        href="/admin/people"
        className="adm-sub"
        style={{ textDecoration: 'none', color: 'var(--adm-cyan)' }}
      >
        ‹ Back to members
      </Link>

      {/* ── Who this is ───────────────────────────────────────────── */}
      <NeonCard
        title={handle}
        action={
          <Pill tone={user.isBanned ? 'red' : KYC_TONE[user.kycStatus ?? 'NONE'] ?? 'muted'}>
            {user.isBanned
              ? 'BANNED'
              : user.accountClosedAt
                ? 'CLOSED'
                : (user.kycStatus ?? 'NONE')}
          </Pill>
        }
      >
        <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
          {realName || 'No name on record'}
        </p>
        <p className="adm-sub" style={{ margin: 0 }}>
          {user.email}
          {user.username ? ` · ${handle}` : ''}
        </p>
        <p className="adm-sub" style={{ margin: 0 }}>
          Joined {formatWhen(user.createdAt)} · last signed in{' '}
          {formatWhen(user.lastLoginAt)}
        </p>
      </NeonCard>

      {/* ── The checklist ─────────────────────────────────────────── */}
      <NeonCard
        tone="cyan"
        title="What is verified"
        action={
          <Pill tone={user.kycStatus === 'VERIFIED' ? 'green' : 'amber'}>
            {user.kycStatus ?? 'NONE'}
          </Pill>
        }
      >
        <Checklist
          rows={[
            {
              label: 'Email address',
              ok: !!user.emailVerifiedAt,
              detail: user.emailVerifiedAt
                ? `verified ${formatWhen(user.emailVerifiedAt)}`
                : 'not verified',
            },
            {
              label: 'Cellphone number',
              ok: !!user.phoneVerified,
              detail: user.phone
                ? user.phoneVerified
                  ? 'verified'
                  : 'number given, not verified'
                : 'no number on record',
            },
            {
              label: 'Profile complete',
              ok: !!user.profileCompletedAt,
              detail: user.profileCompletedAt
                ? formatWhen(user.profileCompletedAt)
                : 'name / phone / address / banking not submitted',
            },
            {
              label: 'Identity verification',
              ok: user.kycStatus === 'VERIFIED',
              detail: user.kycVerifiedAt
                ? `verified ${formatWhen(user.kycVerifiedAt)}${user.kycMethod ? ` · ${user.kycMethod}` : ''}${user.kycTier ? ` · ${user.kycTier}` : ''}`
                : `${user.kycStatus ?? 'NONE'} — not verified`,
            },
            {
              label: 'Bank account',
              ok: !!user.bankVerifiedAt,
              detail: user.bankAccountNumber
                ? user.bankVerifiedAt
                  ? `AVS ${user.bankAvsResult ?? 'matched'} · ${formatWhen(user.bankVerifiedAt)}`
                  : 'held, not verified (no BANV — checked by hand)'
                : 'no account on record',
            },
            {
              label: 'Allowed to sell',
              ok: !user.sellingBannedAt,
              detail: user.sellingBannedAt
                ? `listing suspended ${formatWhen(user.sellingBannedAt)} — ${user.sellerRejectStrikes ?? 0} reject strikes`
                : 'no selling ban',
            },
            {
              label: 'Account in good standing',
              ok: !user.isBanned && !user.accountClosedAt,
              detail: user.isBanned
                ? `banned ${formatWhen(user.bannedAt)}`
                : user.accountClosedAt
                  ? `closed by the member ${formatWhen(user.accountClosedAt)}`
                  : 'not banned, not closed',
            },
          ]}
        />
      </NeonCard>

      {/* ── Identity verification detail ──────────────────────────── */}
      <NeonCard title="Identity verification detail">
        <Row label="Status" value={user.kycStatus ?? 'NONE'} />
        <Row label="Pipeline" value={user.kycMethod ?? '—'} />
        <Row label="Tier" value={user.kycTier ?? '—'} />
        <Row label="Required since" value={formatWhen(user.kycRequiredAt)} />
        <Row label="ID lookup passed" value={formatWhen(user.kycIdVerifiedAt)} />
        <Row label="Verified" value={formatWhen(user.kycVerifiedAt)} />
        <Row
          label="Face match"
          value={
            user.kycFaceMatchScore != null
              ? `${Math.round(user.kycFaceMatchScore)}%${user.kycFaceMatchStatus ? ` · ${user.kycFaceMatchStatus}` : ''}`
              : '—'
          }
        />
        <Row label="Attempts" value={String(user.kycAttempts ?? 0)} />
        <Row label="Consent given" value={formatWhen(user.kycConsentGivenAt)} />
        <Row label="Reviewed" value={formatWhen(user.kycReviewedAt)} />
        {user.kycReviewNote ? (
          <Row label="Review note" value={user.kycReviewNote} />
        ) : null}

        <IdNumberReveal user={user} />
        <ImageReveal folderId={id} />

        {user.kycClaudeFindings ? (
          <details>
            <summary
              className="adm-sub"
              style={{ cursor: 'pointer', color: 'var(--adm-cyan)' }}
            >
              Automated findings (JSON)
            </summary>
            <pre
              className="adm-terminal"
              data-label="KYCFINDINGS"
              style={{ marginTop: 8 }}
            >
              {JSON.stringify(user.kycClaudeFindings, null, 2)}
            </pre>
          </details>
        ) : null}
      </NeonCard>

      {/* ── Contact & address ─────────────────────────────────────── */}
      <NeonCard title="Contact & address">
        <Row label="Email" value={user.email ?? '—'} />
        <Row label="Phone" value={user.phone ?? '—'} />
        <Row label="Date of birth" value={user.dateOfBirth ?? '—'} />
        <Row
          label="Address"
          value={[
            user.addrBuilding,
            user.addrStreet,
            user.addrAddress2,
            user.addrSuburb,
            user.addrCity,
            user.addrPostalCode,
            user.addrProvince,
          ]
            .filter(Boolean)
            .join(', ') || '—'}
        />
      </NeonCard>

      {/* ── Banking ───────────────────────────────────────────────── */}
      <NeonCard title="Banking">
        <Row label="Bank" value={user.bankName ?? '—'} />
        <Row label="Account holder" value={user.bankAccountHolder ?? '—'} />
        <Row label="Account number" value={user.bankAccountNumber ?? '—'} />
        <Row label="Branch code" value={user.bankBranchCode ?? '—'} />
        <Row label="Account type" value={user.bankAccountType ?? '—'} />
        <Row
          label="Verified"
          value={
            user.bankVerifiedAt
              ? `${formatWhen(user.bankVerifiedAt)}${user.bankAvsResult ? ` · ${user.bankAvsResult}` : ''}`
              : 'not verified — compare against the member’s documents by hand'
          }
        />
      </NeonCard>

      {/* ── Consent & comms ───────────────────────────────────────── */}
      <NeonCard title="Consent & preferences">
        <Row label="Terms accepted" value={formatWhen(user.termsAcceptedAt)} />
        <Row label="Privacy consent" value={formatWhen(user.privacyConsentAt)} />
        <Row label="18+ affirmed" value={formatWhen(user.ageAffirmedAt)} />
        <Row label="Marketing opt-in" value={formatWhen(user.marketingConsentAt)} />
        <Row
          label="Vault consent"
          value={
            user.documentVaultConsentWithdrawnAt
              ? `withdrawn ${formatWhen(user.documentVaultConsentWithdrawnAt)}`
              : user.documentVaultConsentAt
                ? `given ${formatWhen(user.documentVaultConsentAt)}${user.documentVaultConsentVersion ? ` (${user.documentVaultConsentVersion})` : ''}`
                : 'not asked / not given'
          }
        />
        <Row
          label="Channels"
          value={[
            user.notifyEmailEnabled ? 'email' : null,
            user.notifySmsEnabled ? 'sms' : null,
            user.notifyOffersEnabled ? 'offers' : null,
            user.notifyWhatsappEnabled ? 'whatsapp' : null,
          ]
            .filter(Boolean)
            .join(', ') || 'none'}
        />
        <Row label="Fallback channel" value={user.notifyFallbackChannel ?? '—'} />
      </NeonCard>

      {/* ── Selling & standing ────────────────────────────────────── */}
      <NeonCard title="Selling & standing">
        <Row label="Seller tier" value={user.sellerTier ?? '—'} />
        <Row label="Trust score" value={String(user.trustScore ?? 0)} />
        <Row
          label="Average rating"
          value={user.averageRating != null ? user.averageRating.toFixed(1) : '—'}
        />
        <Row label="Total sales" value={String(user.totalSales ?? 0)} />
        <Row label="Auction strikes" value={String(user.auctionStrikes ?? 0)} />
        <Row label="Dispatch strikes" value={String(user.dispatchStrikes ?? 0)} />
        <Row label="Reject strikes" value={String(user.sellerRejectStrikes ?? 0)} />
        <Row label="Selling banned" value={formatWhen(user.sellingBannedAt)} />
        <Row label="Failed logins" value={String(user.failedLoginCount ?? 0)} />
        <Row label="Locked until" value={formatWhen(user.lockedUntil)} />
      </NeonCard>

      {/* ── Activity ──────────────────────────────────────────────── */}
      <NeonCard title="Activity on record">
        <div className="adm-kpis">
          <Count label="Listings" value={counts.listings} />
          <Count label="Purchases" value={counts.buys} />
          <Count label="Sales" value={counts.sales} />
        </div>
        <div className="adm-kpis">
          <Count label="Offers" value={counts.offers} />
          <Count label="Bids" value={counts.bids} />
          <Count label="Complaints" value={counts.complaints} />
        </div>
        {counts.alerts > 0 ? (
          <p className="adm-sub" style={{ margin: 0 }}>
            {counts.alerts} system alert{counts.alerts === 1 ? '' : 's'} on this member.
          </p>
        ) : null}
      </NeonCard>

      {/* ── Enforcement (shared with the drawer) ──────────────────── */}
      <NeonCard title="Enforcement">
        <UserActions
          user={user}
          isGod={isGod}
          onChanged={() => dossier.refresh()}
        />
      </NeonCard>

      {/* ── Recent audit trail ────────────────────────────────────── */}
      <NeonCard title="Admin audit trail">
        {(d?.auditEvents ?? []).length === 0 ? (
          <EmptyState title="No admin actions recorded" />
        ) : (
          (d?.auditEvents ?? []).slice(0, 15).map((event, i) => (
            <div key={String(event.id ?? i)} className="adm-row" style={{ cursor: 'default' }}>
              <span className="adm-row-text">
                <span className="adm-row-title">{String(event.action ?? 'Action')}</span>
                <span className="adm-row-caption">
                  {String(event.reason ?? '')}
                </span>
              </span>
              <span className="adm-mono" style={{ fontSize: 10.5, color: 'var(--adm-ink-2)' }}>
                {formatWhen(event.createdAt as string | undefined)}
              </span>
            </div>
          ))
        )}
      </NeonCard>
    </>
  );
}

/* ── Small presentational pieces ─────────────────────────────────── */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="adm-spread" style={{ padding: '3px 0' }}>
      <span className="adm-sub">{label}</span>
      <span
        className="adm-mono"
        style={{ fontSize: 12, textAlign: 'right', maxWidth: '62%' }}
      >
        {value}
      </span>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="adm-kpi">
      <span className="adm-kpi-label">{label}</span>
      <span className="adm-kpi-value">{value}</span>
    </div>
  );
}

function Checklist({
  rows,
}: {
  rows: Array<{ label: string; ok: boolean; detail: string }>;
}) {
  return (
    <>
      {rows.map((row) => (
        <div key={row.label} className="adm-row" style={{ cursor: 'default' }}>
          <span className="adm-row-left">
            <span
              className="adm-icon"
              data-tone={row.ok ? 'green' : 'amber'}
              style={{ width: 30, height: 30 }}
            >
              <Icon name={row.ok ? 'check' : 'alert'} size={14} />
            </span>
            <span className="adm-row-text">
              <span className="adm-row-title">{row.label}</span>
              <span className="adm-row-caption">{row.detail}</span>
            </span>
          </span>
          <Pill tone={row.ok ? 'green' : 'amber'}>{row.ok ? 'YES' : 'NO'}</Pill>
        </div>
      ))}
    </>
  );
}

/**
 * The ID number, behind a deliberate press.
 *
 * ⚠️ EACH REVEAL IS AUDITED SERVER-SIDE. The number is withheld from the
 * dossier payload, so this button is the only way to see it and the audit log
 * is the only record of who did — which is why it is not simply printed on the
 * page like every other field.
 */
function IdNumberReveal({ user }: { user: AdminUserProfile }) {
  const [result, setResult] = useState<{ idNumber: string; masked: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user.hasIdNumber) {
    return <Row label="SA ID number" value="not on record" />;
  }

  return (
    <>
      <Row label="SA ID number" value={result ? result.idNumber : '•••••••••••••'} />
      {error ? (
        <p className="adm-sub" style={{ margin: 0, color: 'var(--adm-amber)' }}>
          {error}
        </p>
      ) : null}
      {!result ? (
        <button
          type="button"
          className="adm-btn"
          data-tone="ghost"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              setResult(await revealIdNumber(user.id));
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not reveal the ID number.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Revealing…' : 'Reveal ID number (audited)'}
        </button>
      ) : null}
    </>
  );
}

/**
 * The two verification images, straight from Didit.
 *
 * ⚠️ WE HOLD NO COPY — see the privacy policy. Each reveal re-requests the
 * decision, which mints a fresh short-lived link, and the bytes are streamed
 * through this authenticated route. That is why an old verification still
 * opens, and why nothing is written to disk on the way through.
 */
function ImageReveal({ folderId }: { folderId: string }) {
  const [images, setImages] = useState<{ id?: string; selfie?: string }>({});
  const [busy, setBusy] = useState<'id' | 'selfie' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  async function reveal(which: 'id' | 'selfie') {
    if (busy) return;
    setBusy(which);
    setError(null);
    try {
      const blob = await adminFetchBlob(`/admin/users/${folderId}/kyc-file/${which}`);
      const url = URL.createObjectURL(blob);
      urlsRef.current.push(url);
      setImages((prev) => ({ ...prev, [which]: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the image.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="adm-grid-2">
        <button
          type="button"
          className="adm-btn"
          data-tone="ghost"
          disabled={busy !== null || images.id !== undefined}
          onClick={() => void reveal('id')}
        >
          {busy === 'id' ? 'Loading…' : images.id ? 'ID shown' : 'Reveal ID image'}
        </button>
        <button
          type="button"
          className="adm-btn"
          data-tone="ghost"
          disabled={busy !== null || images.selfie !== undefined}
          onClick={() => void reveal('selfie')}
        >
          {busy === 'selfie' ? 'Loading…' : images.selfie ? 'Selfie shown' : 'Reveal selfie'}
        </button>
      </div>
      {error ? (
        <p className="adm-sub" style={{ margin: 0, color: 'var(--adm-amber)' }}>
          {error}
        </p>
      ) : null}
      {images.id ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={images.id}
          alt="Identity document"
          style={{ width: '100%', borderRadius: 12, border: '1px solid var(--adm-line)' }}
        />
      ) : null}
      {images.selfie ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={images.selfie}
          alt="Selfie"
          style={{ width: '100%', borderRadius: 12, border: '1px solid var(--adm-line)' }}
        />
      ) : null}
    </>
  );
}
