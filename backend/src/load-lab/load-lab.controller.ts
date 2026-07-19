import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RecommendedLoadsService } from './recommended-loads.service';
import { BurnChartService } from './burn-chart.service';
import { ManualBrowseService } from './manual-browse.service';

/**
 * Load Lab HTTP surface. Serves the PRO-gated published manual-load browser
 * (calibre hierarchy → all loads for a cartridge) + the free powder burn-rate
 * chart. The internal-ballistics calculator was removed 2026-07-13 (operator
 * decision) — Load Lab is manual data only now.
 */
@UseGuards(ClerkGuard)
@Controller('load-lab')
export class LoadLabController {
  constructor(
    private readonly recommended: RecommendedLoadsService,
    private readonly burnChart: BurnChartService,
    private readonly manualBrowse: ManualBrowseService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Powder burn-rate chart (cross-manufacturer ranking, fast → slow) with each
   * powder tagged for whether we hold published loads. Reference data — served
   * to any signed-in reloader (not PRO-gated). Powers the "Powder chart" tab.
   */
  @Get('burn-chart')
  async burnChartData() {
    return this.burnChart.getChart();
  }

  /** Top cartridges that use a powder, with the published bullet-weight range.
   *  `keys` is comma-separated (a chart cell can hold several manual name
   *  variants of one powder); `key` kept for single-key back-compat. */
  @Get('powder-cartridges')
  async powderCartridges(@Query('keys') keys?: string, @Query('key') key?: string) {
    const list = (keys ?? key ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return { keys: [], cartridges: [] };
    return { keys: list, cartridges: await this.burnChart.getPowderCartridges(list) };
  }

  /** Which powders we hold published loads for, for a cartridge (highlighting). */
  @Get('cartridge-powders')
  async cartridgePowders(@Query('cartridge') cartridge: string) {
    if (!cartridge) return { cartridgeKey: '', cartridge: '', powderKeys: [] };
    return this.burnChart.getCartridgePowders(cartridge);
  }

  /** Cartridge typeahead for the chart search bar (Meilisearch-backed). */
  @Get('cartridge-search')
  async cartridgeSearch(@Query('q') q: string) {
    return { hits: await this.burnChart.searchCartridges(q ?? '') };
  }

  /**
   * The calibre hierarchy for the "Load data" browser — every cartridge we hold
   * published manual data for, grouped into calibre families, with per-cartridge
   * load counts. PRO-gated.
   */
  @Get('manual-cartridges')
  async manualCartridges(@CurrentUser() clerkId: string) {
    // FREE demo (2026-07-19): everyone browses the calibre tree — the tree
    // is the lure; the load DATA is the PRO value (capped below).
    await this.tierOf(clerkId); // still requires a signed-in, synced user
    return this.manualBrowse.listCartridges();
  }

  /**
   * All published manual loads for one cartridge (by canonical key), grouped by
   * bullet weight → powder, each with a source manual + page citation. PRO-gated.
   */
  @Get('manual-loads')
  async manualLoads(@CurrentUser() clerkId: string, @Query('cartridgeKey') cartridgeKey: string) {
    const tier = await this.tierOf(clerkId);
    const full = await this.manualBrowse.loadsForCartridge(cartridgeKey ?? '');
    if (tier === 'PRO') return full;
    // FREE demo (2026-07-19): the first bullet-weight group with its first
    // 3 loads is shown; the rest is counted but withheld. Enough to prove
    // the data is real, not enough to reload from.
    const groups = Array.isArray(full.groups) ? full.groups : [];
    const firstGroup = groups[0]
      ? [
          {
            ...(groups[0] as Record<string, unknown>),
            loads: ((groups[0] as { loads?: unknown[] }).loads ?? []).slice(0, 3),
          },
        ]
      : [];
    return {
      ...full,
      groups: firstGroup,
      demo: true,
      upgradeReason:
        'You are previewing 3 of the published loads for this calibre. Gun Galore PRO unlocks all of them, with source manual + page citations.',
    };
  }

  /**
   * Reference chamber/pressure spec for a cartridge (GRT-derived, match-
   * verified). Standard, max pressure, case + overall length, case capacity,
   * and the official CIP/SAAMI datasheet link. Served to ANY signed-in
   * reloader (not PRO-gated) — it's standardised reference data, not a load
   * recipe, and a rich cartridge page is a stronger free surface than a
   * paywall. Returns null when we hold no verified spec (wildcats, etc.).
   */
  @Get('cartridge-spec')
  async cartridgeSpec(
    @CurrentUser() clerkId: string,
    @Query('cartridgeKey') cartridgeKey: string,
  ) {
    await this.tierOf(clerkId); // signed-in gate only
    if (!cartridgeKey) return { spec: null };
    const spec = await this.prisma.cartridgeSpec.findUnique({
      where: { cartridgeKey },
    });
    return { spec };
  }

  /**
   * Recommended published loads for a cartridge + bullet weight (±tolerance,
   * default 5gr), quoted from the manual library. PRO-gated. Still served for
   * the Ask GG `lookupPublishedLoads` tool parity path.
   */
  @Get('recommended-loads')
  async recommendedLoads(
    @CurrentUser() clerkId: string,
    @Query('cartridge') cartridge: string,
    @Query('bulletWeightGr') bulletWeightGr: string,
    @Query('toleranceGr') toleranceGr?: string,
  ) {
    const tier = await this.tierOf(clerkId);
    if (tier !== 'PRO') {
      return {
        upgradeRequired: true,
        reason:
          'Recommended loads are a Gun Galore PRO feature. Upgrade to see published manual loads.',
      };
    }
    const w = parseFloat(bulletWeightGr);
    if (!cartridge || !(w > 0)) {
      return {
        cartridge: cartridge ?? '',
        bulletWeightGr: Number.isFinite(w) ? w : 0,
        toleranceGr: 5,
        notIndexed: true,
        powders: [],
        sources: [],
      };
    }
    const tol = toleranceGr ? parseFloat(toleranceGr) : 5;
    return this.recommended.recommend(cartridge, w, tol);
  }

  private async tierOf(clerkId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { subscriptionTier: true },
    });
    return u?.subscriptionTier ?? 'FREE';
  }
}
