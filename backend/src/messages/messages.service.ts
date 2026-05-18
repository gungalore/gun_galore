import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ModerationService } from './moderation.service';
import { SendMessageDto } from './dto/send-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly moderation: ModerationService,
  ) {}

  async send(transactionId: string, senderClerkId: string, dto: SendMessageDto) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { buyer: true, seller: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const isBuyer = tx.buyer.clerkId === senderClerkId;
    const isSeller = tx.seller.clerkId === senderClerkId;
    if (!isBuyer && !isSeller) throw new ForbiddenException('Not a party to this transaction');

    const result = await this.moderation.moderate(dto.content);

    if (result.action === 'BLOCK') {
      throw new UnprocessableEntityException(
        result.reason ?? 'Message blocked: please keep all communication on-platform.',
      );
    }

    const isStripped = result.action === 'STRIP';
    return this.prisma.message.create({
      data: {
        transactionId,
        senderClerkId,
        content: isStripped ? (result.cleaned ?? dto.content) : dto.content,
        originalContent: isStripped ? dto.content : null,
        wasModerated: isStripped,
      },
    });
  }

  async findThread(transactionId: string, clerkId: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { buyer: true, seller: true },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    const isBuyer = tx.buyer.clerkId === clerkId;
    const isSeller = tx.seller.clerkId === clerkId;
    if (!isBuyer && !isSeller) throw new ForbiddenException('Not a party to this transaction');

    // Mark messages from the other party as read
    await this.prisma.message.updateMany({
      where: {
        transactionId,
        senderClerkId: { not: clerkId },
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    return this.prisma.message.findMany({
      where: { transactionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async unreadCount(clerkId: string): Promise<number> {
    const user = await this.prisma.user.findUnique({ where: { clerkId } });
    if (!user) return 0;

    // Find all transactions the user is a party to
    const txIds = await this.prisma.transaction
      .findMany({
        where: {
          OR: [{ buyerId: user.id }, { sellerId: user.id }],
        },
        select: { id: true },
      })
      .then((rows) => rows.map((r) => r.id));

    return this.prisma.message.count({
      where: {
        transactionId: { in: txIds },
        senderClerkId: { not: clerkId },
        readAt: null,
      },
    });
  }
}
