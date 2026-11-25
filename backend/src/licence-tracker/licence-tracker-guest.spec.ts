import { readFileSync } from 'fs';
import * as path from 'path';
import { ServiceUnavailableException } from '@nestjs/common';
import { LicenceTrackerService } from './licence-tracker.service';

// The signed-out half of the Application Tracker: one-off SAPS checks behind
// the 18+ gate, with NOTHING persisted. The parser/classifier are shared with
// the member path intentionally, so these tests only need to prove the guest
// method wires them correctly and never writes.
function fixture(name: string): string {
  return readFileSync(
    path.join(__dirname, '__fixtures__', `${name}.html`),
    'utf-8',
  );
}

function makeService(html: string) {
  const client = { fetch: jest.fn().mockResolvedValue({ httpStatus: 200, html }) };
  const prisma = new Proxy(
    {},
    {
      get() {
        throw new Error('the guest check must not touch the database');
      },
    },
  );
  const settings = { get: jest.fn().mockResolvedValue(true) };
  const service = new LicenceTrackerService(
    prisma as never,
    client as never,
    {} as never,
    settings as never,
  );
  return { service, client };
}

describe('LicenceTrackerService — guest check', () => {
  it('returns the status SAPS prints, without persisting anything', async () => {
    const { service, client } = makeService(fixture('record-competency'));
    const out = await service.checkGuest({
      kind: 'COMPETENCY',
      reference: ' c00000001 ',
    });

    expect(client.fetch).toHaveBeenCalledWith('C00000001', null);
    expect(out).toMatchObject({
      outcome: 'row',
      kind: 'COMPETENCY',
      reference: 'C00000001',
      status: 'APPROVED',
      applicationNumber: 'C00000001',
      applicationType: 'COMPETENCY',
    });
    expect(out.statusDate).toBeInstanceOf(Date);
    expect(out.sapsUpdatedOn).toBeInstanceOf(Date);
  });

  it('reads "no records" as an answer, not an error', async () => {
    const { service } = makeService(fixture('no-records'));
    const out = await service.checkGuest({
      kind: 'FIREARM_LICENCE',
      reference: '12345678',
      serial: 'ABC123',
    });
    expect(out.outcome).toBe('no_records');
    expect(out.status).toBeNull();
  });

  it('fails closed on an unreadable page', async () => {
    const { service } = makeService('<html><body>blocked</body></html>');
    await expect(
      service.checkGuest({ kind: 'COMPETENCY', reference: '12345678' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('refuses a blank reference before calling SAPS', async () => {
    const { service, client } = makeService(fixture('record-competency'));
    await expect(
      service.checkGuest({ kind: 'COMPETENCY', reference: '   ' }),
    ).rejects.toThrow('Enter the application reference');
    expect(client.fetch).not.toHaveBeenCalled();
  });
});
