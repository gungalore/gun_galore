import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { RaffleService } from './raffle.service';

@Controller('admin/raffle')
@UseGuards(AdminJwtGuard)
export class RaffleAdminController {
  constructor(private readonly raffle: RaffleService) {}

  // Suggested budget + settings + draw history — the whole panel state.
  @Get()
  state() {
    return this.raffle.adminState();
  }

  @Post('image')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  uploadImage(@UploadedFile() file: Express.Multer.File) {
    return this.raffle.adminUploadImage(file);
  }

  @Post()
  create(
    @Body()
    dto: {
      title?: string;
      description?: string;
      prizeValueCents?: number;
      imageUrls?: string[];
      drawAt?: string;
    },
  ) {
    return this.raffle.adminCreateDraw(dto);
  }

  @Post(':id/fulfil')
  fulfil(@Param('id') id: string, @Body() body: { note?: string }) {
    return this.raffle.adminMarkFulfilled(id, body?.note);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.raffle.adminCancelDraw(id, body?.reason ?? '');
  }
}
