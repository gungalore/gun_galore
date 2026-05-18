import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService, INDEXES } from '../search/search.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { BrowseListingsDto } from './dto/browse-listings.dto';
import { Listing, ListingStatus } from '@prisma/client';

@Injectable()
export class ListingsService {
  private readonly logger = new Logger(ListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async create(clerkId: string, dto: CreateListingDto): Promise<Listing> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not synced — try again in a moment');
    if (user.isBanned) throw new ForbiddenException('Account is suspended');

    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category || !category.isActive) {
      throw new BadRequestException('Invalid category');
    }

    if (
      dto.listingType === 'TAKE_A_SHOT' &&
      dto.autoAcceptThreshold !== undefined &&
      dto.autoAcceptThreshold >= dto.price
    ) {
      throw new BadRequestException('autoAcceptThreshold must be less than price');
    }

    // Claude moderation is a later phase — listings go ACTIVE immediately
    const listing = await this.prisma.listing.create({
      data: {
        sellerId: user.id,
        categoryId: dto.categoryId,
        title: dto.title,
        description: dto.description,
        price: dto.price,
        listingType: dto.listingType,
        status: ListingStatus.ACTIVE,
        condition: dto.condition,
        province: dto.province,
        isFirearm: category.isFirearm,
        make: dto.make,
        model: dto.model,
        calibre: dto.calibre,
        passFeeToBuyer: dto.passFeeToBuyer,
        autoAcceptThreshold: dto.autoAcceptThreshold,
      },
      include: { images: true, category: true },
    });

    await this.indexListing({ ...listing, category });
    return listing;
  }

  async browse(dto: BrowseListingsDto) {
    const { q, page = 1, limit = 20 } = dto;

    if (q && this.search.isConnected) {
      return this.browseViaSearch(dto);
    }
    return this.browseViaPrisma(dto);
  }

  private async browseViaSearch(dto: BrowseListingsDto) {
    const {
      q = '',
      page = 1,
      limit = 20,
      sort = 'newest',
      categoryId,
      categorySlug,
      listingType,
      condition,
      province,
      minPrice,
      maxPrice,
    } = dto;

    const filterParts: string[] = ['status = "ACTIVE"'];
    if (categoryId) filterParts.push(`categoryId = "${categoryId}"`);
    if (categorySlug) filterParts.push(`categorySlug = "${categorySlug}"`);
    if (listingType) filterParts.push(`listingType = "${listingType}"`);
    if (condition) filterParts.push(`condition = "${condition}"`);
    if (province) filterParts.push(`province = "${province}"`);
    if (minPrice !== undefined) filterParts.push(`price >= ${minPrice}`);
    if (maxPrice !== undefined) filterParts.push(`price <= ${maxPrice}`);

    const sortBy =
      sort === 'price_asc'
        ? ['price:asc']
        : sort === 'price_desc'
          ? ['price:desc']
          : ['createdAt:desc'];

    const result = await this.search.search(INDEXES.LISTINGS, q, {
      filter: filterParts.join(' AND '),
      sort: sortBy,
      offset: (page - 1) * limit,
      limit,
    });

    return {
      listings: result.hits,
      total: result.estimatedTotalHits ?? 0,
      page,
      limit,
    };
  }

  private async browseViaPrisma(dto: BrowseListingsDto) {
    const {
      page = 1,
      limit = 20,
      sort = 'newest',
      categoryId,
      categorySlug,
      listingType,
      condition,
      province,
      minPrice,
      maxPrice,
    } = dto;

    const where: Record<string, unknown> = { status: 'ACTIVE' };
    if (categoryId) where.categoryId = categoryId;
    if (categorySlug) where.category = { slug: categorySlug };
    if (listingType) where.listingType = listingType;
    if (condition) where.condition = condition;
    if (province) where.province = province;
    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceFilter: Record<string, number> = {};
      if (minPrice !== undefined) priceFilter.gte = minPrice;
      if (maxPrice !== undefined) priceFilter.lte = maxPrice;
      where.price = priceFilter;
    }

    const orderBy =
      sort === 'price_asc'
        ? { price: 'asc' as const }
        : sort === 'price_desc'
          ? { price: 'desc' as const }
          : { createdAt: 'desc' as const };

    const [listings, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          images: { where: { isPrimary: true }, take: 1 },
          category: { select: { id: true, name: true, slug: true } },
          seller: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              sellerTier: true,
            },
          },
        },
      }),
      this.prisma.listing.count({ where }),
    ]);

    return { listings, total, page, limit };
  }

  async findById(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        images: { orderBy: { order: 'asc' } },
        category: true,
        seller: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            avatarUrl: true,
            sellerTier: true,
            totalSales: true,
            createdAt: true,
          },
        },
      },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    return listing;
  }

  async update(id: string, clerkId: string, dto: UpdateListingDto) {
    const listing = await this.assertOwner(id, clerkId);

    if (
      listing.status === ListingStatus.SOLD ||
      listing.status === ListingStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot edit a sold or cancelled listing');
    }

    const updated = await this.prisma.listing.update({
      where: { id },
      data: { ...dto },
      include: { images: true, category: true },
    });

    if (updated.status === ListingStatus.ACTIVE) {
      await this.indexListing(updated);
    }

    return updated;
  }

  async cancel(id: string, clerkId: string) {
    await this.assertOwner(id, clerkId);

    const updated = await this.prisma.listing.update({
      where: { id },
      data: { status: ListingStatus.CANCELLED },
    });

    await this.search.deleteDocument(INDEXES.LISTINGS, id);
    return updated;
  }

  async addImage(id: string, clerkId: string, file: Express.Multer.File) {
    await this.assertOwner(id, clerkId);

    const imageCount = await this.prisma.listingImage.count({
      where: { listingId: id },
    });
    if (imageCount >= 10) {
      throw new BadRequestException('Maximum 10 images per listing');
    }

    const { url, publicId } = await this.cloudinary.uploadImage(
      file.buffer,
      'listings',
    );

    return this.prisma.listingImage.create({
      data: {
        listingId: id,
        url,
        publicId,
        order: imageCount,
        isPrimary: imageCount === 0,
      },
    });
  }

  async removeImage(listingId: string, imageId: string, clerkId: string) {
    await this.assertOwner(listingId, clerkId);

    const image = await this.prisma.listingImage.findFirst({
      where: { id: imageId, listingId },
    });
    if (!image) throw new NotFoundException('Image not found');

    await this.cloudinary.deleteImage(image.publicId);
    await this.prisma.listingImage.delete({ where: { id: imageId } });

    if (image.isPrimary) {
      const first = await this.prisma.listingImage.findFirst({
        where: { listingId },
        orderBy: { order: 'asc' },
      });
      if (first) {
        await this.prisma.listingImage.update({
          where: { id: first.id },
          data: { isPrimary: true },
        });
      }
    }
  }

  async findMine(clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) return [];

    return this.prisma.listing.findMany({
      where: { sellerId: user.id },
      include: {
        images: { where: { isPrimary: true }, take: 1 },
        category: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async assertOwner(listingId: string, clerkId: string) {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) throw new ForbiddenException('User not found');

    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.sellerId !== user.id) throw new ForbiddenException('Not your listing');

    return listing;
  }

  private async indexListing(listing: Listing & { category: { slug: string; name: string } | null }) {
    try {
      await this.search.addDocuments(INDEXES.LISTINGS, [
        {
          id: listing.id,
          title: listing.title,
          description: listing.description,
          make: listing.make,
          model: listing.model,
          calibre: listing.calibre,
          categoryId: listing.categoryId,
          categorySlug: listing.category?.slug,
          categoryName: listing.category?.name,
          status: listing.status,
          listingType: listing.listingType,
          condition: listing.condition,
          province: listing.province,
          sellerId: listing.sellerId,
          price: listing.price,
          priceRange: this.priceRange(listing.price),
          createdAt: listing.createdAt?.toISOString(),
        },
      ]);
    } catch (err) {
      this.logger.warn(`Failed to index listing ${listing.id}: ${(err as Error).message}`);
    }
  }

  private priceRange(cents: number): string {
    const rand = cents / 100;
    if (rand < 5000) return 'under-5000';
    if (rand < 20000) return '5000-20000';
    if (rand < 100000) return '20000-100000';
    return 'over-100000';
  }
}
