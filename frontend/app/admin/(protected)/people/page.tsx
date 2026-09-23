'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ActionRow,
  EmptyState,
  NeonCard,
  Pill,
  SkeletonRows,
  type AdminTone,
} from '@/components/admin/admin-ui';
import { AdminDrawer } from '@/components/admin/admin-drawer';
import { UserActions } from '@/components/admin/user-actions';
import { useAdminSession } from '@/components/admin/admin-session';
import { useAdminPoll } from '@/lib/use-admin-poll';
import {
  adminFetch,
  adminFetchBlob,
  formatWhen,
  type AdminUserRow,
  type Paginated,
} from '@/lib/admin-api';

const FILTERS: Array<{ id: string; label: string; param?: string }> = [
  { id: 'all', label: 'All users' },
  { id: 'kyc-outstanding', label: 'KYC outstanding', param: 'kyc-outstanding' },
  { id: 'kyc-stalled', label: 'KYC stalled', param: 'kyc-stalled' },
  { id: 'dealers', label: 'Dealers', param: 'dealers' },
  { id: 'banned', label: 'Banned', param: 'banned' },
  { id: 'closed', label: 'Closed', param: 'closed' },
];

const KYC_TONE: Record<string, AdminTone> = {
  VERIFIED: 'green',
  PENDING: 'amber',
  UNDER_REVIEW: 'purple',
  REJECTED: 'red',
  NONE: 'muted',
};

export default function PeoplePage() {
  const { isGod } = useAdminSession();
  const [filter, setFilter] = useState(FILTERS[0]);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<AdminUserRow | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(search.trim()), 350);
    return () => window.clearTimeout(id);
  }, [search]);

  const users = useAdminPoll<Paginated<AdminUserRow>>(
    () =>
      adminFetch<Paginated<AdminUserRow>>(
        `/admin/users?page=${page}&limit=30${filter.param ? `&filter=${filter.param}` : ''}${
          debounced ? `&search=${encodeURIComponent(debounced)}` : ''
        }`,
      ),
    60_000,
    [filter.id, debounced, page],
  );

  const rows: AdminUserRow[] =
    (users.data?.users as AdminUserRow[] | undefined) ?? users.data?.rows ?? [];
  const total = (users.data?.total as number | undefined) ?? rows.length;


  return (
    <>
      <NeonCard
        title="Member & seller roster"
        action={<Pill tone="cyan">{total} MEMBERS</Pill>}
      >
        <input
          className="adm-input"
          placeholder="Search username, email or real name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </NeonCard>

      <div className="adm-scroll-x">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className="adm-chip"
            data-active={filter.id === f.id}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <NeonCard title="Members">
        {users.loading && !users.data ? (
          <SkeletonRows rows={6} />
        ) : users.error ? (
          <EmptyState icon="alert" title="Roster unavailable" caption={users.error} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No members match"
            caption="Try a different filter or clear the search."
          />
        ) : (
          rows.map((user) => {
            const handle = user.username
              ? `@${user.username}`
              : (user.email ?? user.id.slice(0, 8));
            const tone = user.isBanned
              ? 'red'
              : (KYC_TONE[user.kycStatus ?? 'NONE'] ?? 'muted');
            return (
              <ActionRow
                key={user.id}
                icon="users"
                tone={tone}
                title={
                  <>
                    {handle}
                    {user.sellerTier ? (
                      <span
                        className="adm-pill"
                        data-tone="muted"
                        style={{ marginLeft: 6 }}
                      >
                        {user.sellerTier}
                      </span>
                    ) : null}
                  </>
                }
                caption={`Joined ${formatWhen(user.createdAt)}`}
                trailing={
                  <Pill tone={tone}>
                    {user.isBanned ? 'BANNED' : (user.kycStatus ?? 'NONE')}
                  </Pill>
                }
                onClick={() => setOpen(user)}
              />
            );
          })
        )}
        {(users.data?.total ?? 0) > page * 30 ? (
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            onClick={() => setPage((p) => p + 1)}
          >
            Load more
          </button>
        ) : null}
      </NeonCard>

      {open ? (
        <UserDrawer
          user={open}
          isGod={isGod}
          onClose={() => setOpen(null)}
          onChanged={() => users.refresh()}
        />
      ) : null}
    </>
  );
}

function UserDrawer({
  user,
  isGod,
  onClose,
  onChanged,
}: {
  user: AdminUserRow;
  isGod: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [dossier, setDossier] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [dossierError, setDossierError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ id?: string; selfie?: string }>({});
  const [revealBusy, setRevealBusy] = useState<'id' | 'selfie' | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDossierError(null);
    adminFetch<Record<string, unknown>>(`/admin/users/${user.id}/dossier`)
      .then((data) => {
        if (!cancelled) {
          setDossier(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDossierError(err instanceof Error ? err.message : 'Dossier unavailable');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user.id]);

  // Blob URLs are memory the page owns; revoke them when the drawer goes.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  /**
   * ⚠️ A FAILED REVEAL MUST SAY SO. This used to swallow every error, so a
   * member with no stored document — the backend answers 404 "No stored file
   * for this user. It may still be on the old CDN" — got a button that did
   * nothing at all when tapped. Silence is indistinguishable from a broken
   * button, which is exactly how the operator reported it.
   */
  async function reveal(which: 'id' | 'selfie') {
    if (revealBusy) return;
    setRevealBusy(which);
    setRevealError(null);
    try {
      const blob = await adminFetchBlob(`/admin/users/${user.id}/kyc-file/${which}`);
      const url = URL.createObjectURL(blob);
      urlsRef.current.push(url);
      setRevealed((r) => ({ ...r, [which]: url }));
    } catch (err) {
      setRevealError(
        err instanceof Error
          ? err.message
          : `Could not load the ${which === 'id' ? 'identity document' : 'selfie'}.`,
      );
    } finally {
      setRevealBusy(null);
    }
  }

  const handle = user.username ? `@${user.username}` : user.id.slice(0, 10);
  const counts = {
    listings: Array.isArray(dossier?.listings) ? dossier.listings.length : null,
    transactions: Array.isArray(dossier?.transactions)
      ? dossier.transactions.length
      : null,
    offers: Array.isArray(dossier?.offers) ? dossier.offers.length : null,
  };

  return (
    <AdminDrawer
      open
      onClose={onClose}
      title={handle}
      subtitle={`${user.sellerTier ? `${user.sellerTier} · ` : ''}joined ${formatWhen(
        user.createdAt,
      )}`}
      badge={user.isBanned ? 'BANNED' : (user.kycStatus ?? 'NONE')}
      badgeTone={KYC_TONE[user.kycStatus ?? 'NONE'] ?? 'muted'}
    >
      {loading ? (
          <SkeletonRows rows={2} />
        ) : dossierError ? (
          <EmptyState
            icon="alert"
            title="Dossier unavailable"
            caption={dossierError}
          />
        ) : (
          <div className="adm-card" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="adm-spread">
              <span className="adm-sub">Listings on record</span>
              <span className="adm-mono">{counts.listings ?? '—'}</span>
            </div>
            <div className="adm-spread">
              <span className="adm-sub">Transactions on record</span>
              <span className="adm-mono">{counts.transactions ?? '—'}</span>
            </div>
            <div className="adm-spread">
              <span className="adm-sub">Offers on record</span>
              <span className="adm-mono">{counts.offers ?? '—'}</span>
            </div>
          </div>
        )}

        <div className="adm-label">Identity documents</div>
        <div className="adm-grid-2">
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            disabled={revealBusy !== null || revealed.id !== undefined}
            onClick={() => void reveal('id')}
          >
            {revealBusy === 'id' ? 'Loading…' : revealed.id ? 'Shown' : 'Reveal ID'}
          </button>
          <button
            type="button"
            className="adm-btn"
            data-tone="ghost"
            disabled={revealBusy !== null || revealed.selfie !== undefined}
            onClick={() => void reveal('selfie')}
          >
            {revealBusy === 'selfie'
              ? 'Loading…'
              : revealed.selfie
                ? 'Shown'
                : 'Reveal selfie'}
          </button>
        </div>
        {revealError ? (
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: 'var(--adm-amber)',
              lineHeight: 1.45,
            }}
            role="status"
          >
            {revealError}
          </p>
        ) : null}
        {revealed.id ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={revealed.id}
            alt="Identity document"
            style={{ width: '100%', borderRadius: 12, border: '1px solid var(--adm-line)' }}
          />
        ) : null}
        {revealed.selfie ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={revealed.selfie}
            alt="Selfie"
            style={{ width: '100%', borderRadius: 12, border: '1px solid var(--adm-line)' }}
          />
        ) : null}

        {/* Full profile — the deep view. The drawer is the quick look; this
            is everything, including the verification checklist and the ID
            number reveal (which is audited). */}
        <Link
          href={`/admin/people/${user.id}`}
          className="adm-btn"
          data-tone="cyan"
          style={{ textDecoration: 'none' }}
        >
          Open full profile
        </Link>

        <UserActions user={user} isGod={isGod} onChanged={onChanged} />
    </AdminDrawer>
  );
}
