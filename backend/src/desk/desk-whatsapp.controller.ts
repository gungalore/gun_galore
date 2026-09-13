import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { DeskWhatsappService } from './desk-whatsapp.service';

/**
 * THE DESK — the WhatsApp reply endpoints.
 *
 * Three routes, matching frontend/lib/desk-whatsapp.ts's client exactly: a
 * GET that renders the whole template registry against this thread's order,
 * and two POSTs — send one registered template, or close the card without
 * sending. Separate controller from DeskController on purpose: its
 * `:id/act` and `:id/later` are generic card verbs, and a WhatsApp reply is
 * not a generic action — it carries its own no-free-text contract that a
 * shared dispatcher would have no way to enforce.
 *
 * ⚠️ EVERY NON-GET HERE IS SUPERADMIN-ONLY, AND NOTHING IN THIS FILE ADDS
 * THAT. AdminJwtGuard applies it automatically — see CLAUDE.md's Desk
 * section: GET/HEAD/OPTIONS are open to any active admin, every other
 * method requires the full-admin tier.
 */
@Controller('admin/desk/whatsapp')
@UseGuards(AdminJwtGuard)
export class DeskWhatsappController {
  constructor(private readonly desk: DeskWhatsappService) {}

  /** The thread, its order context, and every registry template rendered for it. */
  @Get(':id')
  fetchThread(@Param('id') id: string) {
    return this.desk.fetchThread(id);
  }

  /**
   * ⚠️ `templateKey` IS THE ONLY FIELD THIS ROUTE READS. A `body`, `text` or
   * `vars` field arriving alongside it is silently ignored — DeskWhatsappService
   * re-derives every variable from the order itself, which is the entire
   * no-free-text contract this card exists to enforce. See
   * frontend/lib/desk-whatsapp.ts's header for why a composer here would be
   * the free-text send the Desk refuses to have, arriving by the back door.
   */
  @Post(':id/reply')
  reply(@Param('id') id: string, @Body() body: { templateKey?: string }) {
    return this.desk.reply(id, body?.templateKey ?? '');
  }

  /** Closes the card without sending — someone answered on another rail. */
  @Post(':id/handled')
  markHandled(@Param('id') id: string) {
    return this.desk.markHandled(id);
  }
}
