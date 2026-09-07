import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { GUIDES, type GuideCta } from './guide-content';

// The admin editor for the per-page guide playbooks (G5).
//
// ⚠️ THIS FILE USED TO SERVE THE GUIDE AS WELL AS EDIT IT. getGuide()
// and getPersonalGuide() answered GET /ask-gg/guide and
// GET /ask-gg/public/guide for the Ask Boet panel — the curated "how
// this page works" playbook, with live auction state and a personal
// overlay composed from the account shapers. The panel came off the site
// on 2026-08-26 and the routes went with the rest of the chat backend on
// 2026-09-07, taking the serve path, the override cache and the whole
// account-tools dependency with them.
//
// What is left is CONTENT MANAGEMENT: the static GUIDES catalog is the
// shipped baseline and the desk can still edit, publish and reset an
// AskGgGuideOverride against any of its keys. Nothing reads a published
// override today; the editor is kept because the desk owns this copy and
// AskGgGuideOverride is wired into the admin command centre.

/** House rule enforced on admin-authored guide copy (incl. inflections:
 *  escrow / escrows / escrowed / escrowing). */
const ESCROW_RE = /\bescrow(s|ed|ing)?\b/i;

/** The set of real guide keys. An own-key membership test (NOT `GUIDES[key]`)
 *  so prototype-chain names like `__proto__` / `constructor` are rejected. */
const KNOWN_GUIDE_KEYS = new Set(Object.keys(GUIDES));

/** Defensively coerce a stored ctas Json blob into GuideCta[] (validated on
 *  write, but never trust the DB blindly on the serve path). */
function coerceCtas(raw: unknown): GuideCta[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: GuideCta[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    const label = typeof rec.label === 'string' ? rec.label : '';
    if (!label) continue;
    const href = typeof rec.href === 'string' ? rec.href : undefined;
    const ask = typeof rec.ask === 'string' ? rec.ask : undefined;
    out.push({ label, ...(href ? { href } : {}), ...(ask !== undefined ? { ask } : {}) });
  }
  return out.length ? out : undefined;
}

/** A clean, validated guide-content payload from the admin editor (G5). */
interface CleanGuidePayload {
  title: string;
  intro: string | null;
  points: string[];
  ctas: GuideCta[];
}

/** Validate + normalise an admin guide edit. Enforces house rules (never
 *  "escrow"; internal '/'-only CTA links) and sane size caps. Throws
 *  BadRequestException with a clear message on any violation. */
function validateGuidePayload(input: {
  title?: unknown;
  intro?: unknown;
  points?: unknown;
  ctas?: unknown;
}): CleanGuidePayload {
  const fail = (msg: string): never => {
    throw new BadRequestException(msg);
  };

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title.length < 2) fail('Title is required.');
  if (title.length > 120) fail('Title is too long (max 120 characters).');

  const introRaw = typeof input.intro === 'string' ? input.intro.trim() : '';
  if (introRaw.length > 400) fail('Intro is too long (max 400 characters).');
  const intro = introRaw.length > 0 ? introRaw : null;

  if (!Array.isArray(input.points)) fail('Points must be a list.');
  const points = (input.points as unknown[])
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0);
  if (points.length < 1) fail('Add at least one point.');
  if (points.length > 12) fail('Too many points (max 12).');
  for (const p of points) {
    if (p.length > 300) fail('A point is too long (max 300 characters each).');
  }

  const ctas: GuideCta[] = [];
  if (input.ctas != null) {
    if (!Array.isArray(input.ctas)) fail('CTAs must be a list.');
    const rawCtas = input.ctas as unknown[];
    if (rawCtas.length > 6) fail('Too many CTAs (max 6).');
    for (const c of rawCtas) {
      if (!c || typeof c !== 'object') fail('Each CTA must be an object.');
      const rec = c as Record<string, unknown>;
      const label = typeof rec.label === 'string' ? rec.label.trim() : '';
      if (label.length < 1) fail('Each CTA needs a label.');
      if (label.length > 60) fail('A CTA label is too long (max 60 characters).');
      const href = typeof rec.href === 'string' ? rec.href.trim() : '';
      const ask = typeof rec.ask === 'string' ? rec.ask.trim() : '';
      if (href && ask) fail(`CTA "${label}" cannot have both a link and a question.`);
      if (!href && !ask) fail(`CTA "${label}" needs either an internal link or a question.`);
      if (href) {
        if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) {
          fail(`CTA "${label}" link must be an internal path starting with "/".`);
        }
        ctas.push({ label, href });
      } else {
        if (ask.length > 300) fail(`CTA "${label}" question is too long (max 300 characters).`);
        ctas.push({ label, ask });
      }
    }
  }

  // House rule: never the word "escrow" in user-facing copy.
  const allText = [title, intro ?? '', ...points, ...ctas.flatMap((c) => [c.label, c.ask ?? ''])].join(' ');
  if (ESCROW_RE.test(allText)) {
    fail('Please avoid the word "escrow" — say "funds held" / "payment held" instead.');
  }

  return { title, intro, points, ctas };
}

@Injectable()
export class AskGgGuideService {
  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────── G5 admin surface ───────────────────────────────
  // All AdminJwtGuard-gated (ask-gg-guide-admin.controller.ts). The static
  // GUIDES catalog is the source of truth for WHICH keys exist; overrides only
  // change the CONTENT of an existing key.

  /** The full catalog: every static guide key + its override status. */
  async adminListGuides(): Promise<
    {
      key: string;
      defaultTitle: string;
      status: 'DEFAULT' | 'DRAFT' | 'PUBLISHED';
      publishedAt: Date | null;
      updatedAt: Date | null;
      updatedBy: string | null;
    }[]
  > {
    const overrides = await this.prisma.askGgGuideOverride.findMany({
      select: {
        key: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        updatedBy: true,
      },
    });
    const byKey = new Map(overrides.map((o) => [o.key, o]));
    return Object.values(GUIDES).map((g) => {
      const ov = byKey.get(g.key);
      return {
        key: g.key,
        defaultTitle: g.title,
        status: ov ? ov.status : 'DEFAULT',
        publishedAt: ov?.publishedAt ?? null,
        updatedAt: ov?.updatedAt ?? null,
        updatedBy: ov?.updatedBy ?? null,
      };
    });
  }

  /** One key: the shipped default + the current override (if any). */
  async adminGetGuide(key: string) {
    if (!KNOWN_GUIDE_KEYS.has(key)) throw new NotFoundException('Unknown guide key.');
    const base = GUIDES[key];
    const ov = await this.prisma.askGgGuideOverride.findUnique({
      where: { key },
    });
    return {
      key,
      default: {
        title: base.title,
        intro: base.intro ?? null,
        points: base.points,
        ctas: base.ctas ?? [],
      },
      override: ov
        ? {
            title: ov.title,
            intro: ov.intro,
            points: ov.points,
            ctas: coerceCtas(ov.ctas) ?? [],
            status: ov.status,
            publishedAt: ov.publishedAt,
            updatedAt: ov.updatedAt,
            updatedBy: ov.updatedBy,
          }
        : null,
    };
  }

  /** Save the admin's content edit. Creates a DRAFT for a fresh key; on an
   *  existing row the STATUS is preserved (editing a PUBLISHED guide updates it
   *  live; a DRAFT stays a preview). Validated + house-rule-checked. */
  async adminSaveGuide(
    key: string,
    input: { title?: unknown; intro?: unknown; points?: unknown; ctas?: unknown },
    adminSub: string,
  ) {
    if (!KNOWN_GUIDE_KEYS.has(key)) throw new NotFoundException('Unknown guide key.');
    const clean = validateGuidePayload(input);
    const row = await this.prisma.askGgGuideOverride.upsert({
      where: { key },
      create: {
        key,
        title: clean.title,
        intro: clean.intro,
        points: clean.points,
        ctas: clean.ctas as unknown as object,
        status: 'DRAFT',
        updatedBy: adminSub,
      },
      update: {
        title: clean.title,
        intro: clean.intro,
        points: clean.points,
        ctas: clean.ctas as unknown as object,
        updatedBy: adminSub,
      },
    });
    return { key: row.key, status: row.status };
  }

  /** Take the saved draft live. Requires an existing override row. */
  async adminPublishGuide(key: string, adminSub: string) {
    if (!KNOWN_GUIDE_KEYS.has(key)) throw new NotFoundException('Unknown guide key.');
    const existing = await this.prisma.askGgGuideOverride.findUnique({
      where: { key },
      select: { id: true },
    });
    if (!existing) {
      throw new BadRequestException('Nothing to publish — save the guide first.');
    }
    const row = await this.prisma.askGgGuideOverride.update({
      where: { key },
      data: { status: 'PUBLISHED', publishedAt: new Date(), updatedBy: adminSub },
    });
    return { key: row.key, status: row.status };
  }

  /** Pull a published guide back to DRAFT — users revert to the shipped
   *  default, but the draft is kept for further editing. */
  async adminUnpublishGuide(key: string, adminSub: string) {
    if (!KNOWN_GUIDE_KEYS.has(key)) throw new NotFoundException('Unknown guide key.');
    const existing = await this.prisma.askGgGuideOverride.findUnique({
      where: { key },
      select: { id: true },
    });
    if (!existing) throw new BadRequestException('No override to unpublish.');
    const row = await this.prisma.askGgGuideOverride.update({
      where: { key },
      data: { status: 'DRAFT', publishedAt: null, updatedBy: adminSub },
    });
    return { key: row.key, status: row.status };
  }

  /** Discard the override entirely — revert to the shipped default. */
  async adminResetGuide(key: string) {
    if (!KNOWN_GUIDE_KEYS.has(key)) throw new NotFoundException('Unknown guide key.');
    await this.prisma.askGgGuideOverride
      .delete({ where: { key } })
      .catch(() => undefined); // already default → no-op
    return { key, status: 'DEFAULT' as const };
  }
}
