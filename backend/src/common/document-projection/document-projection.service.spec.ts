import { DocumentProjectionService } from './document-projection.service';
import { isoDate, normaliseLabel } from './document-projection';
import type { CaptureFact, DocumentCapture } from '../document-capture/document-capture';

const ORIGINAL_JEV = process.env.JEV_API_KEY;
beforeAll(() => {
  process.env.JEV_API_KEY = 'test-jev';
});
afterAll(() => {
  if (ORIGINAL_JEV === undefined) delete process.env.JEV_API_KEY;
  else process.env.JEV_API_KEY = ORIGINAL_JEV;
});

function fact(label: string, value: string, normalized?: string): CaptureFact {
  return {
    label,
    value,
    normalized,
    valueType: 'text',
    confidence: 'high',
  };
}

function capture(facts: CaptureFact[]): DocumentCapture {
  return {
    version: '2026-10-28a',
    pageText: facts.map((f) => `${f.label} ${f.value}`).join('\n'),
    document: {},
    facts,
    quality: { readable: true, notes: [] },
  };
}

function noJev() {
  return {
    decide: jest.fn(async () => {
      throw new Error('no jev');
    }),
  } as never;
}

describe('DocumentProjectionService', () => {
  it('maps an association certificate into its container keys', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([
        fact('Association', 'SA JAGTERS: SA HUNTERS'),
        fact('Membership No', '108828'),
        fact('Member since', '2024-06-07'),
        fact('Dedicated status held since', '2024-06-07'),
        fact('Valid until', '2027-06-30'),
      ]),
      keys: [
        'association',
        'membership_number',
        'joined_on',
        'status_since',
        'expires_on',
      ],
    });
    expect(out.values.association.value).toContain('SA HUNTERS');
    expect(out.values.membership_number.value).toBe('108828');
    expect(out.values.joined_on.value).toBe('2024-06-07');
    expect(out.values.status_since.value).toBe('2024-06-07');
    expect(out.values.expires_on.value).toBe('2027-06-30');
    expect(out.unmatched).toEqual([]);
    expect(out.values.status_since.via).toBe('label');
  });

  it('maps the motivation registry’s association keys', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([
        fact('Association', 'SA HUNTERS'),
        fact('Membership No', '108828'),
        fact('Member since', '2024-06-07'),
        fact('Dedicated status held since', '2024-06-07'),
        fact('Valid until', '2027-06-30'),
      ]),
      keys: [
        'association_name',
        'association_number',
        'association_joined',
        'dedicated_since',
        'association_expiry',
      ],
    });
    expect(out.values.association_name.value).toBe('SA HUNTERS');
    expect(out.values.association_number.value).toBe('108828');
    expect(out.values.association_joined.value).toBe('2024-06-07');
    expect(out.values.dedicated_since.value).toBe('2024-06-07');
    expect(out.values.association_expiry.value).toBe('2027-06-30');
  });

  it('maps the applied-for firearm prefix', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([
        fact('Make', 'Glock'),
        fact('Model', '43X'),
        fact('Calibre', '9mm'),
        fact('Serial Number', 'ABC123'),
      ]),
      keys: ['firearm_make', 'firearm_model', 'firearm_calibre', 'firearm_serial'],
    });
    expect(out.values.firearm_make.value).toBe('Glock');
    expect(out.values.firearm_model.value).toBe('43X');
    expect(out.values.firearm_calibre.value).toBe('9mm');
    expect(out.values.firearm_serial.value).toBe('ABC123');
  });

  it('reads the two unlabelled dates beneath a licence section', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([
        fact('Section', '16'),
        fact('Issue date', '2025-08-27', '2025-08-27'),
        fact('Expiry date', '2035-08-26', '2035-08-26'),
      ]),
      keys: ['section', 'issued_on', 'expires_on'],
    });
    expect(out.values.section.value).toBe('16');
    expect(out.values.issued_on.value).toBe('2025-08-27');
    expect(out.values.expires_on.value).toBe('2035-08-26');
  });

  it('does not let "valid until" fill the association', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([
        fact('Association membership valid until', '2027-06-30'),
      ]),
      keys: ['association', 'expires_on'],
    });
    expect(out.values.association).toBeUndefined();
    expect(out.values.expires_on.value).toBe('2027-06-30');
  });

  it('keeps the printed NONE for a component serial', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([fact('Frame Serial No', 'NONE')]),
      keys: ['frame_serial'],
    });
    expect(out.values.frame_serial.value).toBe('NONE');
  });

  it('normalises an Afrikaans label through the aliases', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([fact('Lidnommer', '108828')]),
      keys: ['membership_number'],
    });
    expect(out.values.membership_number.value).toBe('108828');
  });

  it('uses a normalized ISO date when the printed date is not ISO', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([fact('Member since', '7 June 2024', '2024-06-07')]),
      keys: ['joined_on'],
    });
    expect(out.values.joined_on.value).toBe('2024-06-07');
  });

  it('asks Jev only for an unmatched label and accepts a confident fact', async () => {
    const decide = jest.fn(async () => ({
      answers: {
        membership_number: {
          type: 'choice',
          choice: 'f0',
          confidence: 0.92,
          probabilities: { f0: 0.92, none: 0.08 },
        },
      },
    }));
    const svc = new DocumentProjectionService({ decide } as never);
    const out = await svc.project({
      capture: capture([fact('Lidmaatskap nommer', '108828')]),
      keys: ['membership_number'],
    });
    expect(out.values.membership_number.value).toBe('108828');
    expect(out.values.membership_number.via).toBe('jev');
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('ignores a low-confidence Jev answer', async () => {
    const decide = jest.fn(async () => ({
      answers: {
        membership_number: {
          type: 'choice',
          choice: 'f0',
          confidence: 0.4,
          probabilities: { f0: 0.4, none: 0.6 },
        },
      },
    }));
    const svc = new DocumentProjectionService({ decide } as never);
    const out = await svc.project({
      capture: capture([fact('Lidmaatskap nommer', '108828')]),
      keys: ['membership_number'],
    });
    expect(out.values.membership_number).toBeUndefined();
    expect(out.unmatched).toContain('membership_number');
  });

  it('never uses one fact for two keys', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([fact('Date of issue', '2024-06-07')]),
      keys: ['issued_on', 'competency_issued'],
    });
    const filled = Object.keys(out.values);
    expect(filled).toHaveLength(1);
  });

  it('never writes a key outside the requested schema', async () => {
    const svc = new DocumentProjectionService(noJev());
    const out = await svc.project({
      capture: capture([fact('Identity number', '8905125800087')]),
      keys: ['association'],
    });
    expect(Object.keys(out.values)).toEqual([]);
  });
});

describe('date and label helpers', () => {
  it('parses the formats a South African document prints', () => {
    expect(isoDate('2024-06-07')).toBe('2024-06-07');
    expect(isoDate('07/06/2024')).toBe('2024-06-07');
    expect(isoDate('7 June 2024')).toBe('2024-06-07');
    expect(isoDate('June 7, 2024')).toBe('2024-06-07');
    expect(isoDate('31/02/2024')).toBeNull();
  });

  it('normalises punctuation, accents and ampersands', () => {
    expect(normaliseLabel('Association & Club (No.)')).toBe(
      'association and club no',
    );
    expect(normaliseLabel('Dedicated status held since')).toBe(
      'dedicated status held since',
    );
  });
});
