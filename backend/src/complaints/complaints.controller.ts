import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ComplaintsService } from './complaints.service';

@Controller('complaints')
@UseGuards(ClerkGuard)
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post()
  create(
    @CurrentUser() clerkId: string,
    @Body()
    body: {
      category: string;
      subject: string;
      body: string;
      transactionId?: string | null;
    },
  ) {
    return this.complaints.create(clerkId, body);
  }

  @Get('mine')
  mine(@CurrentUser() clerkId: string) {
    return this.complaints.listMine(clerkId);
  }

  // Attach an evidence photo. Same size/type guard as listing images
  // (8MB, jpeg/png/webp), streamed to Cloudinary server-side.
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage() }))
  addPhoto(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp|heic|heif)/ }),
        ],
      }),
    )
    file: { buffer: Buffer },
  ) {
    return this.complaints.addPhoto(clerkId, id, file);
  }
}
