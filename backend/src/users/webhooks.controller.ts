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
  username: string | null;
  image_url: string;
  // Phone + sign-up consent are captured via the custom form and stored in
  // unsafe_metadata: phone so it's available before Clerk's phone-verification
  // flow (which we skip); consent (Terms/Privacy/18+/marketing + policy
  // version) as the durable POPIA record, attached to this specific Clerk user.
  unsafe_metadata?: {
    phone?: string;
    consent?: {
      terms?: boolean;
      privacy?: boolean;
      age?: boolean;
      marketing?: boolean;
      policyVersion?: string;
    };
  };
}

// Session events (session.created / .ended / .removed / .revoked) deliver a
// Session object: data.id = session id, data.user_id = the Clerk user id.
interface ClerkSessionData {
  user_id: string;
  created_at?: number;
  last_active_at?: number;
  status?: string;
}

interface ClerkWebhookEvent {
  type: string;
  // User events and session events share the endpoint; the intersection lets
  // us read either shape (branches are gated on `type`, so the runtime object
  // always has the fields the branch touches).
  data: ClerkUserData & ClerkSessionData;
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

    // Never let a sync failure (e.g. a P2002 unique conflict, or a transient
    // DB error) escape as a 500 — svix/Clerk would retry the same poison event
    // repeatedly. We log loudly and 200 the webhook; the ClerkGuard lazy
    // upsert-from-Clerk is the durable backstop that syncs the user on their
    // first authenticated request regardless.
    try {
      if (type === 'user.created' || type === 'user.updated') {
        // Phone preference: verified phone_numbers > unsafe_metadata.phone.
        // Our custom form stuffs the SA number into unsafe_metadata so it's
        // available without going through Clerk's phone-verification step.
        const phone =
          data.phone_numbers[0]?.phone_number ?? data.unsafe_metadata?.phone;

        // Resurrection guard: a reordered/retried `user.updated` that arrives
        // AFTER a `user.deleted` must not recreate the row. Updates only touch
        // an existing user; only `user.created` may create.
        if (type === 'user.updated') {
          const exists = await this.usersService.findByClerkId(data.id);
          if (!exists) {
            this.logger.warn(
              `Clerk user.updated for ${data.id} with no local row — skipping (likely a post-deletion reorder)`,
            );
            return { received: true };
          }
        }

        await this.usersService.upsertFromClerk({
          clerkId: data.id,
          email: data.email_addresses[0]?.email_address ?? '',
          username: data.username ?? undefined,
          firstName: data.first_name ?? undefined,
          lastName: data.last_name ?? undefined,
          phone: phone ?? undefined,
          avatarUrl: data.image_url ?? undefined,
        });

        // Stamp the durable POPIA sign-up consent (email path attaches it to
        // unsafe_metadata at signUp.create). Set-once, so re-runs are safe.
        const consent = data.unsafe_metadata?.consent;
        if (consent) {
          await this.usersService.recordSignupConsent(data.id, consent);
        }
      }

      if (type === 'user.deleted') {
        await this.usersService.deleteByClerkId(data.id);
      }

      // Login capture — one LoginEvent per Clerk session. session.created
      // opens it; the end events close it so we can compute session length.
      if (type === 'session.created') {
        await this.usersService.recordLoginEvent({
          sessionId: data.id,
          userId: data.user_id,
          createdAt: data.created_at,
          lastActiveAt: data.last_active_at,
        });
      }
      if (
        type === 'session.ended' ||
        type === 'session.removed' ||
        type === 'session.revoked'
      ) {
        await this.usersService.closeLoginEvent(data.id, type);
      }
    } catch (err) {
      this.logger.error(
        `Clerk webhook ${type} for ${data.id} failed (200-ing so it isn't retried indefinitely; lazy-sync backstops it): ${(err as Error).message}`,
      );
    }

    return { received: true };
  }
}
