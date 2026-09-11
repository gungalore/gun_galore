'use client';

/**
 * THE DESK — the operator's own account: the second factor, and the way out.
 *
 * 🚨 THERE WAS NO ACCOUNT SURFACE AT ALL, AND A GUARD ALREADY POINTED AT ONE.
 * AdminJwtGuard refuses a recovery-only session with "Enrol your authenticator
 * again under Account, then sign in with it" — over a Desk whose five tabs are
 * Desk, Ledger, People, Pulse and Site and whose tabs.tsx says in as many
 * words that there is nothing configurable about that list. So the instruction
 * named a place that did not exist, and `POST /admin/auth/totp/enrol` and
 * `/totp/confirm` shipped with no caller anywhere in the frontend.
 *
 * ⚠️ IT LIVES ON THE SHELL, NOT ON A BOARD, for the same reason the external
 * consoles do: every surface needs it and none of them owns it. A board-level
 * drawer would also be unreachable from a phone, where the header has no
 * avatar — and the phone had no sign-out at all before this.
 *
 * ⚠️ NO NEW `.dk-` CLASS ANYWHERE IN HERE. tokens.css sits at the cap of 19
 * that scripts/desk-guard.cjs enforces; a twentieth fails `npm run build`.
 * Everything below is inline style off --dk-* tokens, which is also what the
 * confirm blocks in admins-drawer.tsx do.
 */
import * as React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, Input, Tag } from './primitives';
import { Checkbox } from './forms';
import { Drawer, Section } from './overlays';
import { IconAlert, IconCheck, IconLock, IconShield } from './icons';
import { deskServerMessage, signOutOfDesk } from '@/lib/desk-auth';
import { useRecoveryOnly } from './recovery-notice';
import {
  beginTotpEnrolment,
  confirmTotpEnrolment,
  fetchDeskMe,
  groupSecret,
  type DeskAdminMe,
  type TotpEnrolment,
} from '@/lib/desk-account';

function describe(err: unknown): string {
  return (
    deskServerMessage(err) ??
    (err instanceof Error && err.message ? err.message : 'That did not go through.')
  );
}

/**
 * The ten codes, once.
 *
 * ⚠️ NO DOWNLOAD CONTROL, DELIBERATELY. The Desk is an installed PWA and an
 * `<a download>` is unreliable in standalone iOS — an affordance that does
 * nothing on the operator's own phone is worse than none, because they will
 * believe the file exists. Copy, and "write them down", are the honest pair.
 *
 * ⚠️ AND THE PANEL CANNOT BE DISMISSED BY ACCIDENT. The drawer's close is
 * blocked by the parent while `acknowledged` is false — Escape, the backdrop
 * and the ✕ all do nothing — because nothing on earth can show these codes a
 * second time. They are bcrypt-hashed the moment they are issued.
 */
function RecoveryCodes({
  codes,
  otherSessionsEnded,
  acknowledged,
  onAcknowledge,
  onDone,
}: {
  codes: string[];
  otherSessionsEnded: number;
  acknowledged: boolean;
  onAcknowledge: (next: boolean) => void;
  onDone: () => void;
}) {
  const [copied, setCopied] = React.useState<'no' | 'yes' | 'failed'>('no');

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied('yes');
    } catch {
      // Clipboard access is refused outright in some standalone webviews and
      // over plain http. Say so rather than showing a tick that lied — the
      // codes are on screen and can be typed out.
      setCopied('failed');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          gap: 7,
          padding: '10px 12px',
          borderRadius: 'var(--dk-radius-control)',
          border: '1px solid var(--dk-warn-line)',
          background: 'var(--dk-warn-wash)',
          fontSize: 12.5,
          lineHeight: 1.45,
          color: 'var(--dk-ink)',
        }}
      >
        <IconAlert size={14} style={{ flex: 'none', marginTop: 1, color: 'var(--dk-warn)' }} />
        <span>
          These ten codes are shown <strong>once</strong> and cannot be read again — not here, not
          by anyone with database access. Each one works a single time, and a session opened with
          one can read the Desk but change nothing. Write them down somewhere that is not the phone
          holding your authenticator.
        </span>
      </div>

      <div
        className="dk-mono"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 6,
          padding: '12px 14px',
          borderRadius: 'var(--dk-radius-control)',
          border: '1px solid var(--dk-line-2)',
          background: 'var(--dk-inset)',
          fontSize: 13,
          letterSpacing: '0.04em',
          color: 'var(--dk-ink)',
        }}
      >
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Button
          variant="secondary"
          icon={copied === 'yes' ? IconCheck : undefined}
          onClick={() => void copy()}
        >
          {copied === 'yes' ? 'Copied' : 'Copy all ten'}
        </Button>
        {copied === 'failed' ? (
          <span style={{ fontSize: 11.5, color: 'var(--dk-warn)' }}>
            This browser refused the clipboard. Type them out instead.
          </span>
        ) : null}
      </div>

      {otherSessionsEnded > 0 ? (
        <span style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
          {otherSessionsEnded === 1
            ? 'One other signed-in device was signed out.'
            : `${otherSessionsEnded} other signed-in devices were signed out.`}{' '}
          That is deliberate: a second factor is only worth having if the sessions that predate it
          end.
        </span>
      ) : null}

      <Checkbox
        checked={acknowledged}
        onChange={onAcknowledge}
        label="I have written these down somewhere safe."
      />

      <div>
        <Button variant="primary" disabled={!acknowledged} onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * The staged secret: a QR, and the same secret in letters.
 *
 * ⚠️ BOTH, ALWAYS, AND THE TYPED ONE IS NOT A LIBRARY FALLBACK. qrcode.react
 * is already a dependency (the scanner's phone hand-off uses it), so there is
 * no package to add. The reason the letters are there is that the Desk is a
 * near-black surface and a phone camera pointed at a dim screen at arm's
 * length fails often enough to matter.
 *
 * ⚠️ THE QR KEEPS ITS OWN DEFAULT COLOURS — black modules on white — AND IS
 * NOT TOKENISED. Two reasons, and neither is laziness. The guard forbids a raw
 * hex in this tree, so tokenising it would mean passing `var(--dk-ink)` into
 * an SVG presentation attribute; that is valid CSS but it is one browser
 * quirk away from resolving to nothing, and a QR whose fill fails is an
 * invisible QR on the one screen where the operator cannot work around it.
 * And a reader wants maximum contrast, which #000-on-#FFF is by definition.
 * The plate around it is `--dk-ink`, so the white square does not float on
 * near-black.
 */
function SecretPanel({
  enrolment,
  code,
  onCode,
  busy,
  onConfirm,
  onCancel,
}: {
  enrolment: TotpEnrolment;
  code: string;
  onCode: (v: string) => void;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>
        Scan this with Google Authenticator, 1Password, Authy — any TOTP app — then type the
        six-digit code it shows to prove it arrived.
      </span>

      <div
        style={{
          alignSelf: 'flex-start',
          padding: 14,
          borderRadius: 'var(--dk-radius-control)',
          background: 'var(--dk-ink)',
        }}
      >
        {/* qrcode.react renders role="img" with no name unless given a title —
            on the scanner's dialog that was an axe role-img-alt failure, and
            the same omission here would leave the centre of this panel
            nameless to a screen reader. */}
        <QRCodeSVG
          value={enrolment.otpauthUri}
          size={168}
          level="M"
          title="QR code that adds this Desk account to your authenticator app"
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)' }}>
          Or type this into the app by hand
        </span>
        <span
          className="dk-mono"
          style={{
            padding: '9px 12px',
            borderRadius: 'var(--dk-radius-control)',
            border: '1px solid var(--dk-line-2)',
            background: 'var(--dk-inset)',
            fontSize: 13,
            letterSpacing: '0.06em',
            wordBreak: 'break-all',
            color: 'var(--dk-ink)',
          }}
        >
          {groupSecret(enrolment.secret)}
        </span>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)' }}>
          The six-digit code your app is showing now
        </span>
        <Input
          value={code}
          onChange={(e) => onCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          disabled={busy}
          aria-label="Six-digit code from your authenticator app"
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          variant="primary"
          disabled={code.trim().length < 6 || busy}
          onClick={onConfirm}
        >
          {busy ? 'Checking…' : 'Confirm'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export interface AccountDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function AccountDrawer({ open, onClose }: AccountDrawerProps) {
  const [me, setMe] = React.useState<DeskAdminMe | null>(null);
  const [loadFailed, setLoadFailed] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [password, setPassword] = React.useState('');
  const [enrolment, setEnrolment] = React.useState<TotpEnrolment | null>(null);
  const [code, setCode] = React.useState('');
  const [codes, setCodes] = React.useState<{ list: string[]; othersEnded: number } | null>(null);
  const [acknowledged, setAcknowledged] = React.useState(false);

  // ⚠️ THE SUBSCRIBED READ, not a one-off call: a silent refresh can report
  // the session read-only while this drawer is open, and the sentence below is
  // the only place that says what to do about it.
  const recoveryOnly = useRecoveryOnly();

  // Read on open, and re-read after a confirm, so "Authenticator: on" is the
  // server's answer rather than this component's memory of its own success.
  const load = React.useCallback(() => {
    setLoadFailed(null);
    fetchDeskMe()
      .then(setMe)
      .catch((err) => setLoadFailed(describe(err)));
  }, []);

  React.useEffect(() => {
    if (!open) return;
    load();
  }, [open, load]);

  /**
   * ⚠️ THE DRAWER REFUSES TO CLOSE WHILE UNACKNOWLEDGED CODES ARE ON SCREEN.
   * Drawer wires Escape and a backdrop press straight to onClose, and the
   * recovery codes cannot be shown again by any route — so a reflexive Escape
   * would destroy the only copy that will ever exist. The tick box is the
   * deliberate act that releases it.
   */
  const guardedClose = React.useCallback(() => {
    if (codes && !acknowledged) return;
    setEnrolment(null);
    setCode('');
    setCodes(null);
    setAcknowledged(false);
    setPassword('');
    setFailed(null);
    onClose();
  }, [codes, acknowledged, onClose]);

  async function begin() {
    setBusy(true);
    setFailed(null);
    try {
      // The password is required ONLY when replacing a confirmed
      // authenticator; on a first enrolment there is no field to fill and an
      // empty string would fail validation rather than be ignored.
      const staged = await beginTotpEnrolment(me?.totpEnrolled ? password : undefined);
      setEnrolment(staged);
      setPassword('');
    } catch (err) {
      setFailed(describe(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setFailed(null);
    try {
      const result = await confirmTotpEnrolment(code.trim());
      setCodes({ list: result.recoveryCodes, othersEnded: result.otherSessionsEnded });
      setEnrolment(null);
      setCode('');
      load();
    } catch (err) {
      setFailed(describe(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={guardedClose}
      typeLabel="Your account"
      icon={IconShield}
      title="Your sign-in"
      meta={me ? me.email : 'Your own credentials — nobody else’s.'}
      note="Nothing on this screen touches another administrator. Adding or removing admins is on the Site board."
    >
      {loadFailed ? (
        <div
          role="alert"
          style={{
            margin: '12px 16px 0',
            padding: '10px 12px',
            borderRadius: 'var(--dk-radius-control)',
            border: '1px solid var(--dk-bad-line)',
            background: 'var(--dk-bad-wash)',
            color: 'var(--dk-bad)',
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        >
          {loadFailed}
        </div>
      ) : null}

      <Section label="This session">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>
              {me ? me.email : 'Reading…'}
            </span>
            {me ? (
              <Tag kind={me.role === 'SUPERADMIN' ? 'info' : 'neutral'} icon={null}>
                {me.role === 'SUPERADMIN' ? 'Full admin' : 'Read-only role'}
              </Tag>
            ) : null}
          </div>

          {recoveryOnly ? (
            <div
              style={{
                display: 'flex',
                gap: 7,
                padding: '10px 12px',
                borderRadius: 'var(--dk-radius-control)',
                border: '1px solid var(--dk-warn-line)',
                background: 'var(--dk-warn-wash)',
                fontSize: 12.5,
                lineHeight: 1.45,
                color: 'var(--dk-ink)',
              }}
            >
              <IconAlert size={14} style={{ flex: 'none', marginTop: 1, color: 'var(--dk-warn)' }} />
              <span>
                This session was opened without your authenticator, so it can read everything and
                change nothing — whatever your role says. Set up an authenticator below, then sign
                out and back in with it.
              </span>
            </div>
          ) : null}

          <div>
            {/* The only sign-out in the phone shell. See shell.tsx: the
                desktop avatar used to call signOutOfDesk() directly and the
                phone header had no route to it at all. */}
            <Button variant="secondary" icon={IconLock} onClick={signOutOfDesk}>
              Sign out of the Desk
            </Button>
          </div>
        </div>
      </Section>

      <Section label="Authenticator app" last>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {failed ? (
            <div
              role="alert"
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--dk-radius-control)',
                border: '1px solid var(--dk-bad-line)',
                background: 'var(--dk-bad-wash)',
                color: 'var(--dk-bad)',
                fontSize: 12.5,
                lineHeight: 1.45,
              }}
            >
              {failed}
            </div>
          ) : null}

          {codes ? (
            <RecoveryCodes
              codes={codes.list}
              otherSessionsEnded={codes.othersEnded}
              acknowledged={acknowledged}
              onAcknowledge={setAcknowledged}
              onDone={() => {
                setCodes(null);
                setAcknowledged(false);
              }}
            />
          ) : enrolment ? (
            <SecretPanel
              enrolment={enrolment}
              code={code}
              onCode={setCode}
              busy={busy}
              onConfirm={() => void confirm()}
              onCancel={() => {
                setEnrolment(null);
                setCode('');
              }}
            />
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag kind={me?.totpEnrolled ? 'ok' : 'warn'}>
                  {me?.totpEnrolled ? 'On' : 'Not set up'}
                </Tag>
                {me?.totpEnrolled ? (
                  <span style={{ fontSize: 11.5, color: 'var(--dk-ink-3)' }}>
                    {me.remainingRecoveryCodes} recovery{' '}
                    {me.remainingRecoveryCodes === 1 ? 'code' : 'codes'} left
                  </span>
                ) : null}
              </div>

              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--dk-ink-2)' }}>
                {me?.totpEnrolled
                  ? 'Setting up a new phone replaces the old one. The authenticator you are using now keeps working until the new one is confirmed.'
                  : 'A six-digit code from your phone, on top of your password. Confirming it also issues ten single-use recovery codes, shown once.'}
              </span>

              {me?.totpEnrolled ? (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)' }}>
                    Your current password
                  </span>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                    aria-label="Your current password"
                  />
                  {/* Not belt-and-braces: the own-account hatch deliberately
                      opens this route to a recovery-only session, so the
                      password is the only thing between a stolen access token
                      and a swapped second factor. */}
                  <span style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
                    Asked for only when replacing an authenticator that is already working.
                  </span>
                </label>
              ) : null}

              <div>
                <Button
                  variant="primary"
                  disabled={busy || (me?.totpEnrolled ? password.length === 0 : !me)}
                  onClick={() => void begin()}
                >
                  {busy
                    ? 'Starting…'
                    : me?.totpEnrolled
                      ? 'Set up a new phone'
                      : 'Set up an authenticator'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Section>
    </Drawer>
  );
}
