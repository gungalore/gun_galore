import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { BrowseListingsDto } from './dto/browse-listings.dto';
import { PreviewListingDto } from './dto/preview-listing.dto';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  // --- Public ---
  // SkipThrottle on public reads: SSR fans these out from the Next.js
  // dev server (single localhost IP) and the default 60 req/min/IP
  // bucket trips immediately — apiFetch throws, page calls notFound(),
  // user sees a 404 on every listing. Writes downstream still throttle.

  @Get()
  @SkipThrottle()
  browse(@Query() dto: BrowseListingsDto) {
    return this.listingsService.browse(dto);
  }

  // --- Protected ---
  // IMPORTANT: this route MUST appear before @Get(':id') below. Nest
  // matches routes in declaration order — if @Get(':id') comes first,
  // it captures '/listings/mine' as id="mine" → 404 → /my/listings on
  // the frontend silently shows "No listings yet" even though the
  // seller has rows. That bug shipped once; don't reintroduce it.

  @Get('mine')
  @UseGuards(ClerkGuard)
  mine(@CurrentUser() clerkId: string) {
    return this.listingsService.findMine(clerkId);
  }

  @Get(':id')
  @SkipThrottle()
  findOne(@Param('id') id: string) {
    return this.listingsService.findById(id);
  }

  @Post()
  @UseGuards(ClerkGuard)
  create(@CurrentUser() clerkId: string, @Body() dto: CreateListingDto) {
    return this.listingsService.create(clerkId, dto);
  }

  // POST /listings/enhance-description — used by the "Enhance wording"
  // button on /listings/new before the listing exists. Returns the
  // rewritten text plus a flag for whether it changed. Auth-gated so
  // randoms can't burn through our Anthropic quota.
  @Post('enhance-description')
  @UseGuards(ClerkGuard)
  @HttpCode(200)
  enhanceDescription(
    @Body()
    body: {
      description?: string;
      title?: string;
      categoryId?: string;
      make?: string;
      model?: string;
      calibre?: string;
      condition?: string;
    },
  ) {
    return this.listingsService.enhanceDescription(body.description ?? '', {
      title: body.title,
      categoryId: body.categoryId,
      make: body.make,
      model: body.model,
      calibre: body.calibre,
      condition: body.condition,
    });
  }

  // POST /listings/preview — dry-run the moderation pipeline against draft
  // form data without persisting anything. The Sell form "Review listing"
  // button hits this; the response drives the preview screen (greyed-out
  // preview with prohibited content highlighted, or a clean confirm-publish).
  @Post('preview')
  @UseGuards(ClerkGuard)
  @HttpCode(200)
  preview(
    @CurrentUser() clerkId: string,
    @Body() dto: PreviewListingDto,
  ) {
    return this.listingsService.previewDraft(clerkId, dto);
  }

  @Patch(':id')
  @UseGuards(ClerkGuard)
  update(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.listingsService.update(id, clerkId, dto);
  }

  @Delete(':id')
  @UseGuards(ClerkGuard)
  @HttpCode(204)
  cancel(@Param('id') id: string, @CurrentUser() clerkId: string) {
    return this.listingsService.cancel(id, clerkId);
  }

  @Post(':id/images')
  @UseGuards(ClerkGuard)
  @UseInterceptors(FileInterceptor('image', { storage: memoryStorage() }))
  addImage(
    @Param('id') id: string,
    @CurrentUser() clerkId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 }), // 8 MB
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.listingsService.addImage(id, clerkId, file);
  }

  @Delete(':id/images/:imageId')
  @UseGuards(ClerkGuard)
  @HttpCode(204)
  removeImage(
    @Param('id') id: string,
    @Param('imageId') imageId: string,
    @CurrentUser() clerkId: string,
  ) {
    return this.listingsService.removeImage(id, imageId, clerkId);
  }
}
