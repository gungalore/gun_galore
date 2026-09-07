// The page-guide ADMIN EDITOR — what is left of the GG site-guide after the
// Ask Boet panel was retired (2026-09-07).
//
// The guide used to be SERVED as well as edited; those tests went with
// getGuide(). What is pinned here is the half the desk still uses: the editor
// enforces the house rules (never "escrow"; internal '/'-only CTA links) and
// sane caps, the static GUIDES catalog stays the source of truth for which
// keys exist, and publishing is a deliberate second step.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { AskGgGuideService } from './ask-gg-guide.service';
import { GUIDES } from './guide-content';
import type { PrismaService } from '../prisma/prisma.service';

function build() {
  const prisma = {
    askGgGuideOverride: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn((args: { create: { key: string } }) =>
        Promise.resolve({ key: args.create.key, status: 'DRAFT' }),
      ),
      update: jest.fn((args: { where: { key: string }; data: { status: string } }) =>
        Promise.resolve({ key: args.where.key, status: args.data.status }),
      ),
      delete: jest.fn().mockResolvedValue({ key: 'x' }),
    },
  };
  const guide = new AskGgGuideService(prisma as unknown as PrismaService);
  return { guide, prisma };
}

// The compliance lock that used to live in the (deleted) wave-1 spec. It
// scanned the chat's prompt files; the member-facing copy that survives is the
// shipped guide catalog and the seeded help-centre content, so it scans those.
//
// ⚠️ The catalog is scanned as DATA, not as file text — guide-content.ts opens
// by stating the house rule, so a raw grep of the source flags the rule itself.
describe('banned-word scan (compliance lock: "funds held", never the e-word)', () => {
  it('the shipped guide catalog contains no banned payment term', () => {
    expect(/escrow/i.test(JSON.stringify(GUIDES))).toBe(false);
  });

  it('the seeded help-centre content contains no banned payment term', () => {
    const f = path.join(__dirname, '..', '..', 'prisma', 'seed-data', 'help-centre.ts');
    expect(/escrow/i.test(fs.readFileSync(f, 'utf8'))).toBe(false);
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
