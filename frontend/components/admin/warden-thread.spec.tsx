// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { WARDEN_KINDS, WardenProposals, WardenThread } from './warden-thread';
import type { WardenChatMessage, WardenProposal } from '@/lib/admin-api';

/**
 * The two things this component must never get wrong.
 *
 * ONE: a red gate has no fix, so it must render NO approve and NO decline
 * button — an enabled Approve on a red gate is a lie about the running
 * configuration of a firearms marketplace.
 *
 * TWO: the six kinds are a hand-mirrored contract. backend/src/admin/warden.spec.ts
 * reads this file's WARDEN_KINDS and holds it against the daemon's copy.
 */
describe('WardenThread', () => {
  it('keeps the six message kinds in the contract order', () => {
    expect([...WARDEN_KINDS]).toEqual([
      'finding',
      'fixed',
      'red-gate',
      'proposal',
      'ran',
      'note',
    ]);
  });

  it('renders a message body and its kind tag', () => {
    const messages: WardenChatMessage[] = [
      {
        id: 'm1',
        role: 'warden',
        kind: 'fixed',
        at: '2026-09-03T07:05:00.000Z',
        body: ['Restarted the stalled worker.'],
      },
    ];
    const { container } = render(<WardenThread messages={messages} onSettled={() => {}} />);
    const text = container.textContent ?? '';
    expect(text).toMatch(/Restarted the stalled worker/);
    expect(text).toMatch(/FIXED/);
  });
});

describe('WardenProposals', () => {
  const base = {
    id: 'prop1',
    status: 'pending' as const,
    headline: 'Headline',
    diagnosis: 'Diagnosis',
    raisedAt: '2026-09-03T07:05:00.000Z',
    reversible: true,
    gateKey: null,
  };

  it('offers approve and decline for a real proposal', () => {
    const proposals: WardenProposal[] = [
      {
        ...base,
        kind: 'proposal',
        command: 'nginx -t && nginx -s reload',
        operationName: 'reloadNginx',
      },
    ];
    const { container } = render(
      <WardenProposals proposals={proposals} onSettled={() => {}} />,
    );
    const text = container.textContent ?? '';
    expect(text).toMatch(/nginx -t && nginx -s reload/);
    expect(text).toMatch(/Approve and run/);
    expect(text).toMatch(/Decline/);
  });

  it('offers NO approve or decline on a red gate, which has no command', () => {
    const proposals: WardenProposal[] = [
      { ...base, id: 'gate1', kind: 'red_gate', command: null, operationName: null },
    ];
    const { container } = render(
      <WardenProposals proposals={proposals} onSettled={() => {}} />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Approve and run/);
    expect(text).not.toMatch(/Decline/);
    expect(text).toMatch(/no fix to run/i);
  });
});
