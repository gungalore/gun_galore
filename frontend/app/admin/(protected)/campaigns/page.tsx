'use client';

// /admin/campaigns — SMS marketing campaign keys + click attribution.
// Create a key per SMS blast; the outbound link is gungalore.co.za/?c=KEY.
// Arriving with an active key shows the welcome banner once per session; the
// hit count is per-blast click attribution.

import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '@/lib/admin-auth';

interface Campaign {
  id: string;
  key: string;
  name: string;
  headline: string | null;
  active: boolean;
  hits: number;
  lastHitAt: string | null;
  createdAt: string;
}

const SITE = 'https://gungalore.co.za';

export default function CampaignsPage() {
  const [rows, setRows] = useState<Campaign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch('/admin/campaigns')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const r = await adminFetch('/admin/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key.trim(),
          name: name.trim(),
          headline: headline.trim() || undefined,
        }),
      });
      const body = (await r.json().catch(() => null)) as { message?: string } | null;
      if (!r.ok) throw new Error(body?.message ?? 'Could not create campaign');
      setKey('');
      setName('');
      setHeadline('');
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(id: string) {
    setBusy(true);
    try {
      await adminFetch(`/admin/campaigns/${id}/toggle`, { method: 'POST' });
      load();
    } finally {
      setBusy(false);
    }
  }

  function copyLink(k: string) {
    const url = `${SITE}/?c=${k}`;
    void navigator.clipboard?.writeText(url);
    setCopied(k);
    window.setTimeout(() => setCopied((c) => (c === k ? null : c)), 1500);
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          SMS Campaigns
        </h1>
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Each campaign is a short key you put in an SMS link (<code>?c=KEY</code>). Arriving
          with an active key shows the welcome banner once per visitor; hits = banner
          impressions per blast. Plain visits never see the banner.
        </p>
      </div>

      {error && (
        <div className="rounded-[6px] px-4 py-3 text-sm" style={{ background: 'rgba(200,16,46,0.10)', color: 'var(--red)' }}>
          {error}
        </div>
      )}

      <div className="rounded-[8px] p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <p className="text-sm font-medium m-0" style={{ color: 'var(--text-primary)' }}>
          New campaign
        </p>
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Key (e.g. j26) — short, in the URL" style={inputStyle} />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Internal name" style={inputStyle} />
        </div>
        <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Custom banner headline (optional — blank uses the default)" style={{ ...inputStyle, width: '100%' }} />
        <button
          type="button"
          disabled={busy}
          onClick={() => void create()}
          className="text-sm px-4 py-2 rounded-[6px]"
          style={{ background: 'var(--red)', color: '#fff', opacity: busy ? 0.6 : 1 }}
        >
          Create campaign
        </button>
      </div>

      <div className="rounded-[8px] overflow-x-auto" style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-tertiary)', textAlign: 'left' }}>
              <th className="px-4 py-2 text-xs font-normal">Campaign</th>
              <th className="px-4 py-2 text-xs font-normal">SMS link</th>
              <th className="px-4 py-2 text-xs font-normal">Hits</th>
              <th className="px-4 py-2 text-xs font-normal">Status</th>
              <th className="px-4 py-2 text-xs font-normal">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((c) => (
              <tr key={c.id} style={{ borderTop: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}>
                <td className="px-4 py-2">
                  <span style={{ color: 'var(--text-primary)' }}>{c.name}</span>
                  {c.headline && (
                    <span className="block text-xs" style={{ color: 'var(--text-tertiary)' }}>&ldquo;{c.headline}&rdquo;</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <code style={{ color: 'var(--text-secondary)' }}>?c={c.key}</code>
                  <button
                    type="button"
                    onClick={() => copyLink(c.key)}
                    className="ml-2 text-xs px-2 py-0.5 rounded-[4px]"
                    style={{ background: 'var(--bg-inset)', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                  >
                    {copied === c.key ? 'Copied' : 'Copy link'}
                  </button>
                </td>
                <td className="px-4 py-2" style={{ color: 'var(--text-primary)' }}>{c.hits.toLocaleString('en-ZA')}</td>
                <td className="px-4 py-2">
                  <span style={{ color: c.active ? 'var(--red)' : 'var(--text-tertiary)' }}>
                    {c.active ? 'Active' : 'Off'}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void toggle(c.id)}
                    className="text-xs px-2 py-1 rounded-[4px]"
                    style={{ background: 'transparent', border: '0.5px solid var(--border)', color: 'var(--text-secondary)' }}
                  >
                    {c.active ? 'Turn off' : 'Turn on'}
                  </button>
                </td>
              </tr>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td className="px-4 py-4 text-sm" colSpan={5} style={{ color: 'var(--text-tertiary)' }}>
                  No campaigns yet — create one above, then put its link in your next SMS blast.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
