'use client';

// Broadcast comms — admin sends a one-off email or SMS to an
// individual / segment / all users. Two-step flow: pick audience +
// type body → preview recipient count → confirm (with typed-confirm
// gate on the all-users path).
//
// The page is client-side throughout because the audience preview is
// interactive (pick segment → fetch count → render); doing this with
// query params would force a full page reload per change.

import { useState } from 'react';
import { adminFetch } from '@/lib/admin-auth';

type Channel = 'email' | 'sms';
type Segment =
  | 'all-sellers'
  | 'all-active-sellers'
  | 'kyc-pending'
  | 'kyc-stalled'
  | 'all-buyers';
type AudienceKind = 'individual' | 'segment' | 'all-users';

const SEGMENT_LABEL: Record<Segment, string> = {
  'all-sellers': 'All sellers (≥1 listing in any status)',
  'all-active-sellers': 'Active sellers (≥1 ACTIVE listing)',
  'kyc-pending': 'KYC pending (not yet verified)',
  'kyc-stalled': 'KYC stalled (>24h, not verified)',
  'all-buyers': 'All buyers (≥1 purchase)',
};

export default function BroadcastPage() {
  const [channel, setChannel] = useState<Channel>('email');
  const [audienceKind, setAudienceKind] = useState<AudienceKind>('segment');
  const [segment, setSegment] = useState<Segment>('all-active-sellers');
  const [userId, setUserId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; skipped: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function buildAudience() {
    if (audienceKind === 'individual') return { kind: 'individual', userId };
    if (audienceKind === 'all-users') return { kind: 'all-users' };
    return { kind: 'segment', segment };
  }

  async function runPreview() {
    setPreviewBusy(true);
    setError(null);
    setPreviewCount(null);
    try {
      const res = await adminFetch(`/admin/broadcast/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audience: buildAudience(), channel }),
      });
      const data = (await res.json().catch(() => ({}))) as { count?: number; message?: string };
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setPreviewCount(data.count ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewBusy(false);
    }
  }

  async function executeSend() {
    setSending(true);
    setError(null);
    try {
      const res = await adminFetch(`/admin/broadcast/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audience: buildAudience(),
          channel,
          subject: subject.trim() || undefined,
          body: body.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        sent?: number;
        skipped?: number;
        total?: number;
        message?: string;
      };
      if (!res.ok) throw new Error(data.message ?? `Error ${res.status}`);
      setResult({
        sent: data.sent ?? 0,
        skipped: data.skipped ?? 0,
        total: data.total ?? 0,
      });
      setConfirmOpen(false);
      setBody('');
      setSubject('');
      setPreviewCount(null);
      setTypedConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  const isAllUsers = audienceKind === 'all-users';
  const canPreview =
    (audienceKind === 'individual' ? userId.trim().length > 0 : true) &&
    !previewBusy;
  const bodyOk = body.trim().length >= 5;
  const subjectOk = channel === 'sms' || subject.trim().length >= 3;
  const canSend =
    previewCount !== null &&
    previewCount > 0 &&
    bodyOk &&
    subjectOk &&
    !sending;
  const allUsersConfirmOk = !isAllUsers || typedConfirm.trim().toUpperCase() === 'CONFIRM';

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-inset)',
    border: '0.5px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 6,
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
  };

  return (
    <div>
      <div className="flex items-baseline justify-between flex-wrap gap-3 mb-3">
        <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
          Broadcast comms
        </h1>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          Email or SMS · capped at 5,000 recipients per send · audit logged
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LEFT — composition */}
        <div className="space-y-4">
          {/* Channel + audience */}
          <div
            className="rounded-[8px] p-4 space-y-3"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            <div>
              <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
                Channel
              </label>
              <div className="flex gap-2">
                {(['email', 'sms'] as Channel[]).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => {
                      setChannel(c);
                      setPreviewCount(null);
                    }}
                    className="px-3 py-1.5 rounded text-sm"
                    style={{
                      background: c === channel ? 'var(--red)' : 'var(--bg-inset)',
                      color: c === channel ? '#fff' : 'var(--text-secondary)',
                      border: '0.5px solid var(--border)',
                      cursor: 'pointer',
                      fontWeight: c === channel ? 500 : 400,
                    }}
                  >
                    {c.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
                Audience
              </label>
              <div className="flex gap-2 mb-2 flex-wrap">
                {(['segment', 'individual', 'all-users'] as AudienceKind[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => {
                      setAudienceKind(a);
                      setPreviewCount(null);
                    }}
                    className="px-3 py-1.5 rounded text-sm"
                    style={{
                      background: a === audienceKind ? 'var(--red)' : 'var(--bg-inset)',
                      color: a === audienceKind ? '#fff' : 'var(--text-secondary)',
                      border: '0.5px solid var(--border)',
                      cursor: 'pointer',
                      fontWeight: a === audienceKind ? 500 : 400,
                    }}
                  >
                    {a === 'segment' ? 'Segment' : a === 'individual' ? 'One user' : 'All users'}
                  </button>
                ))}
              </div>

              {audienceKind === 'segment' && (
                <select
                  value={segment}
                  onChange={(e) => {
                    setSegment(e.target.value as Segment);
                    setPreviewCount(null);
                  }}
                  style={inputStyle}
                >
                  {(Object.keys(SEGMENT_LABEL) as Segment[]).map((s) => (
                    <option key={s} value={s}>
                      {SEGMENT_LABEL[s]}
                    </option>
                  ))}
                </select>
              )}
              {audienceKind === 'individual' && (
                <input
                  type="text"
                  value={userId}
                  onChange={(e) => {
                    setUserId(e.target.value);
                    setPreviewCount(null);
                  }}
                  placeholder="User ID (look up via /admin/users)"
                  style={inputStyle}
                />
              )}
              {audienceKind === 'all-users' && (
                <div
                  className="px-3 py-2 rounded text-xs"
                  style={{
                    background: 'rgba(200,16,46,0.08)',
                    border: '0.5px solid var(--red)',
                    color: 'var(--red)',
                  }}
                >
                  ⚠ This sends to every non-banned user with a {channel === 'sms' ? 'verified phone' : 'valid email'}. Typed-confirm required.
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={runPreview}
              disabled={!canPreview}
              className="w-full py-2 rounded text-sm font-medium"
              style={{
                background: canPreview ? 'var(--bg-inset)' : 'var(--bg-inset)',
                color: canPreview ? 'var(--text-primary)' : 'var(--text-tertiary)',
                border: '0.5px solid var(--border)',
                cursor: canPreview ? 'pointer' : 'not-allowed',
              }}
            >
              {previewBusy
                ? 'Counting recipients…'
                : previewCount !== null
                  ? `↻ Re-count (was ${previewCount})`
                  : 'Preview recipient count'}
            </button>

            {previewCount !== null && (
              <p
                className="text-sm text-center"
                style={{
                  color: previewCount === 0 ? 'var(--text-tertiary)' : 'var(--text-primary)',
                  fontWeight: 500,
                }}
              >
                {previewCount === 0
                  ? '0 recipients match — pick a different audience.'
                  : `${previewCount.toLocaleString('en-ZA')} recipient${previewCount === 1 ? '' : 's'} will receive this ${channel}.`}
              </p>
            )}
          </div>

          {/* Subject + body */}
          <div
            className="rounded-[8px] p-4 space-y-3"
            style={{ background: 'var(--bg-card)', border: '0.5px solid var(--border)' }}
          >
            {channel === 'email' && (
              <div>
                <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
                  Subject
                </label>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Email subject (≥3 chars)"
                  style={inputStyle}
                />
              </div>
            )}
            <div>
              <label className="text-xs uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-tertiary)' }}>
                {channel === 'sms' ? 'SMS body (160 chars per segment)' : 'Email body (plain text — line breaks preserved)'}
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={channel === 'sms' ? 4 : 8}
                maxLength={channel === 'sms' ? 320 : 5000}
                placeholder="Hi @{username}, ..."
                style={{ ...inputStyle, resize: 'vertical' }}
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
                {body.length}
                {channel === 'sms' ? '/320' : '/5000'} chars
              </p>
            </div>
          </div>
        </div>

        {/* RIGHT — actions + last result */}
        <div className="space-y-4">
          <div
            className="rounded-[8px] p-4"
            style={{
              background: 'var(--bg-card)',
              border: `0.5px solid ${isAllUsers ? 'var(--red)' : 'var(--border)'}`,
            }}
          >
            <p
              className="text-sm font-medium mb-3"
              style={{ color: 'var(--text-primary)' }}
            >
              Ready to send?
            </p>
            <ul className="text-xs space-y-1 mb-4" style={{ color: 'var(--text-secondary)' }}>
              <li>
                ✓ Channel: <strong style={{ color: 'var(--text-primary)' }}>{channel.toUpperCase()}</strong>
              </li>
              <li>
                {previewCount !== null ? '✓' : '○'} Recipients:{' '}
                {previewCount !== null ? (
                  <strong style={{ color: 'var(--text-primary)' }}>{previewCount}</strong>
                ) : (
                  <span style={{ color: 'var(--text-tertiary)' }}>preview needed</span>
                )}
              </li>
              <li>
                {subjectOk ? '✓' : '○'} {channel === 'email' ? 'Subject (≥3)' : 'SMS: no subject'}
              </li>
              <li>
                {bodyOk ? '✓' : '○'} Body (≥5)
              </li>
            </ul>

            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={!canSend}
              className="w-full py-2.5 rounded text-sm font-medium"
              style={{
                background: canSend ? 'var(--red)' : 'var(--bg-inset)',
                color: canSend ? '#fff' : 'var(--text-tertiary)',
                border: 'none',
                cursor: canSend ? 'pointer' : 'not-allowed',
              }}
            >
              {previewCount !== null && previewCount > 0
                ? `Send to ${previewCount} recipient${previewCount === 1 ? '' : 's'}`
                : 'Send'}
            </button>

            {error && (
              <p className="text-xs mt-3" style={{ color: 'var(--red)' }}>
                {error}
              </p>
            )}
          </div>

          {result && (
            <div
              className="rounded-[8px] p-4"
              style={{
                background: 'rgba(34,197,94,0.08)',
                border: '0.5px solid #22c55e',
              }}
            >
              <p
                className="text-sm font-medium"
                style={{ color: '#22c55e' }}
              >
                ✓ Broadcast sent
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {result.sent} delivered · {result.skipped} skipped (missing contact) · {result.total} total recipients in audience
              </p>
            </div>
          )}
        </div>
      </div>

      {confirmOpen && (
        <div
          onClick={() => !sending && setConfirmOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.65)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 480,
              width: '100%',
              padding: 24,
              borderRadius: 10,
              background: 'var(--bg-card)',
              border: `0.5px solid ${isAllUsers ? 'var(--red)' : 'var(--border)'}`,
            }}
          >
            <p
              className="text-base mb-2"
              style={{ color: 'var(--text-primary)', fontWeight: 500 }}
            >
              Send {channel} to {previewCount} recipient{previewCount === 1 ? '' : 's'}?
            </p>
            <p
              className="text-sm mb-4"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}
            >
              Once sent, the message goes out immediately. You can't recall it.
              {isAllUsers && ' This is an ALL USERS broadcast — type CONFIRM to enable the send button.'}
            </p>

            {isAllUsers && (
              <div className="mb-4">
                <input
                  type="text"
                  value={typedConfirm}
                  onChange={(e) => setTypedConfirm(e.target.value)}
                  placeholder="Type CONFIRM to enable"
                  style={inputStyle}
                  autoFocus
                />
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={sending}
                className="flex-1 py-2 rounded text-sm"
                style={{
                  background: 'var(--bg-inset)',
                  color: 'var(--text-secondary)',
                  border: '0.5px solid var(--border)',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeSend}
                disabled={sending || !allUsersConfirmOk}
                className="flex-1 py-2 rounded text-sm font-medium"
                style={{
                  background: sending || !allUsersConfirmOk ? 'var(--bg-inset)' : 'var(--red)',
                  color: sending || !allUsersConfirmOk ? 'var(--text-tertiary)' : '#fff',
                  border: 'none',
                  cursor: sending || !allUsersConfirmOk ? 'not-allowed' : 'pointer',
                }}
              >
                {sending ? 'Sending…' : 'Send now'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
