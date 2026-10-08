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
    SoldCompsService,
    ValuationRetentionService,
    AuthGuard,
  ],
  exports: [ValuationService, CategoryConfigs],
})
export class ValuationModule {}
