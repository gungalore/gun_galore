import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { toCsv } from '../common/csv.util';
import {
  coalFlags,
  THUMB_DIM_FIELDS,
  type BenchView,
  type LoadsResponse,
  type PublicLoadGroup,
  type PublicLoadRow,
} from './bench.types';

/** What a guest sends instead of a stored bench. */
export interface GuestBench {
  powderIds?: string[];
  bullets?: { maker: string; weightGr: number; category: string }[];
  cartridgeKeys?: string[];
}

@Injectable()
export class BenchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Clerk subject → User.id.
   *
   * ⚠️ THESE ARE NOT THE SAME STRING AND TYPESCRIPT CANNOT TELL THEM APART.
   * `@CurrentUser()` hands back the Clerk `sub`; `UserBench.userId` is a cuid
   * from our own User table. Both are `string`, so swapping them compiles
   * cleanly and then silently reads or writes the wrong person's bench — or,
   * more often, nobody's, which looks like "my shelf keeps emptying".
   * Every entry point into this service resolves the sub through here first.
   */
  private async resolveUserId(clerkSub: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId: clerkSub },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('No member for this session');
    return user.id;
  }

  /* ── The bench itself ──────────────────────────────────────────────── */

  async getBench(clerkSub: string): Promise<BenchView> {
    const userId = await this.resolveUserId(clerkSub);
    const row = await this.prisma.userBench.findUnique({ where: { userId } });

    // A member who has never opened the page gets an empty bench rather than
    // a 404: "you have nothing on your shelf yet" is a state, not an error.
    if (!row) return { powders: [], bullets: [], cartridges: [], units: 'metric' };

    const [powders, cartridges] = await Promise.all([
      this.prisma.benchPowder.findMany({
        where: { id: { in: row.powderIds } },
        select: { id: true, name: true, maker: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.benchCartridge.findMany({
        where: { key: { in: row.cartridgeKeys } },
        select: { key: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      powders,
      // Prisma types this column as JsonValue; the shape is ours to promise,
      // so the cast goes through unknown rather than pretending the two
      // types overlap. Array.isArray is the actual guard.
      bullets: Array.isArray(row.bullets) ? (row.bullets as unknown as BenchView['bullets']) : [],
      cartridges,
      units: row.units,
    };
  }

  async putBench(
    clerkSub: string,
    body: { powderIds?: string[]; bullets?: unknown; cartridgeKeys?: string[]; units?: string },
  ): Promise<BenchView> {
    const userId = await this.resolveUserId(clerkSub);
    const data = {
      powderIds: body.powderIds ?? [],
      bullets: (body.bullets ?? []) as object,
      cartridgeKeys: body.cartridgeKeys ?? [],
      units: body.units === 'imperial' ? 'imperial' : 'metric',
    };
    await this.prisma.userBench.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.getBench(clerkSub);
  }

  /* ── The answer the page exists for ────────────────────────────────── */

  /**
   * Consolidated loads buildable from a bench.
   *
   * The shelf is an AND across three axes: a load shows only if the reloader
   * has the powder AND a bullet matching maker + weight + category AND the
   * cartridge. Anything looser would answer a different question — "loads that
   * exist" rather than "loads I can make tonight" — which is the whole point
   * of the screen.
   */
  async loads(
    bench: GuestBench,
    filter: { cartridgeKey?: string; weightMin?: number; weightMax?: number; powderId?: string },
  ): Promise<LoadsResponse> {
    const powderIds = bench.powderIds ?? [];
    const cartridgeKeys = bench.cartridgeKeys ?? [];
    const bullets = bench.bullets ?? [];

    // An empty shelf is an empty answer, not the whole database. Returning
    // everything would bury the one thing the page is for.
    if (powderIds.length === 0 || cartridgeKeys.length === 0 || bullets.length === 0) {
      return { count: 0, groups: [] };
    }

    const rows = await this.prisma.benchLoad.findMany({
      where: {
        cartridgeKey: filter.cartridgeKey
          ? { equals: filter.cartridgeKey }
          : { in: cartridgeKeys },
        powderId: filter.powderId ? { equals: filter.powderId } : { in: powderIds },
        // The bullet axis: any of the shelf's maker+weight+category triples.
        OR: bullets.map((b) => ({
          bulletMaker: b.maker,
          weightGr: b.weightGr,
          bulletCategory: b.category,
        })),
        ...(filter.weightMin !== undefined || filter.weightMax !== undefined
          ? {
              weightGr: {
                ...(filter.weightMin !== undefined ? { gte: filter.weightMin } : {}),
                ...(filter.weightMax !== undefined ? { lte: filter.weightMax } : {}),
              },
            }
          : {}),
      },
      // ⚠️ AN EXPLICIT SELECT, NOT AN INCLUDE. sourcesCount and the
      // BenchSourceLoad relation must never reach a response, and the surest
      // way to keep that true as this query grows is to never fetch them.
      select: {
        id: true,
        cartridgeKey: true,
        bulletMaker: true,
        bulletType: true,
        weightGr: true,
        startGr: true,
        startFps: true,
        maxGr: true,
        maxFps: true,
        coalMm: true,
        coalLoMm: true,
        coalHiMm: true,
        powder: { select: { name: true } },
        cartridge: {
          select: {
            key: true,
            name: true,
            maxLengthMm: true,
            pmaxBar: true,
            pmaxPsi: true,
            dims: { select: Object.fromEntries(THUMB_DIM_FIELDS.map((f) => [f, true])) as never },
          },
        },
      },
      orderBy: [{ weightGr: 'asc' }],
    });

    // Bench order for cartridges, then weight ascending, then powder name.
    const order = new Map(cartridgeKeys.map((k, i) => [k, i]));
    const byCartridge = new Map<string, PublicLoadGroup>();

    for (const r of rows) {
      const head = byCartridge.get(r.cartridgeKey) ?? {
        cartridge: {
          key: r.cartridge.key,
          name: r.cartridge.name,
          maxLengthMm: r.cartridge.maxLengthMm,
          pmaxBar: r.cartridge.pmaxBar,
          pmaxPsi: r.cartridge.pmaxPsi,
          thumb: (r.cartridge.dims as Record<string, number | null> | null) ?? null,
        },
        weights: [],
      };

      const row: PublicLoadRow = {
        id: r.id,
        bulletMaker: r.bulletMaker,
        bulletType: r.bulletType,
        powder: r.powder.name,
        startGr: r.startGr,
        startFps: r.startFps,
        maxGr: r.maxGr,
        maxFps: r.maxFps,
        coalMm: r.coalMm,
        coalLoMm: r.coalLoMm,
        coalHiMm: r.coalHiMm,
        flags: coalFlags(r, r.cartridge.maxLengthMm),
      };

      const group = head.weights.find((w) => w.weightGr === r.weightGr);
      if (group) group.rows.push(row);
      else head.weights.push({ weightGr: r.weightGr, rows: [row] });

      byCartridge.set(r.cartridgeKey, head);
    }

    const groups = [...byCartridge.values()].sort(
      (a, b) => (order.get(a.cartridge.key) ?? 999) - (order.get(b.cartridge.key) ?? 999),
    );
    for (const g of groups) {
      g.weights.sort((a, b) => a.weightGr - b.weightGr);
      for (const w of g.weights) w.rows.sort((a, b) => a.powder.localeCompare(b.powder));
    }

    return { count: rows.length, groups };
  }

  /* ── The powder picker ─────────────────────────────────────────────── */

  async powders(q: string | undefined, bench: GuestBench | null) {
    const list = await this.prisma.benchPowder.findMany({
      where: q ? { name: { contains: q, mode: 'insensitive' } } : undefined,
      select: { id: true, name: true, maker: true },
      orderBy: { name: 'asc' },
      take: 300,
    });

    // Without a bench there is nothing to count against, and a zero would
    // read as "this powder has no loads" rather than "you have no shelf".
    if (!bench || !(bench.cartridgeKeys?.length && bench.bullets?.length)) return list;

    const counts = await this.prisma.benchLoad.groupBy({
      by: ['powderId'],
      where: {
        cartridgeKey: { in: bench.cartridgeKeys },
        OR: bench.bullets.map((b) => ({
          bulletMaker: b.maker,
          weightGr: b.weightGr,
          bulletCategory: b.category,
        })),
      },
      _count: { _all: true },
    });
    const byId = new Map(counts.map((c) => [c.powderId, c._count._all]));
    return list.map((p) => ({ ...p, loadsForBench: byId.get(p.id) ?? 0 }));
  }

  /* ── The spec card ─────────────────────────────────────────────────── */

  async cartridge(key: string, bench: GuestBench | null) {
    const cartridge = await this.prisma.benchCartridge.findUnique({
      where: { key },
      select: {
        key: true,
        name: true,
        slug: true,
        type: true,
        origin: true,
        year: true,
        caseLengthMm: true,
        maxLengthMm: true,
        pmaxPsi: true,
        pmaxBar: true,
        dims: true,
      },
    });
    if (!cartridge) throw new NotFoundException('Unknown cartridge');

    const [loadCount, loadsForBench] = await Promise.all([
      this.prisma.benchLoad.count({ where: { cartridgeKey: key } }),
      bench?.powderIds?.length && bench.bullets?.length
        ? this.prisma.benchLoad.count({
            where: {
              cartridgeKey: key,
              powderId: { in: bench.powderIds },
              OR: bench.bullets.map((b) => ({
                bulletMaker: b.maker,
                weightGr: b.weightGr,
                bulletCategory: b.category,
              })),
            },
          })
        : Promise.resolve(0),
    ]);

    const { dims, ...rest } = cartridge;
    return {
      cartridge: rest,
      // ⚠️ rawText is stripped. It is the sheet's own text block, kept for
      // audit, and it is the one field on this model that would put a
      // published page into a response.
      dims: dims ? this.stripAudit(dims) : null,
      stations: [],
      shellHolderGroup: [],
      loadCount,
      loadsForBench,
    };
  }

  private stripAudit<T extends Record<string, unknown>>(dims: T) {
    const { rawText, ...safe } = dims as T & { rawText?: string };
    return safe;
  }

  /* ── The log ───────────────────────────────────────────────────────── */

  async log(clerkSub: string) {
    const userId = await this.resolveUserId(clerkSub);
    const rows = await this.prisma.benchLogEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    // The row stores only the key, and a key is not a thing to show someone —
    // "65creedmoor" is not what they loaded. Resolved here rather than in the
    // client so the CSV and the list agree.
    const names = new Map(
      (
        await this.prisma.benchCartridge.findMany({
          where: { key: { in: [...new Set(rows.map((r) => r.cartridgeKey))] } },
          select: { key: true, name: true },
        })
      ).map((c) => [c.key, c.name]),
    );

    // userId never goes back out — the caller already knows who they are.
    return rows.map(({ userId: _omit, ...rest }) => ({
      ...rest,
      cartridgeName: names.get(rest.cartridgeKey) ?? rest.cartridgeKey,
    }));
  }

  /**
   * The log as a CSV the member can keep.
   *
   * ⚠️ EVERY FIELD IS ESCAPED, INCLUDING THE ONES THAT LOOK SAFE. `notes` is
   * free text a member typed, so it can hold a comma, a quote or a newline;
   * unescaped, one note shifts every following column and the file silently
   * stops meaning what it says.
   */
  async logCsv(clerkSub: string) {
    const rows = await this.log(clerkSub);
    const head = [
      'Date', 'Cartridge', 'Bullet', 'Powder', 'Charge (gr)', 'COAL (mm)',
      'Primer', 'Case', 'Velocity (m/s)', 'Group (mm)', 'Notes',
    ];
    // toCsv from common/csv.util rather than a local escape: the seller
    // statement, the admin export and the payout CSV all quote identically,
    // and a fourth hand-rolled version is a fourth chance to get free-text
    // notes wrong.
    return {
      csv: toCsv([
        head,
        ...rows.map((r) => [
          r.shotAt.toISOString().slice(0, 10),
          r.cartridgeName,
          r.bulletLabel,
          r.powderName,
          r.chargeGr,
          r.coalMm,
          r.primer,
          r.caseLabel,
          r.velocityMs,
          r.groupMm,
          r.notes,
        ]),
      ]),
      filename: 'the-bench-load-log.csv',
    };
  }

  async addLog(clerkSub: string, body: Record<string, unknown>) {
    const userId = await this.resolveUserId(clerkSub);
    const row = await this.prisma.benchLogEntry.create({
      data: {
        userId,
        cartridgeKey: String(body.cartridgeKey ?? ''),
        bulletLabel: String(body.bulletLabel ?? ''),
        powderName: String(body.powderName ?? ''),
        chargeGr: Number(body.chargeGr ?? 0),
        coalMm: body.coalMm === undefined ? null : Number(body.coalMm),
        primer: body.primer ? String(body.primer) : null,
        caseLabel: body.caseLabel ? String(body.caseLabel) : null,
        loadId: body.loadId ? String(body.loadId) : null,
        velocityMs: body.velocityMs === undefined ? null : Number(body.velocityMs),
        groupMm: body.groupMm === undefined ? null : Number(body.groupMm),
        notes: body.notes ? String(body.notes) : null,
        // The sheet offers a date, so it has to be honoured; without this the
        // column defaults to now() and a load logged for last weekend silently
        // files itself under today. An unparseable value falls back to the
        // default rather than throwing.
        ...(body.shotAt && !Number.isNaN(Date.parse(String(body.shotAt)))
          ? { shotAt: new Date(String(body.shotAt)) }
          : {}),
      },
    });
    const { userId: _omit, ...rest } = row;
    return rest;
  }

  async deleteLog(clerkSub: string, id: string) {
    const userId = await this.resolveUserId(clerkSub);
    // Scoped by userId as well as id: an id alone would let one member delete
    // another's log row by guessing a cuid.
    await this.prisma.benchLogEntry.deleteMany({ where: { id, userId } });
    return { ok: true };
  }
}
