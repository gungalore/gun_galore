import { readingShape, scrub } from './vault-log.service';

describe('the ledger never holds document contents', () => {
  it('drops keys that name a value, whatever they hold', () => {
    const out = scrub({
      kind: 'FIREARM_LICENCE',
      holder_name: 'GJP FOURIE',
      id_number: '8905125220089',
      frame_serial: 'B477423',
      details: { make: 'HOWA' },
      present: ['make', 'calibre'],
    });
    expect(out).toEqual({ kind: 'FIREARM_LICENCE', present: ['make', 'calibre'] });
  });

  it('cuts long strings so a transcription cannot arrive as a "reason"', () => {
    const long = 'x'.repeat(200);
    const out = scrub({ reason: long }) as { reason: string };
    expect(out.reason.length).toBeLessThanOrEqual(48);
  });

  it('keeps numbers, booleans, short slugs, dates as days, and nested shapes', () => {
    const out = scrub({
      gapDays: 12,
      confident: true,
      strength: 'definitive',
      when: new Date('2026-09-07T10:00:00Z'),
      shape: { present: ['a'], missing: ['b'], serial_number: 'X' },
    });
    expect(out).toEqual({
      gapDays: 12,
      confident: true,
      strength: 'definitive',
      when: '2026-09-07',
      shape: { present: ['a'], missing: ['b'] },
    });
  });
});

describe('readingShape', () => {
  it('names what came back and what did not, never the values', () => {
    const s = readingShape({ make: 'HOWA', calibre: '', section: 'S16' }, ['make', 'calibre', 'section', 'frame_serial']);
    expect(s).toEqual({ present: ['make', 'section'], missing: ['calibre', 'frame_serial'] });
  });
});
