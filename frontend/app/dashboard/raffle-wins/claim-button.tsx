'use client';

import { useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';

const API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function ClaimButton({
  winnerId,
  prizeIsFirearm,
}: {
  winnerId: string;
  prizeIsFirearm?: boolean;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Firearm-prize attestation — the backend claimPrize requires these before
  // a firearm prize can be claimed (18+ / valid licence / dealer-transfer
  // consent). Non-firearm claims never touch this state.
  const [attested, setAttested] = useState(false);
  const [licenceRef, setLicenceRef] = useState('');

  const needsAttestation = !!prizeIsFirearm;
  const attestationReady =
    !needsAttestation || (attested && licenceRef.trim().length > 0);

  async function handleClaim() {
    if (!confirm('Confirm you wish to claim this prize?')) return;
    setSubmitting(true);
    setError('');
    try {
      const token = await getToken();
      const res = await fetch(
        `${API_URL}/raffles/wins/${winnerId}/claim`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            ...(needsAttestation ? { 'Content-Type': 'application/json' } : {}),
          },
          // Only send the attestation body for firearm prizes; the field names
          // match claimPrize's expected body ({ ageAndRulesAccepted, licenceRef }).
          ...(needsAttestation
            ? {
                body: JSON.stringify({
                  ageAndRulesAccepted: attested,
                  licenceRef: licenceRef.trim(),
                }),
              }
            : {}),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim');
      setSubmitting(false);
    }
  }

  return (
    <div>
      {needsAttestation && (
        <div className="mb-3 space-y-2">
          <label
            className="flex gap-2 items-start text-xs cursor-pointer"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
          >
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I am 18 or older, hold a valid firearm licence / competency, and
              accept that this firearm prize will be routed to me via a licensed
              dealer transfer.
            </span>
          </label>
          <input
            type="text"
            value={licenceRef}
            onChange={(e) => setLicenceRef(e.target.value)}
            placeholder="Firearm licence / competency reference"
            className="block w-full py-2 px-2.5 rounded-[6px] text-xs"
            style={{
              background: 'var(--bg-inset)',
              color: 'var(--text-primary)',
              border: '0.5px solid var(--border)',
            }}
          />
        </div>
      )}
      <button
        onClick={handleClaim}
        disabled={submitting || !attestationReady}
        className="block w-full py-2.5 rounded-[6px] text-sm font-medium"
        style={{
          background:
            submitting || !attestationReady ? 'var(--bg-inset)' : 'var(--red)',
          color:
            submitting || !attestationReady ? 'var(--text-tertiary)' : '#fff',
          border: 'none',
          cursor:
            submitting || !attestationReady ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Claiming…' : 'Claim my prize'}
      </button>
      {error && (
        <p className="text-xs mt-2" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
