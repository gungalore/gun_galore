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
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ComplaintsService } from './complaints.service';

@Controller('complaints')
@UseGuards(AuthGuard)
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Post()
  create(
    @CurrentUser() userId: string,
    @Body()
    body: {
      category: string;
      subject: string;
      body: string;
      transactionId?: string | null;
      photos?: { url: string; publicId: string }[];
    },
  ) {
    return this.complaints.create(userId, body);
  }

  // Upload one evidence photo BEFORE lodging the dispute. The dispute form
  // uploads here, then passes the returned pointers to POST /complaints.
  @Post('evidence')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage() }))
  uploadEvidence(
    @CurrentUser() userId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 25 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)|video\/(mp4|webm)/ }),
        ],
      }),
    )
    file: { buffer: Buffer; mimetype: string },
  ) {
    return this.complaints.uploadEvidence(userId, file);
  }

  @Get('mine')
  mine(@CurrentUser() userId: string) {
    return this.complaints.listMine(userId);
  }

  // Attach an evidence photo. Same size/type guard as listing images
  // (8MB, jpeg/png/webp), streamed to Cloudinary server-side.
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage() }))
  addPhoto(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 8 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)/ }),
        ],
      }),
    )
    file: { buffer: Buffer },
  ) {
    return this.complaints.addPhoto(userId, id, file);
  }
}
