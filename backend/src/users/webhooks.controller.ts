import { Controller, Post, Req, Headers, HttpCode, Logger } from '@nestjs/common';
import { Request } from 'express';
import { Webhook } from 'svix';
import { UsersService } from './users.service';

interface ClerkUserData {
  id: string;
  email_addresses: { email_address: string }[];
  phone_numbers: { phone_number: string }[];
  first_name: string | null;
  last_name: string | null;
  image_url: string;
}

interface ClerkWebhookEvent {
  type: string;
  data: ClerkUserData;
}

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly usersService: UsersService) {}

  @Post('clerk')
  @HttpCode(200)
  async clerkWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTimestamp: string,
    @Headers('svix-signature') svixSignature: string,
  ) {
    const secret = process.env.CLERK_WEBHOOK_SECRET;
    const rawBody = req.rawBody;

    if (!secret || !rawBody) {
      this.logger.warn('Clerk webhook: missing secret or raw body');
      return { received: true };
    }

    let event: ClerkWebhookEvent;
    try {
      const wh = new Webhook(secret);
      event = wh.verify(rawBody.toString(), {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      }) as ClerkWebhookEvent;
    } catch (err) {
      this.logger.warn(`Clerk webhook verification failed: ${(err as Error).message}`);
      return { received: false };
    }

    const { type, data } = event;
    this.logger.log(`Clerk webhook: ${type} for ${data.id}`);

    if (type === 'user.created' || type === 'user.updated') {
      await this.usersService.upsertFromClerk({
        clerkId: data.id,
        email: data.email_addresses[0]?.email_address ?? '',
        firstName: data.first_name ?? undefined,
        lastName: data.last_name ?? undefined,
        phone: data.phone_numbers[0]?.phone_number ?? undefined,
        avatarUrl: data.image_url ?? undefined,
      });
    }

    if (type === 'user.deleted') {
      await this.usersService.deleteByClerkId(data.id);
    }

    return { received: true };
  }
}
