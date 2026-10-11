import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../auth/auth.guard';
import { CacheService } from './cache.service';
import { CaptureController } from './capture.controller';
import { CategoryConfigs } from './config/category-configs';
import { CompService } from './comp.service';
import { ExifService } from './exif.service';
import { ValuationEvents } from './events.service';
import { IdentifyService } from './identify.service';
import { ImageSelectService } from './image-select.service';
import { QuestionService } from './question.service';
import { ResearchService } from './research.service';
import { ValuationRetentionService } from './retention.service';
import { SerperClient } from './sources/serper.client';
import { ApifyClient } from './sources/apify-client';
import { ApifyMarketplaceAdapter } from './sources/adapters/apify-marketplace.adapter';
import { GunAfricaAdapter } from './sources/adapters/gunafrica.adapter';
import { MagentoAdapter } from './sources/adapters/magento.adapter';
import { SitemapJsonLdAdapter } from './sources/adapters/sitemap-jsonld.adapter';
import { ShopifyAdapter } from './sources/adapters/shopify.adapter';
import { WooAdapter } from './sources/adapters/woo.adapter';
import { ExternalSourceService } from './sources/external-source.service';
import { JevMatchService } from './sources/jev-match';
import { SoldCompsService } from './sold-comps.service';
import { ValuationController } from './valuation.controller';
import { ValuationService } from './valuation.service';
import { WebToolsService } from './web-tools.service';

// ⚠️ GUARD DEPENDENCIES ARE PROVIDED LOCALLY (repo rule): Nest resolves a
// controller's @UseGuards classes inside the controller's OWN module.
// AuthGuard injects SessionService, hence the local provider and JwtModule.
// PrismaModule, CloudinaryModule and LlmModule are @Global.
@Module({
  imports: [JwtModule.register({})],
  controllers: [ValuationController, CaptureController],
  providers: [
    ValuationService,
    ExifService,
    CategoryConfigs,
    ImageSelectService,
    IdentifyService,
    QuestionService,
    ResearchService,
    CompService,
    CacheService,
    ValuationEvents,
    WebToolsService,
    SerperClient,
    ApifyClient,
    SoldCompsService,
    ShopifyAdapter,
    WooAdapter,
    GunAfricaAdapter,
    ApifyMarketplaceAdapter,
    SitemapJsonLdAdapter,
    MagentoAdapter,
    ExternalSourceService,
    JevMatchService,
    ValuationRetentionService,
    AuthGuard,
  ],
  exports: [ValuationService, CategoryConfigs],
})
export class ValuationModule {}
