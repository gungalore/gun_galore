'use client';

/**
 * THE DESK — the external consoles.
 *
 * Every third-party service the business runs on, one tap from anywhere in the
 * Desk. The operator's own bookmarks folder, given real names and grouped in
 * the order things go wrong: money first, then what talks to members, then
 * what holds them up.
 *
 * ⚠️ IT IS A DRAWER, NOT A NAV. These are exits. Putting them in the tab bar
 * would sit five external sites beside five Desk surfaces and make leaving as
 * easy as switching board — the pile is the job, and this is the drawer you
 * open when the job leads somewhere else.
 *
 * ⚠️ EVERY LINK LEAVES THE DESK, AND SAYS SO. Each row shows its host under
 * the name and carries an out-arrow. The name is ours; the host is what the
 * address bar will read. Showing both means a link that has quietly moved is
 * visible before it is clicked, not after.
 */
import * as React from 'react';
import { Drawer } from './overlays';
import { Button } from './primitives';
import { signOutOfDesk } from '@/lib/desk-auth';
import { IconExternal, IconAlert, IconSite } from './icons';
import {
  DESK_SERVICES,
  SERVICE_GROUP_ORDER,
  serviceHost,
  servicesIn,
  type DeskService,
} from '@/lib/desk-services';

function ServiceRow({ service }: { service: DeskService }) {
  const [lit, setLit] = React.useState(false);
  return (
    <a
      href={service.url}
      target="_blank"
      /* noreferrer as well as noopener: these are vendor consoles for a
         firearms marketplace and the referrer would name this admin. */
      rel="noopener noreferrer"
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => setLit(false)}
      onFocus={() => setLit(true)}
      onBlur={() => setLit(false)}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        // 44 on the phone comes from the token; the padding carries the rest.
        minHeight: 'var(--dk-h-control)',
        padding: '11px 12px',
        borderRadius: 'var(--dk-radius-control)',
        background: lit ? 'var(--dk-raised)' : 'transparent',
        border: `1px solid ${lit ? 'var(--dk-line-2)' : 'transparent'}`,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--dk-ink)' }}>
            {service.name}
          </span>
          <IconExternal size={12} style={{ color: 'var(--dk-ink-4)', flex: 'none' }} />
        </span>
        <span style={{ fontSize: 12.5, lineHeight: 1.45, color: 'var(--dk-ink-2)' }}>
          {service.purpose}
        </span>
        {service.caution ? (
          /* The thing that bites, at the moment of clicking — not in a doc
             nobody opens at 2am. warn ink, and it always carries its icon. */
          <span
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 5,
              fontSize: 12,
              lineHeight: 1.45,
              color: 'var(--dk-warn)',
            }}
          >
            <IconAlert size={12} style={{ flex: 'none', marginTop: 2 }} />
            {service.caution}
          </span>
        ) : null}
        <span className="dk-mono" style={{ fontSize: 11, color: 'var(--dk-ink-4)' }}>
          {serviceHost(service.url)}
        </span>
      </span>
    </a>
  );
}

export function ServicesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      typeLabel="Services"
      icon={IconSite}
      title="External consoles"
      meta={`${DESK_SERVICES.length} services this business runs on`}
      note="Every one of these opens in a new tab, signed in as you. None of them is managed from here."
      /**
       * 🚨 SIGNING OUT HAD NO CONTROL ANYWHERE IN THE DESK. signOutOfDesk()
       * has sat in lib/desk-auth.ts since the cutover, documented as "the
       * only honest logout" because it clears BOTH stores — and nothing
       * imported it. The desktop bar's "Op" avatar, the obvious home for
       * it, was a decorative <span aria-hidden="true"> with no handler.
       *
       * The artboard puts "Sign out of the Desk" at the foot of the More
       * screen. That screen is not built (its premise — rows opening the
       * old admin panel — died when the cutover finished and the panel was
       * deleted), so this drawer is the nearest surface that already
       * reaches every viewport: one control, on the shell, phone and
       * desktop alike. It goes in the FOOTER rather than the list, because
       * the list is external links and this is the one thing here that acts
       * on the Desk itself.
       */
      footer={
        <Button
          variant="ghost"
          onClick={() => {
            signOutOfDesk();
          }}
        >
          Sign out of the Desk
        </Button>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {SERVICE_GROUP_ORDER.map((group) => {
          const rows = servicesIn(group);
          if (rows.length === 0) return null;
          return (
            <section key={group} style={{ padding: '14px 8px 6px' }}>
              <div
                className="dk-mono"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '0 4px 8px',
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--dk-ink-3)',
                }}
              >
                {group}
                <span style={{ flex: 1, height: 1, background: 'var(--dk-line)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {rows.map((s) => (
                  <ServiceRow key={s.url} service={s} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </Drawer>
  );
}
