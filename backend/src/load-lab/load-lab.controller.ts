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
    private readonly prisma: PrismaService,
  ) {}

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
    return this.loadLab.compute(body);
  }

  private async tierOf(clerkId: string): Promise<string> {
    const u = await this.prisma.user.findUnique({
      where: { clerkId },
      select: { subscriptionTier: true },
    });
    return u?.subscriptionTier ?? 'FREE';
  }
}
