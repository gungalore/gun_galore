import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { OptionalClerkGuard } from '../auth/optional-clerk.guard';

@Module({
  controllers: [CategoriesController],
  // OptionalClerkGuard MUST be provided here, not just imported in the
  // controller: a guard referenced by a controller whose module doesn't
  // provide it is a boot-time crash-loop that tsc happily compiles.
  providers: [CategoriesService, OptionalClerkGuard],
  exports: [CategoriesService],
})
export class CategoriesModule {}
