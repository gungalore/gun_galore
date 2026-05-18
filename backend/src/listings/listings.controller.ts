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
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { BrowseListingsDto } from './dto/browse-listings.dto';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('listings')
export class ListingsController {
  constructor(private readonly listingsService: ListingsService) {}

  // --- Public ---

  @Get()
  browse(@Query() dto: BrowseListingsDto) {
    return this.listingsService.browse(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.listingsService.findById(id);
  }

  // --- Protected ---

  @Post()
  @UseGuards(ClerkGuard)
  create(@CurrentUser() clerkId: string, @Body() dto: CreateListingDto) {
    return this.listingsService.create(clerkId, dto);
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
