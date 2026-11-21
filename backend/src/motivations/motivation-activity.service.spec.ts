import {
  MotivationActivityService,
  sanitiseActivityDetail,
} from './motivation-activity.service';

// ────────────────────────────────────────────────────────────────────
// The support timeline is read by admins and must never be a privacy event.
// Everything here is about the two properties that matter:
//   1. only keys/counts/labels get in — an answer value, an object dump or a
//      long blob is dropped, not stringified;
//   2. logging can never break the thing it is logging.
// ────────────────────────────────────────────────────────────────────

function makeService(create = jest.fn(async () => ({}))) {
  const prisma = { motivationActivity: { create, findMany: jest.fn(async () => []) } };
  return { svc: new MotivationActivityService(prisma as never), create, prisma };
}

describe('sanitiseActivityDetail', () => {
  it('keeps short strings, finite numbers, booleans and string arrays', () => {
    expect(
      sanitiseActivityDetail({
        licenceType: 'S15_OCCASIONAL_HUNTER',
        prefilled: 56,
        paid: true,
        changed: ['a', 'b'],
      }),
    ).toEqual({
      licenceType: 'S15_OCCASIONAL_HUNTER',
      prefilled: 56,
      paid: true,
      changed: ['a', 'b'],
    });
  });

  it('drops objects, null, undefined and arrays of non-strings', () => {
    // A nested answer object is exactly what must not be written.
    const out = sanitiseActivityDetail({
      nested: { idNumber: '9001015800083' },
      nothing: null,
      blanks: [1, 2, null],
    } as Record<string, unknown>);
    expect(out).toBeUndefined();
  });

  it('caps strings, arrays and the number of keys', () => {
    const long = 'x'.repeat(500);
    const out = sanitiseActivityDetail({
      one: long,
      many: Array.from({ length: 40 }, (_, i) => `k${i}`),
      ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`key${i}`, i])),
    }) as Record<string, unknown>;

    expect(String(out.one)).toHaveLength(120);
    expect((out.many as string[]).length).toBe(12);
    expect(Object.keys(out).length).toBeLessThanOrEqual(12);
  });

  it('refuses keys that are not simple identifiers', () => {
    const out = sanitiseActivityDetail({
      'ok_key': 'yes',
      'bad key!': 'no',
      'answer payload': { a: 1 },
    } as Record<string, unknown>);
    expect(out).toEqual({ ok_key: 'yes' });
  });

  it('returns undefined for an empty or non-object input', () => {
    expect(sanitiseActivityDetail(null)).toBeUndefined();
    expect(sanitiseActivityDetail({})).toBeUndefined();
    expect(sanitiseActivityDetail([] as unknown as Record<string, unknown>)).toBeUndefined();
  });
});

describe('MotivationActivityService.record', () => {
  it('writes the sanitised detail and the page', async () => {
    const { svc, create } = makeService();
    await svc.record({
      motivationId: 'mo1',
      motivationRef: 'MO000146',
      userId: 'u1',
      action: 'answer_saved',
      detail: { changed: ['firearm_make'], secret: { id: 'x' } },
      path: '/licence-centre/mo1',
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        motivationId: 'mo1',
        motivationRef: 'MO000146',
        action: 'answer_saved',
        detail: { changed: ['firearm_make'] },
        path: '/licence-centre/mo1',
      }),
    });
  });

  it('never throws when the write fails', async () => {
    // A support trail that can fail a save is worse than no trail.
    const create = jest.fn(async () => {
      throw new Error('db down');
    });
    const { svc } = makeService(create);
    await expect(
      svc.record({ motivationRef: 'MO000146', action: 'created' }),
    ).resolves.toBeUndefined();
  });
});

describe('formatTimeline', () => {
  it('reads oldest first with the reference, action and detail', () => {
    const text = MotivationActivityService.formatTimeline([
      {
        id: '2',
        motivationId: 'mo1',
        motivationRef: 'MO000146',
        action: 'generation_failed',
        detail: { error: 'overloaded' },
        path: null,
        createdAt: new Date('2026-11-21T08:02:00Z'),
      },
      {
        id: '1',
        motivationId: 'mo1',
        motivationRef: 'MO000146',
        action: 'answer_saved',
        detail: { changed: ['a', 'b'] },
        path: '/licence-centre/mo1',
        createdAt: new Date('2026-11-21T08:00:00Z'),
      },
    ]);

    const lines = text.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('answer_saved');
    expect(lines[0]).toContain('changed=a|b');
    expect(lines[1]).toContain('generation_failed');
    expect(lines[1]).toContain('error=overloaded');
  });

  it('says so when there is nothing', () => {
    expect(MotivationActivityService.formatTimeline([])).toBe(
      'No activity recorded.',
    );
  });
});
