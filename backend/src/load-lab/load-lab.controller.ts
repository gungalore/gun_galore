import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ComponentDataService } from './component-data.service';
import { LoadLabService, LoadLabInput } from './load-lab.service';
import { RecommendedLoadsService } from './recommended-loads.service';
import { BurnChartService } from './burn-chart.service';

/**
 * Load Lab HTTP surface. The interactive panel calls /compute directly (no
 * LLM); the pickers call /search. PRO-gated to match the operator decision
 * (FREE/MEMBER get the upgrade nudge, like the ballistic calculator tool).
 */
@UseGuards(ClerkGuard)
@Controller('load-lab')
export class LoadLabController {
  constructor(
    private readonly loadLab: LoadLabService,
    private readonly components: ComponentDataService,
    private readonly recommended: RecommendedLoadsService,
    private readonly burnChart: BurnChartService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Powder burn-rate chart (cross-manufacturer ranking, fast → slow) with each
   * powder tagged for whether we hold published loads. Reference data — served
   * to any signed-in reloader (not PRO-gated like the engine). Powers the
   * "Powder Chart" surface on the Load Lab page.
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

  @Get('search')
  async search(
    @Query('kind') kind: string,
    @Query('q') q?: string,
    @Query('groove') groove?: string,
  ) {
    const query = q ?? '';
    if (kind === 'cartridge') return this.components.searchCartridges(query);
    if (kind === 'powder') return this.components.searchPowders(query);
    if (kind === 'bullet')
      return this.components.searchBullets(
        query,
        15,
        groove ? parseFloat(groove) : undefined,
      );
    return [];
  }

  @Post('compute')
  async compute(@CurrentUser() clerkId: string, @Body() body: LoadLabInput) {
    const tier = await this.tierOf(clerkId);
    if (tier !== 'PRO') {
      return {
        upgradeRequired: true,
        reason:
          'The Load Lab is a Gun Galore PRO feature. Upgrade to run load predictions.',
      };
    }
    const result = this.loadLab.compute(body);
    // SAFETY cross-check — compare the entered charge against our PUBLISHED
    // manual-max data (authoritative), independent of the engine's pressure
    // estimate. Attached so the panel can render a hard over-max warning. Never
    // blocks the calculation itself.
    const bullet = this.components.getBullet(body.bulletId);
    const bulletWeightGr = bullet?.gmass ?? 0;
    const maxChargeCheck =
      bulletWeightGr > 0
        ? await this.recommended.maxChargeCheck(
            body.cartridge,
            bulletWeightGr,
            body.powderName,
            body.chargeGr,
          )
        : null;
    return { ...result, maxChargeCheck };
  }

  /**
   * Recommended published loads for a cartridge + bullet weight (±tolerance,
   * default 5gr), quoted from the manual library. PRO-gated like /compute.
   * Powers the Load Lab right-hand "Recommended loads" panel.
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
