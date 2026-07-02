import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ClerkGuard } from '../auth/clerk.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SavedSearchesService } from './saved-searches.service';
import { CreateSavedSearchDto } from './dto/create-saved-search.dto';

/**
 * /saved-searches — P5.1 retention. A signed-in user persists their current
 * browse filters and is alerted (in-app + push) when a NEW matching ACTIVE
 * listing is published.
 *
 *   POST   /saved-searches            — save the current filter set (idempotent)
 *   GET    /saved-searches            — the user's saved searches (label + href)
 *   PATCH  /saved-searches/:id        — { notifyEnabled } pause/resume alerts
 *   DELETE /saved-searches/:id        — delete
 *
 * All routes auth-gated — anonymous users can't save searches.
 */
@Controller('saved-searches')
@UseGuards(ClerkGuard)
export class SavedSearchesController {
  constructor(private readonly service: SavedSearchesService) {}

  @Get()
  list(@CurrentUser() clerkId: string) {
    return this.service.list(clerkId);
  }

  @Post()
  create(
    @CurrentUser() clerkId: string,
    @Body() dto: CreateSavedSearchDto,
  ) {
    return this.service.create(clerkId, dto);
  }

  @Patch(':id')
  setEnabled(
    @CurrentUser() clerkId: string,
    @Param('id') id: string,
    @Body() body: { notifyEnabled: boolean },
  ) {
    return this.service.setEnabled(clerkId, id, !!body.notifyEnabled);
  }

  @Delete(':id')
  remove(@CurrentUser() clerkId: string, @Param('id') id: string) {
    return this.service.remove(clerkId, id);
  }
}
