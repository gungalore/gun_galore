'use client';

/**
 * HEALTH — the server vitals.
 *
 * ⚠️ EVERY TILE ON THIS CARD IS MEASURED BY WARDEN, ON THE BOX. Disk, memory,
 * SSL expiry, nginx error rates and backup freshness do not exist inside a
 * Node request handler, and this card is the one place on the Desk where that
 * is most tempting to fake. An unmeasured tile carries an em dash and the
 * server's own reason for it — never a zero, because "0% disk used" and "we
 * could not measure the disk" are different facts and only one is true.
 */
import * as React from 'react';
import { Vital } from '../../../../components/desk';
import { clock } from '../../../../lib/desk-site';
import { Card } from './board-bits';
import type { VitalRow } from './board';

export function ServerVitals({
  vitals,
  at,
  phone,
}: {
  vitals: VitalRow[];
  /** When this browser last got a good board read. Null before the first. */
  at: string | null;
  phone: boolean;
}) {
  const known = vitals.filter((v) => v.known).length;
  return (
    <Card
      label="Server vitals"
      hint={`${known} of ${vitals.length} measured · ${at ? clock(at) : '—'}`}
      footer={
        known === vitals.length
          ? undefined
          : 'Disk, SSL expiry, nginx error rates and backup freshness live on the box, not in this process — Warden measures them and each tile carries its own reason when it could not. A tile showing 0% for a disk nobody measured is worse than one showing nothing.'
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {vitals.map((v) => (
          <Vital
            key={v.key}
            label={v.label}
            value={v.value}
            tone={v.known ? v.tone : 'unknown'}
            // ⚠️ THE REASON THE SERVER GAVE, NOT A GUESS AT IT. The fallback
            // is only for a server that sent none.
            sub={v.known ? undefined : (v.reason ?? 'not measured')}
          />
        ))}
      </div>
    </Card>
  );
}
