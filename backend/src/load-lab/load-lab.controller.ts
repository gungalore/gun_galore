import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RecommendedLoadsService } from './recommended-loads.service';
import { BurnChartService } from './burn-chart.service';
import { ManualBrowseService } from './manual-browse.service';

/**
 * Load Lab HTTP surface. Serves the published manual-load browser
 * (calibre hierarchy → all loads for a cartridge) + the free powder burn-rate
 * chart. The internal-ballistics calculator was removed 2026-07-13 (operator
 * decision) — Load Lab is manual data only now.
 */
// ClerkGuard is the only gate: every route needs a signed-in user, and since
// 2026-08-26 none of them care WHICH user — the PRO tier check was removed and
// with it the per-request subscriptionTier lookup it needed.
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
   * load counts.
   */
  @Get('manual-cartridges')
  async manualCartridges() {
    return this.manualBrowse.listCartridges();
  }

  /**
   * All published manual loads for one cartridge (by canonical key), grouped by
   * bullet weight → powder, each with a source manual + page citation.
   *
   * UNGATED as of 2026-08-26. This used to serve PRO the full set and everyone
   * else a 3-load teaser with an `upgradeReason`. Load Lab moved into the
   * account area as a member tool and the operator removed the PRO gate
   * outright, so every signed-in reloader now gets the complete data. The
   * teaser shape (`demo` / `upgradeReason`) is gone from the response — any
   * client still branching on it will simply never see it.
   */
  @Get('manual-loads')
  async manualLoads(@Query('cartridgeKey') cartridgeKey: string) {
    return this.manualBrowse.loadsForCartridge(cartridgeKey ?? '');
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
  async cartridgeSpec(@Query('cartridgeKey') cartridgeKey: string) {
    if (!cartridgeKey) return { spec: null };
    const spec = await this.prisma.cartridgeSpec.findUnique({
      where: { cartridgeKey },
    });
    return { spec };
  }

  /**
   * Recommended published loads for a cartridge + bullet weight (±tolerance,
   * default 5gr), quoted from the manual library. UNGATED as of 2026-08-26 —
   * see manualLoads above.
   */
  @Get('recommended-loads')
  async recommendedLoads(
    @Query('cartridge') cartridge: string,
    @Query('bulletWeightGr') bulletWeightGr: string,
    @Query('toleranceGr') toleranceGr?: string,
  ) {
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

}
