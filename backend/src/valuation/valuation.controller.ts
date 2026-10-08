import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  MaxFileSizeValidator,
  MessageEvent,
  Param,
  ParseFilePipe,
  Post,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { CreateValuationDto } from './dto/create-valuation.dto';
import { RecordOutcomeDto } from './dto/record-outcome.dto';
import { SaveAnswersDto } from './dto/save-answers.dto';
import { UploadPhotoDto } from './dto/upload-photo.dto';
import { ValuationEvents } from './events.service';
import { ValuationService } from './valuation.service';

const MAX_PHOTO_BYTES =
  Number(process.env.VALUATION_PHOTO_MAX_MB ?? 10) * 1024 * 1024;

@Controller('valuations')
@UseGuards(AuthGuard)
export class ValuationController {
  constructor(
    private readonly valuations: ValuationService,
    private readonly events: ValuationEvents,
  ) {}

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateValuationDto) {
    return this.valuations.create(userId, dto.description);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.valuations.getState(id, userId);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @CurrentUser() userId: string) {
    await this.valuations.remove(id, userId);
  }

  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage() }))
  addPhoto(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() dto: UploadPhotoDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_PHOTO_BYTES }),
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp|heic|heif)/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    return this.valuations.addPhoto(id, userId, file, {
      viewTag: dto.viewTag,
      source: dto.source,
    });
  }

  @Delete(':id/photos/:photoId')
  @HttpCode(204)
  async removePhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @CurrentUser() userId: string,
  ) {
    await this.valuations.removePhoto(id, userId, photoId);
  }

  @Post(':id/identify')
  identify(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateValuationDto,
  ) {
    return this.valuations.identify(id, userId, dto.description);
  }

  @Post(':id/answers')
  saveAnswers(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() dto: SaveAnswersDto,
  ) {
    return this.valuations.saveAnswers(
      id,
      userId,
      dto.answers.map((a) => ({
        questionId: a.questionId,
        selected: a.selected ?? [],
        custom: a.custom ?? null,
        unsure: a.unsure,
      })),
    );
  }

  @Post(':id/research')
  @HttpCode(202)
  startResearch(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.valuations.startResearch(id, userId);
  }

  @Sse(':id/research-events')
  researchEvents(@Param('id') id: string): Observable<MessageEvent> {
    return this.events.researchStream(id).pipe(
      map((event) => ({ data: event }) as MessageEvent),
    );
  }

  @Sse(':id/capture-events')
  captureEvents(@Param('id') id: string): Observable<MessageEvent> {
    return this.events.captureStream(id).pipe(
      map((event) => ({ data: event }) as MessageEvent),
    );
  }

  @Post(':id/capture-session')
  startCaptureSession(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.valuations.startCaptureSession(id, userId);
  }

  @Post(':id/capture-session/close')
  closeCaptureSession(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.valuations.closeCaptureSession(id, userId);
  }

  @Get(':id/listing-draft')
  listingDraft(@Param('id') id: string, @CurrentUser() userId: string) {
    return this.valuations.listingDraft(id, userId);
  }

  @Post(':id/outcome')
  recordOutcome(
    @Param('id') id: string,
    @CurrentUser() userId: string,
    @Body() dto: RecordOutcomeDto,
  ) {
    return this.valuations.recordOutcome(id, userId, dto.listingId, dto.soldPriceCents, dto.soldAt);
  }
}
