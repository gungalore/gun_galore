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
 * 🚨 AND ALL THREE NOW COLLECT A REASON, BECAUSE ALL THREE NOW WRITE AN AUDIT
 * ROW. Until 2026-09-11 these were the only admin writes that recorded
 * nothing — there was no record anywhere that anybody had ever been made an
 * administrator. The DTOs make the reason required (3–500 characters), so a
 * client that sends none does not degrade, it 400s.
 *
 * ⚠️ THE SERVER OWNS EVERY RULE. Only a Full admin may write here; you cannot
 * change your own role, and you cannot deactivate yourself — all enforced in
 * AdminService against the database, not the JWT. Nothing below re-implements
 * any of that. A second copy of a permission rule is a second set of rules,
 * and the drifted one is the one nobody reads; when the server refuses, this
 * shows its words — really, now: see describe() below.
 *
 * ⚠️ DEACTIVATE CONFIRMS, AND IS STILL FAST. It is the emergency path — the
 * reason you are here at 2am is that somebody's access has to stop — so the
 * confirm restates who and what follows in one line, and asks for the one
 * sentence the audit row needs and nothing else.
 */
import * as React from 'react';
import { Button, Input, Tag } from './primitives';
import { Drawer, Section } from './overlays';
import { IconUser, IconAlert } from './icons';
import { deskServerMessage } from '@/lib/desk-auth';
import {
  ADMIN_REASON_MAX,
  ADMIN_REASON_MIN,
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

/**
 * The server's own sentence, or something honest when there isn't one.
 *
 * 🚨 THIS USED TO RENDER `err.message`, WHICH IS "400 Bad Request". The header
 * above has always claimed this drawer shows the server's words; it showed the
 * status line, because Nest puts the sentence in the JSON BODY. So every
 * refusal this surface exists to relay — "No All Outdoor account found for
 * …@…. Ask them to sign up first", "You cannot change your own role", and now
 * "Say why this account is being granted admin access." — arrived as three
 * words that name only the shape of the failure.
 */
function describe(err: unknown): string {
  return (
    deskServerMessage(err) ??
    (err instanceof Error && err.message ? err.message : 'That did not go through.')
  );
}

/**
 * The reason box.
 *
 * ⚠️ AN <input>, NOT A TEXTAREA, AND THAT IS A KIT LIMIT RATHER THAN A CHOICE:
 * the Desk kit has no Textarea, and adding one for three fields would be a new
 * control to style, trap focus in and keep in step with Input's error state.
 * The server accepts up to 500 characters and a single line holds a sentence,
 * which is what an audit row wants.
 *
 * ⚠️ maxLength MIRRORS THE SERVER'S CEILING so a long paste is trimmed while
 * it is being typed, rather than accepted and then refused. The FLOOR is not
 * mirrored as a silent block — the button says what it wants.
 */
function ReasonBox({
  value,
  onChange,
  disabled,
  label,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label: string;
  placeholder: string;
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{ fontSize: 11.5, color: 'var(--dk-ink-2)' }}>{label}</span>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={ADMIN_REASON_MAX}
        placeholder={placeholder}
      />
      <span style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--dk-ink-3)' }}>
        Goes into the audit trail as the only record of why. A sentence, not a word.
      </span>
    </label>
  );
}

/** The server's floor, armed on the button rather than enforced in silence. */
function reasonIsUsable(reason: string): boolean {
  return reason.trim().length >= ADMIN_REASON_MIN;
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
            {/* The monitoring note describes a tier AdminJwtGuard really does
                enforce — safe methods for any active admin, every mutating
                method SUPERADMIN-only, read off the AdminUser row per request.
                (This paragraph used to warn the opposite, that the gate was
                unbuilt; that was true until 2026-09-03 and has been false
                since. See ADMIN_ROLE_NOTE, which the spec pins.) */}
            <span
              style={{
                fontSize: 11.5,
                lineHeight: 1.45,
                paddingLeft: 18,
                color: 'var(--dk-ink-3)',
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
  const [createReason, setCreateReason] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  /**
   * ⚠️ THE ROLE CHANGE GAINED A CONFIRM STEP, AND IT HAD TO. The picker used
   * to fire the write straight out of its onChange — there was no screen
   * between the click and the request, so there was nowhere to put the reason
   * the server now demands. This holds the chosen role while the operator
   * types one. It doubles as the confirm that promoting to Full admin never
   * had.
   */
  const [confirmRole, setConfirmRole] = React.useState<{ id: string; role: AdminRoleValue } | null>(
    null,
  );
  const [roleReason, setRoleReason] = React.useState('');
  const [confirmOff, setConfirmOff] = React.useState<AdminAccount | null>(null);
  const [offReason, setOffReason] = React.useState('');

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
      note="Only a Full admin can write here. You cannot change your own role or switch yourself off — ask another Full admin. Every change below is recorded with the reason you give."
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
          <ReasonBox
            value={createReason}
            onChange={setCreateReason}
            disabled={busy !== null}
            label="Why this person gets admin access"
            placeholder="e.g. Taking over dealer verification while Gerhard is away"
          />
          <div>
            <Button
              variant="primary"
              disabled={!emailLooksUsable || !reasonIsUsable(createReason) || busy !== null}
              onClick={() =>
                void run(
                  'create',
                  () => createAdmin(email.trim(), newRole, createReason.trim()),
                  () => {
                    setEmail('');
                    setCreateReason('');
                  },
                )
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
              const pendingRole = confirmRole?.id === a.id ? confirmRole.role : null;
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
                        // Same field as the branch above ('last login'), which
                        // renders at ink-3 — so the SAME row was legible with a
                        // date and near-invisible without one.
                        <span style={{ fontSize: 11, color: 'var(--dk-ink-3)' }}>never signed in</span>
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
                          setConfirmRole(null);
                          setRoleReason('');
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
                          setOffReason('');
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
                          THEY WOULD MOVE TO — until they pick, at which point
                          it is the pending one, or the operator cannot see
                          what they are about to confirm. Showing their current
                          role while a confirm block below names a different
                          one is how the wrong person gets demoted. A legacy
                          ADMIN row selects Monitoring, matching the schema's
                          "treat as MONITORING_ADMIN going forward" — the
                          server still decides what the write means. */}
                      <RoleChoice
                        value={
                          pendingRole ?? (a.role === 'SUPERADMIN' ? 'SUPERADMIN' : 'MONITORING_ADMIN')
                        }
                        onChange={(r) => {
                          // Picking the role they already hold is not a
                          // change; sending it would spend a write and an
                          // audit row saying nothing happened.
                          if (r === a.role) {
                            setConfirmRole(null);
                            setEditing(null);
                            return;
                          }
                          setFailed(null);
                          setRoleReason('');
                          setConfirmRole({ id: a.id, role: r });
                        }}
                        disabled={busy !== null}
                      />

                      {pendingRole ? (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 10,
                            padding: '10px 12px',
                            borderRadius: 'var(--dk-radius-control)',
                            border: '1px solid var(--dk-warn-line)',
                            background: 'var(--dk-warn-wash)',
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
                            <IconAlert
                              size={14}
                              style={{ flex: 'none', marginTop: 1, color: 'var(--dk-warn)' }}
                            />
                            <span>
                              Make <strong>{a.email}</strong> a{' '}
                              <strong>{ADMIN_ROLE_LABEL[pendingRole]}</strong>? It takes effect on
                              their next request, including if they are signed in now.
                            </span>
                          </span>
                          <ReasonBox
                            value={roleReason}
                            onChange={setRoleReason}
                            disabled={busy !== null}
                            label="Why this role is changing"
                            placeholder="e.g. Promoted to handle payouts from 1 October"
                          />
                          <div style={{ display: 'flex', gap: 8 }}>
                            <Button
                              variant="primary"
                              disabled={!reasonIsUsable(roleReason) || busy !== null}
                              onClick={() =>
                                void run(
                                  `role:${a.id}`,
                                  () => setAdminRole(a.id, pendingRole, roleReason.trim()),
                                  () => {
                                    setConfirmRole(null);
                                    setRoleReason('');
                                    setEditing(null);
                                  },
                                )
                              }
                            >
                              {busy === `role:${a.id}` ? 'Changing…' : 'Change role'}
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busy !== null}
                              onClick={() => setConfirmRole(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <Button
                            variant="ghost"
                            disabled={busy !== null}
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      )}
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
                          Switch off <strong>{a.email}</strong>? They lose admin access immediately,
                          and every device they are signed in on is signed out. Their account and its
                          audit trail stay.
                        </span>
                      </span>
                      <ReasonBox
                        value={offReason}
                        onChange={setOffReason}
                        disabled={busy !== null}
                        label="Why this admin is being switched off"
                        placeholder="e.g. Left the company today — access removed"
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button
                          variant="danger"
                          disabled={!reasonIsUsable(offReason) || busy !== null}
                          onClick={() =>
                            void run(
                              `off:${a.id}`,
                              () => deactivateAdmin(a.id, offReason.trim()),
                              () => {
                                setConfirmOff(null);
                                setOffReason('');
                              },
                            )
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
