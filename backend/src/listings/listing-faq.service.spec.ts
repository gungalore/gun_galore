import { NotFoundException } from '@nestjs/common';
import { ListingFaqService } from './listing-faq.service';

// ── fakes ────────────────────────────────────────────────────────────

function makeLlm(over: {
  decide?: Record<string, number>;
  distil?: unknown;
  match?: unknown;
  configured?: boolean;
} = {}) {
  const calls: { purpose: string; req: unknown }[] = [];
  const llm = {
    isConfiguredFor: jest.fn().mockReturnValue(over.configured ?? true),
    decide: jest.fn(async () => {
      const answers: Record<string, unknown> = {};
      for (const [id, p] of Object.entries(
        over.decide ?? { faq_duplicate: 0.05, contact_details: 0.01 },
      )) {
        answers[id] = { type: 'noul', noul: p };
      }
      return { answers, model: 'jev-1.13.0' };
    }),
    complete: jest.fn(async (req: { purpose: string }) => {
      calls.push({ purpose: req.purpose, req });
      const body =
        req.purpose === 'listing.faq.match'
          ? (over.match ?? { faqId: 'F1' })
          : (over.distil ?? {
              publishable: true,
              question: 'Does the scope include a hard case?',
              answer: 'Yes, it ships with the hard case shown in the photos.',
            });
      return { text: JSON.stringify(body) };
    }),
  };
  return { llm, calls };
}

function makeService(over: {
  listing?: unknown;
  entries?: unknown[];
  inquiry?: unknown;
  samples?: unknown[];
  decide?: Record<string, number>;
  distil?: unknown;
  match?: unknown;
  regexHit?: boolean;
} = {}) {
  const prisma = {
    listing: {
      findUnique: jest.fn().mockResolvedValue(
        'listing' in over
          ? over.listing
          : {
              status: 'ACTIVE',
              publicVisible: true,
              sellerId: 'S1',
            },
      ),
    },
    listingFaq: {
      findMany: jest.fn().mockResolvedValue(over.entries ?? []),
      upsert: jest.fn().mockResolvedValue({}),
    },
    listingInquiry: {
      findUnique: jest.fn().mockResolvedValue(over.inquiry ?? null),
      findMany: jest.fn().mockResolvedValue(over.samples ?? []),
    },
  };
  const contactFilter = {
    regexCheck: jest.fn().mockReturnValue(over.regexHit ? { hit: true } : null),
  };
  const { llm } = makeLlm({
    decide: over.decide,
    distil: over.distil,
    match: over.match,
  });
  const svc = new ListingFaqService(
    prisma as never,
    llm as never,
    contactFilter as never,
  );
  return { svc, prisma, llm, contactFilter };
}

const FAQ_ROW = {
  id: 'F1',
  question: 'Does the scope include a hard case?',
  answer: 'Yes, it ships with the hard case shown.',
};

const INQUIRY = {
  id: 'INQ1',
  listingId: 'L1',
  sellerId: 'S1',
  listing: { title: 'Rifle scope' },
  messages: [
    { senderId: 'B1', content: 'Does it come with a case?' },
    { senderId: 'S1', content: 'Yes, the hard case is included.' },
  ],
};

// ── reads ────────────────────────────────────────────────────────────

describe('ListingFaqService.listPublic', () => {
  it('returns visible entries and the seller reply badge', async () => {
    const { svc } = makeService({
      entries: [FAQ_ROW],
      samples: [
        { createdAt: new Date('2026-11-01T10:00:00Z'), sellerFirstReplyAt: new Date('2026-11-01T10:30:00Z') },
        { createdAt: new Date('2026-11-02T10:00:00Z'), sellerFirstReplyAt: new Date('2026-11-02T10:20:00Z') },
        { createdAt: new Date('2026-11-03T10:00:00Z'), sellerFirstReplyAt: new Date('2026-11-03T10:10:00Z') },
      ],
    });
    const out = await svc.listPublic('L1');
    expect(out.entries).toEqual([FAQ_ROW]);
    expect(out.sellerReply.label).toContain('within an hour');
    expect(out.sellerReply.sampleSize).toBe(3);
  });

  it('404s a missing or non-public listing rather than confirming the id', async () => {
    await expect(makeService({ listing: null }).svc.listPublic('L1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      makeService({ listing: { status: 'DRAFT', publicVisible: true, sellerId: 'S1' } }).svc.listPublic('L1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      makeService({ listing: { status: 'ACTIVE', publicVisible: false, sellerId: 'S1' } }).svc.listPublic('L1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('says the reply time is unknown on a thin sample', async () => {
    const { svc } = makeService({ samples: [] });
    const out = await svc.listPublic('L1');
    expect(out.sellerReply.label).toMatch(/not yet known/i);
    expect(out.sellerReply.sampleSize).toBe(0);
  });
});

// ── duplicate matching ───────────────────────────────────────────────

describe('ListingFaqService.match', () => {
  it('returns the entry Jev says already answers the question', async () => {
    const { svc, llm } = makeService({
      entries: [FAQ_ROW, { ...FAQ_ROW, id: 'F2' }],
      decide: { faq_duplicate: 0.92 },
      match: { faqId: 'F2' },
    });
    const hit = await svc.match('L1', 'Do you include the case?');
    expect(hit?.id).toBe('F2');
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('does not spend the second call in the 60–80 % review band', async () => {
    const { svc, llm } = makeService({
      entries: [FAQ_ROW],
      decide: { faq_duplicate: 0.7 },
    });
    expect(await svc.match('L1', 'Do you include the case?')).toBeNull();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('asks the seller when the model names an entry that is not in the list', async () => {
    const { svc } = makeService({
      entries: [FAQ_ROW],
      decide: { faq_duplicate: 0.95 },
      match: { faqId: 'NOPE' },
    });
    expect(await svc.match('L1', 'Do you include the case?')).toBeNull();
  });

  it('is inert when the listing has no FAQ yet', async () => {
    const { svc, llm } = makeService({ entries: [] });
    expect(await svc.match('L1', 'anything?')).toBeNull();
    expect(llm.decide).not.toHaveBeenCalled();
  });
});

// ── distillation ─────────────────────────────────────────────────────

describe('ListingFaqService.distil', () => {
  it('publishes the cleaned pair', async () => {
    const { svc, prisma } = makeService({ inquiry: INQUIRY });
    await svc.distil('INQ1');
    expect(prisma.listingFaq.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inquiryId: 'INQ1' },
        create: expect.objectContaining({
          inquiryId: 'INQ1',
          listingId: 'L1',
          question: 'Does the scope include a hard case?',
          answer: 'Yes, it ships with the hard case shown in the photos.',
        }),
      }),
    );
  });

  it('does nothing until the seller has replied', async () => {
    const { svc, prisma, llm } = makeService({
      inquiry: {
        ...INQUIRY,
        messages: [{ senderId: 'B1', content: 'Does it come with a case?' }],
      },
    });
    await svc.distil('INQ1');
    expect(llm.complete).not.toHaveBeenCalled();
    expect(prisma.listingFaq.upsert).not.toHaveBeenCalled();
  });

  it('respects publishable=false', async () => {
    const { svc, prisma } = makeService({
      inquiry: INQUIRY,
      distil: { publishable: false },
    });
    await svc.distil('INQ1');
    expect(prisma.listingFaq.upsert).not.toHaveBeenCalled();
  });

  it('refuses an output that still carries a phone number or link', async () => {
    for (const bad of [
      { publishable: true, question: 'Can I call 0743039999?', answer: 'Yes.' },
      { publishable: true, question: 'Do you include the case?', answer: 'See https://evil.example.' },
      { publishable: true, question: 'Do you include the case?', answer: 'Mail me at a@b.co.za.' },
    ]) {
      const { svc, prisma } = makeService({ inquiry: INQUIRY, distil: bad });
      await svc.distil('INQ1');
      expect(prisma.listingFaq.upsert).not.toHaveBeenCalled();
    }
  });

  it('refuses when the regex contact floor trips', async () => {
    const { svc, prisma } = makeService({ inquiry: INQUIRY, regexHit: true });
    await svc.distil('INQ1');
    expect(prisma.listingFaq.upsert).not.toHaveBeenCalled();
  });

  it('refuses when Jev blocks the publication', async () => {
    const { svc, prisma } = makeService({
      inquiry: INQUIRY,
      decide: { contact_details: 0.95 },
    });
    await svc.distil('INQ1');
    expect(prisma.listingFaq.upsert).not.toHaveBeenCalled();
  });

  it('never throws, even when the model or database fails', async () => {
    const { svc, prisma } = makeService({ inquiry: INQUIRY });
    prisma.listingFaq.upsert.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.distil('INQ1')).resolves.toBeUndefined();
  });
});
