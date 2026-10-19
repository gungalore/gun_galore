import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ListingInquiriesService } from './listing-inquiries.service';

/**
 * Buyer side of the private "Contact seller" thread on a listing.
 * Scoped under `/listings/:id/inquiry` so the PDP can fetch its own thread
 * without an extra id. Seller-only writes live in MyInquiriesController.
 */
@Controller('listings')
@UseGuards(AuthGuard)
export class ListingInquiriesController {
  constructor(private readonly inquiries: ListingInquiriesService) {}

  // The viewer's thread on this listing, or { inquiry: null }. The listing's
  // seller gets { inquiry: null, sellerInbox: { open, unread } } instead.
  @Get(':id/inquiry')
  get(@Param('id') listingId: string, @CurrentUser() userId: string) {
    return this.inquiries.getForListing(listingId, userId);
  }

  // Buyer sends the first (or a subsequent) message. Creates the thread on
  // the first send. Tight throttle: every send runs the Jev text battery.
  @Post(':id/inquiry/messages')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  send(
    @Param('id') listingId: string,
    @CurrentUser() userId: string,
    @Body() body: { content?: string },
  ) {
    return this.inquiries.sendAsBuyer(
      listingId,
      userId,
      body?.content ?? '',
    );
  }
}

/**
 * The member's inbox of listing inquiries — both directions (as buyer and as
 * seller), plus the thread and the seller-only media reply.
 */
@Controller('me/inquiries')
@UseGuards(AuthGuard)
export class MyInquiriesController {
  constructor(private readonly inquiries: ListingInquiriesService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.inquiries.listForMe(userId);
  }

  // Full thread, oldest → newest. Marks the counterparty's messages read.
  @Get(':inquiryId')
  thread(
    @Param('inquiryId') inquiryId: string,
    @CurrentUser() userId: string,
  ) {
    return this.inquiries.getThread(inquiryId, userId);
  }

  @Post(':inquiryId/messages')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  send(
    @Param('inquiryId') inquiryId: string,
    @CurrentUser() userId: string,
    @Body() body: { content?: string },
  ) {
    return this.inquiries.sendMessage(
      inquiryId,
      userId,
      body?.content ?? '',
    );
  }

  // SELLER-ONLY. Up to 4 images and/or 1 video; screened before storage.
  @Post(':inquiryId/media')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'images', maxCount: 4 },
        { name: 'video', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        // Video ceiling; images carry a tighter 8 MB check in the service.
        limits: { fileSize: 64 * 1024 * 1024 },
      },
    ),
  )
  media(
    @Param('inquiryId') inquiryId: string,
    @CurrentUser() userId: string,
    @UploadedFiles()
    files: {
      images?: Express.Multer.File[];
      video?: Express.Multer.File[];
    },
  ) {
    return this.inquiries.sendMedia(inquiryId, userId, {
      images: files?.images,
      video: files?.video?.[0],
    });
  }
}
