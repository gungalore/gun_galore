import { Module, Global } from '@nestjs/common';
import { ListingModerationService } from './listing-moderation.service';
import { ContactDetailFilterService } from './contact-detail-filter.service';

// Global so any module can pull these in without circular wiring.
// - ListingModerationService: vision+text moderation on listing
//   publish/edit (title, description, photos).
// - ContactDetailFilterService: shared regex+LLM filter for any
//   user-to-user freeform field (offer notes, rating comments, future
//   message threads). Wire it into every new freeform write so contact
//   sharing stays prohibited by default unless explicitly allowed.
@Global()
@Module({
  providers: [ListingModerationService, ContactDetailFilterService],
  exports: [ListingModerationService, ContactDetailFilterService],
})
export class ModerationModule {}
