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
    const tier = await this.tierOf(clerkId);
    if (tier !== 'PRO') {
      return {
        upgradeRequired: true,
        reason:
          'The Load Lab manual load-data browser is a Gun Galore PRO feature. Upgrade to browse published loads by calibre.',
      };
    }
    return this.manualBrowse.listCartridges();
  }

  /**
   * All published manual loads for one cartridge (by canonical key), grouped by
   * bullet weight → powder, each with a source manual + page citation. PRO-gated.
   */
  @Get('manual-loads')
  async manualLoads(@CurrentUser() clerkId: string, @Query('cartridgeKey') cartridgeKey: string) {
    const tier = await this.tierOf(clerkId);
    if (tier !== 'PRO') {
      return {
        upgradeRequired: true,
        reason:
          'Published load data is a Gun Galore PRO feature. Upgrade to see manual loads for this calibre.',
      };
    }
    return this.manualBrowse.loadsForCartridge(cartridgeKey ?? '');
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
