'use client';

/**
 * THE DESK — who can get in, and the three writes that change it.
 *
 * 🚨 THIS IS THE DRAWER THAT MADE A DATABASE WRITE UNNECESSARY. After the
 * cutover deleted the legacy panel, the roster LISTED administrators and
 * carried no control on any row: `setAdminRole` and `deactivateAdmin` sat in
 * lib/desk-site.ts with no caller, and creating one had no call at all. So
 * removing a compromised administrator meant opening psql. That is the single
 * worst thing the cutover cost, and this closes it.
 *
 * ⚠️ THE SERVER OWNS EVERY RULE. Only a Full admin may write here; you cannot
 * change your own role, and you cannot deactivate yourself — all enforced in
 * AdminService against the database, not the JWT. Nothing below re-implements
 * any of that. A second copy of a permission rule is a second set of rules,
 * and the drifted one is the one nobody reads; when the server refuses, this
 * shows its words.
 *
 * ⚠️ DEACTIVATE CONFIRMS, AND IS STILL FAST. It is the emergency path — the
 * reason you are here at 2am is that somebody's access has to stop — so the
 * confirm restates who and what follows in one line and nothing else stands
 * between the operator and the act.
 */
import * as React from 'react';
import { Button, Input, Tag } from './primitives';
import { Drawer, Section } from './overlays';
import { IconUser, IconAlert } from './icons';
import {
  ADMIN_ROLE_LABEL,
  ADMIN_ROLE_NOTE,
  ASSIGNABLE_ROLES,
  createAdmin,
  deactivateAdmin,
  setAdminRole,
  stamp,
  type AdminAccount,
  type AdminRoleValue,
} from '@/lib/desk-site';

/** The server's message, or something honest when there isn't one. */
function describe(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'That did not go through.';
}

function RoleChoice({
  value,
  onChange,
  disabled,
}: {
  value: AdminRoleValue;
  onChange: (r: AdminRoleValue) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {ASSIGNABLE_ROLES.map((r) => {
        const on = value === r;
        return (
          <button
            key={r}
            type="button"
            disabled={disabled}
            onClick={() => onChange(r)}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              textAlign: 'left',
              padding: '10px 12px',
              borderRadius: 'var(--dk-radius-control)',
              border: `1px solid ${on ? 'var(--dk-ink-2)' : 'var(--dk-line-2)'}`,
              background: on ? 'var(--dk-inset)' : 'transparent',
              color: 'inherit',
              font: 'inherit',
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                aria-hidden
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  flex: 'none',
                  background: on ? 'var(--dk-ink)' : 'transparent',
                  border: `1px solid ${on ? 'var(--dk-ink)' : 'var(--dk-line-2)'}`,
                }}
              />
              <span style={{ fontSize: 13, fontWeight: 500 }}>{ADMIN_ROLE_LABEL[r]}</span>
            </span>
            {/* ⚠️ The monitoring note says this role is NOT yet restricted.
                See ADMIN_ROLE_NOTE — the schema admits the gate is unbuilt, so
                a label reading "read-only" would hand out full access under a
                safe-sounding name. */}
            <span
              style={{
                fontSize: 11.5,
                lineHeight: 1.45,
                paddingLeft: 18,
                color: r === 'MONITORING_ADMIN' ? 'var(--dk-warn)' : 'var(--dk-ink-3)',
              }}
            >
              {ADMIN_ROLE_NOTE[r]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface AdminsDrawerProps {
  open: boolean;
  onClose: () => void;
  admins: AdminAccount[] | null;
  /** Re-read the roster after a write — the server decides what changed. */
  onChanged: () => void;
}

export function AdminsDrawer({ open, onClose, admins, onChanged }: AdminsDrawerProps) {
  const [email, setEmail] = React.useState('');
  const [newRole, setNewRole] = React.useState<AdminRoleValue>('MONITORING_ADMIN');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [confirmOff, setConfirmOff] = React.useState<AdminAccount | null>(null);

  /** One place to run a write: it clears the last failure, marks what is in
   *  flight, and re-reads on success so the roster is the server's answer
   *  rather than an optimistic guess about a permission decision. */
  const run = React.useCallback(
    async (key: string, work: () => Promise<unknown>, after?: () => void) => {
      setBusy(key);
      setFailed(null);
      try {
        await work();
        after?.();
        onChanged();
      } catch (err) {
        setFailed(describe(err));
      } finally {
        setBusy(null);
      }
    },
    [onChanged],
  );

  const emailLooksUsable = /.+@.+\..+/.test(email.trim());

  return (
    <Drawer
      open={open}
      onClose={onClose}
      typeLabel="Admin accounts"
      icon={IconUser}
      title="Who can get in"
      meta="Add an administrator, change a role, or switch one off."
      note="Only a Full admin can write here. You cannot change your own role or switch yourself off — ask another Full admin."
    >
      {failed ? (
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
          {failed}
        </div>
      ) : null}

      {/* ── Add ─────────────────────────────────────────────────────── */}
      <Section label="Add an administrator">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="their account email"
            inputMode="email"
            aria-label="Email of the member to promote"
          />
          {/* The server looks this address up in the User table and refuses if
              it finds nothing, so say that here rather than letting a typo come
              back as a bare 400. */}
          <span style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
            They must already have an account — this promotes a member, it does not invite a stranger.
          </span>
          <RoleChoice value={newRole} onChange={setNewRole} disabled={busy !== null} />
          <div>
            <Button
              variant="primary"
              disabled={!emailLooksUsable || busy !== null}
              onClick={() =>
                void run('create', () => createAdmin(email.trim(), newRole), () => setEmail(''))
              }
            >
              {busy === 'create' ? 'Adding…' : `Add as ${ADMIN_ROLE_LABEL[newRole]}`}
            </Button>
          </div>
        </div>
      </Section>

      {/* ── The roster ──────────────────────────────────────────────── */}
      <Section label="Accounts" last>
        {!admins ? (
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>Loading…</span>
        ) : admins.length === 0 ? (
          <span style={{ fontSize: 12.5, color: 'var(--dk-ink-3)' }}>No admin accounts returned.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {admins.map((a) => {
              const inactive = a.isActive === false;
              const isEditing = editing === a.id;
              const isConfirming = confirmOff?.id === a.id;
              return (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    padding: '12px 0',
                    borderTop: '1px solid var(--dk-line)',
                    opacity: inactive ? 0.55 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--dk-ink)' }}>{a.email}</span>
                      {a.lastLoginAt ? (
                        <span style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>
                          last in {stamp(a.lastLoginAt)}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: 'var(--dk-ink-4)' }}>never signed in</span>
                      )}
                    </span>
                    <Tag kind={a.role === 'SUPERADMIN' ? 'info' : 'neutral'} icon={null}>
                      {ADMIN_ROLE_LABEL[a.role] ?? a.role}
                    </Tag>
                    {inactive ? <Tag kind="neutral">switched off</Tag> : null}
                  </div>

                  {!inactive && !isEditing && !isConfirming ? (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() => {
                          setFailed(null);
                          setEditing(a.id);
                        }}
                      >
                        Change role…
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy !== null}
                        onClick={() => {
                          setFailed(null);
                          setConfirmOff(a);
                        }}
                      >
                        Switch off…
                      </Button>
                    </div>
                  ) : null}

                  {isEditing ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* ⚠️ THE SELECTED ROW IS THEIR ROLE NOW, NOT THE ONE
                          THEY WOULD MOVE TO. Showing the opposite reads as a
                          statement of what they already are, and an operator
                          who trusts it demotes the wrong person. A legacy
                          ADMIN row selects Monitoring, matching the schema's
                          "treat as MONITORING_ADMIN going forward" — the
                          server still decides what the write means. */}
                      <RoleChoice
                        value={a.role === 'SUPERADMIN' ? 'SUPERADMIN' : 'MONITORING_ADMIN'}
                        onChange={(r) => {
                          // Picking the role they already hold is not a
                          // change; sending it would spend a write and an
                          // audit row saying nothing happened.
                          if (r === a.role) {
                            setEditing(null);
                            return;
                          }
                          void run(`role:${a.id}`, () => setAdminRole(a.id, r), () => setEditing(null));
                        }}
                        disabled={busy !== null}
                      />
                      <div>
                        <Button variant="ghost" disabled={busy !== null} onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {isConfirming ? (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        padding: '10px 12px',
                        borderRadius: 'var(--dk-radius-control)',
                        border: '1px solid var(--dk-bad-line)',
                        background: 'var(--dk-bad-wash)',
                      }}
                    >
                      <span
                        style={{
                          display: 'flex',
                          gap: 7,
                          fontSize: 12.5,
                          lineHeight: 1.45,
                          color: 'var(--dk-ink)',
                        }}
                      >
                        <IconAlert size={14} style={{ flex: 'none', marginTop: 1, color: 'var(--dk-bad)' }} />
                        <span>
                          Switch off <strong>{a.email}</strong>? They lose admin access immediately. Their
                          account and its audit trail stay.
                        </span>
                      </span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                          variant="danger"
                          disabled={busy !== null}
                          onClick={() =>
                            void run(`off:${a.id}`, () => deactivateAdmin(a.id), () => setConfirmOff(null))
                          }
                        >
                          {busy === `off:${a.id}` ? 'Switching off…' : 'Switch off'}
                        </Button>
                        <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmOff(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </Drawer>
  );
}
