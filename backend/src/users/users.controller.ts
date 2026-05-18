import {
  Controller,
  Get,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';

@Controller('users')
@UseGuards(ClerkGuard)
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get('me')
  async me(@CurrentUser() clerkId: string) {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        sellerTier: true,
        kycStatus: true,
        kycVerifiedAt: true,
        trustScore: true,
        averageRating: true,
        totalSales: true,
        createdAt: true,
      },
    });
    return user;
  }

  @Post('kyc')
  @UseInterceptors(FileInterceptor('document', { storage: memoryStorage() }))
  async submitKyc(
    @CurrentUser() clerkId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }), // 10 MB
          new FileTypeValidator({ fileType: /image\/(jpeg|png|webp)|application\/pdf/ }),
        ],
      }),
    )
    file: Express.Multer.File,
  ) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.kycStatus === 'VERIFIED') throw new BadRequestException('KYC already verified');

    const { url } = await this.cloudinary.uploadImage(file.buffer, 'kyc-documents');

    await this.prisma.user.update({
      where: { clerkId },
      data: {
        kycStatus: 'PENDING',
        kycDocumentUrl: url,
      },
    });

    return { submitted: true, status: 'PENDING' };
  }
}
