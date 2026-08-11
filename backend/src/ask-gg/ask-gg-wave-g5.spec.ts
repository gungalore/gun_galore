// GG site-guide — Wave G5 gate: admin-editable guide overrides.
//
// Proves the override OVERLAY is correct and safe: only PUBLISHED rows overlay
// the shipped default, the auction live-state line always wins the intro, and
// the admin editor enforces the house rules (never "escrow"; internal '/'-only
// CTA links) + sane caps. The static GUIDES catalog stays the source of truth
// for which keys exist.

jest.mock('meilisearch', () => ({
  Meilisearch: class {},
  MeilisearchApiError: class extends Error {},
}));

import { BadRequestException } from '@nestjs/common';
import { AskGgGuideService } from './ask-gg-guide.service';
import type { PrismaService } from '../prisma/prisma.service';

const future = new Date(Date.now() + 3 * 24 * 3600 * 1000);

function build(opts: {
  published?: Array<{
    key: string;
    title: string;
    intro: string | null;
    points: string[];
    ctas: unknown;
  }>;
  auctionListing?: boolean;
} = {}) {
  const published = opts.published ?? [];
  const findMany = jest.fn(({ where }: { where?: { status?: string } } = {}) =>
    // The service always queries status=PUBLISHED; return the set only then.
    Promise.resolve(where?.status === 'PUBLISHED' ? published : []),
  );
  const prisma = {
    askGgGuideOverride: {
      findMany,
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn((args: { create: { key: string } }) =>
        Promise.resolve({ key: args.create.key, status: 'DRAFT' }),
      ),
      update: jest.fn((args: { where: { key: string }; data: { status: string } }) =>
        Promise.resolve({ key: args.where.key, status: args.data.status }),
      ),
      delete: jest.fn().mockResolvedValue({ key: 'x' }),
    },
    listing: {
      findUnique: jest.fn().mockResolvedValue(
        opts.auctionListing
          ? {
              listingType: 'AUCTION',
              status: 'ACTIVE',
              // Public category — the guide's live auction state is withheld
              // from anonymous callers on members-only listings (see
              // public-visibility.spec.ts), which is not what this test is about.
              publicVisible: true,
              isExperience: false,
              currentBid: 1_500_000,
              endTime: future,
              reservePrice: 2_000_000,
            }
          : null,
      ),
    },
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const guide = new AskGgGuideService(
    prisma as unknown as PrismaService,
    {} as any,
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { guide, prisma, findMany };
}

describe('G5 override overlay', () => {
  it('a PUBLISHED override replaces the shipped default content', async () => {
    const { guide, findMany } = build({
      published: [
        {
          key: 'dashboard',
          title: 'My custom dashboard guide',
          intro: 'A custom intro.',
          points: ['first custom point', 'second custom point'],
          ctas: [{ label: 'Do the thing', href: '/my/earnings' }],
        },
      ],
    });
    const g = await guide.getGuide({ path: '/dashboard' });
    expect(g.key).toBe('dashboard');
    expect(g.title).toBe('My custom dashboard guide');
    expect(g.intro).toBe('A custom intro.');
    expect(g.points).toEqual(['first custom point', 'second custom point']);
    expect(g.ctas).toEqual([{ label: 'Do the thing', href: '/my/earnings' }]);
    // The query is scoped to PUBLISHED — a DRAFT would never reach users.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'PUBLISHED' } }),
    );
  });

  it('no published override → the shipped default is served unchanged', async () => {
    const { guide } = build({ published: [] });
    const g = await guide.getGuide({ path: '/dashboard' });
    expect(g.key).toBe('dashboard');
    expect(g.title).toBe('Your seller dashboard'); // shipped default
  });

  it('an auction override cannot change the live current-bid intro', async () => {
    const { guide } = build({
      auctionListing: true,
      published: [
        {
          key: 'listing-auction',
          title: 'Custom auction title',
          intro: 'THIS SHOULD NOT SHOW',
          points: ['bid high'],
          ctas: [],
        },
      ],
    });
    const g = await guide.getGuide({ path: '/listings/l1', listingId: 'l1' });
    expect(g.title).toBe('Custom auction title'); // override applied
    expect(g.intro).toContain('Current bid'); // live state wins the intro
    expect(g.intro).not.toContain('THIS SHOULD NOT SHOW');
  });
});

describe('G5 admin editor validation (house rules + caps)', () => {
  it('rejects the word "escrow" anywhere in the copy', async () => {
    const { guide } = build();
    await expect(
      guide.adminSaveGuide(
        'home',
        { title: 'Ok', points: ['We hold your money in escrow.'] },
        'admin_1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a CTA link that is not an internal path', async () => {
    const { guide } = build();
    await expect(
      guide.adminSaveGuide(
        'home',
        {
          title: 'Ok',
          points: ['A point'],
          ctas: [{ label: 'Evil', href: 'https://evil.example' }],
        },
        'admin_1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      guide.adminSaveGuide(
        'home',
        {
          title: 'Ok',
          points: ['A point'],
          ctas: [{ label: 'Proto', href: '//evil.example' }],
        },
        'admin_1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an empty title and an empty points list', async () => {
    const { guide } = build();
    await expect(
      guide.adminSaveGuide('home', { title: '', points: ['x'] }, 'admin_1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      guide.adminSaveGuide('home', { title: 'Ok', points: [] }, 'admin_1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown guide key', async () => {
    const { guide } = build();
    await expect(
      guide.adminSaveGuide('not-a-real-key', { title: 'Ok', points: ['x'] }, 'admin_1'),
    ).rejects.toThrow();
  });

  it('rejects inflected forms of "escrow" (escrows / escrowed)', async () => {
    const { guide } = build();
    await expect(
      guide.adminSaveGuide('home', { title: 'Ok', points: ['We use escrows for funds.'] }, 'admin_1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      guide.adminSaveGuide('home', { title: 'Funds are escrowed', points: ['x'] }, 'admin_1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects prototype-chain keys (__proto__ / constructor / toString)', async () => {
    const { guide } = build();
    for (const k of ['__proto__', 'constructor', 'toString']) {
      await expect(
        guide.adminSaveGuide(k, { title: 'Ok', points: ['x'] }, 'admin_1'),
      ).rejects.toThrow();
      await expect(guide.adminGetGuide(k)).rejects.toThrow();
    }
  });

  it('accepts a clean edit and upserts as DRAFT (not auto-published)', async () => {
    const { guide, prisma } = build();
    const res = await guide.adminSaveGuide(
      'home',
      {
        title: 'A better welcome',
        intro: 'Funds are held until you get the item.',
        points: ['Buying is protected.', 'Selling is free to list.'],
        ctas: [{ label: 'Start selling', href: '/listings/new' }],
      },
      'admin_1',
    );
    expect(res.status).toBe('DRAFT');
    expect(prisma.askGgGuideOverride.upsert).toHaveBeenCalled();
  });
});

describe('G5 publish lifecycle', () => {
  it('publish requires an existing saved override', async () => {
    const { guide, prisma } = build();
    (prisma.askGgGuideOverride.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(guide.adminPublishGuide('home', 'admin_1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('publish flips an existing override to PUBLISHED', async () => {
    const { guide, prisma } = build();
    (prisma.askGgGuideOverride.findUnique as jest.Mock).mockResolvedValue({ id: 'o1' });
    const res = await guide.adminPublishGuide('home', 'admin_1');
    expect(res.status).toBe('PUBLISHED');
    expect(prisma.askGgGuideOverride.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'home' },
        data: expect.objectContaining({ status: 'PUBLISHED' }),
      }),
    );
  });

  it('reset discards the override (delete) and reverts to default', async () => {
    const { guide, prisma } = build();
    const res = await guide.adminResetGuide('home');
    expect(res.status).toBe('DEFAULT');
    expect(prisma.askGgGuideOverride.delete).toHaveBeenCalledWith({ where: { key: 'home' } });
  });
});
