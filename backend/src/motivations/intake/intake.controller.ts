import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../../auth/auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { MotivationIntakeService } from './intake.service';
import type { IntakeMode } from './intake.types';

@Controller('motivations')
@UseGuards(AuthGuard)
export class MotivationsIntakeController {
  constructor(private readonly intake: MotivationIntakeService) {}

  @Get(':id/intake')
  state(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.intake.state(userId, id);
  }

  /**
   * One topic's card, with the saved answers prefilled — the Back destination.
   *
   * ⚠️ A READ, NOT A CURSOR. The page names the topic it wants to edit and the
   * server rebuilds that card from the answers; nothing is stored between
   * screens, so a refresh cannot land on a different card than the browser
   * thinks it is on. `navigation` comes back with it so the footer can still
   * offer Back.
   */
  @Get(':id/intake/card')
  card(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Query('topic') topic?: string,
  ) {
    return this.intake.cardForTopic(userId, id, (topic ?? '').trim());
  }

  /**
   * Save corrections from an edited (earlier) card.
   *
   * ⚠️ MEMBER-ONLY. The member is the one editing, so `saveAnswers` stamps the
   * changed keys MEMBER and no later automatic pass may overwrite them. A
   * changed fact also re-queues a background re-draft of the narrative fields
   * that are still ours.
   */
  @Patch(':id/intake/answers')
  patchAnswers(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: { answers?: Record<string, string> },
  ) {
    return this.intake.patchAnswers(
      userId,
      id,
      body?.answers && typeof body.answers === 'object' ? body.answers : {},
    );
  }

  /**
   * "Write the narrative for me again" — the explicit button on the review
   * screen.
   *
   * ⚠️ THROTTLED LIKE POST :id/reason. It is a model call and the page that
   * hosts it polls while drafting; without the limit a stuck tab would be a
   * bill. The response carries the state so the screen renders in one round
   * trip, plus the counts so it can say how many answers were drafted.
   */
  @Post(':id/intake/draft')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  async draft(@CurrentUser() userId: string, @Param('id') id: string) {
    const result = await this.intake.draftNarrative(userId, id);
    return { state: result.state, drafted: result.drafted, failed: result.failed };
  }

  @Post(':id/intake/start')
  start(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: { mode?: IntakeMode },
  ) {
    return this.intake.start(
      userId,
      id,
      body.mode === 'DOCUMENTS' ? 'DOCUMENTS' : 'INTERVIEW',
    );
  }

  @Post(':id/intake/output')
  output(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: { outputMode?: string },
  ) {
    return this.intake.setOutputMode(userId, id, body.outputMode ?? '');
  }

  @Post(':id/intake/documents')
  documents(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body()
    body: {
      items?: { source: 'credential' | 'upload'; sourceId: string }[];
      placeConfirmed?: boolean;
    },
  ) {
    return this.intake.selectDocuments(userId, id, body ?? {});
  }

  @Post(':id/intake/section')
  changeSection(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: { licenceType?: string },
  ) {
    return this.intake.changeSection(userId, id, body.licenceType ?? '');
  }

  @Post(':id/intake/answer')
  answer(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body()
    body: {
      fieldKey?: string;
      value?: string;
      values?: string[];
      message?: string;
      fields?: Record<string, string>;
    },
  ) {
    return this.intake.answer(userId, id, body ?? {});
  }

  /**
   * A whole category in one turn.
   *
   * \u26a0\ufe0f THE GROUPED UI POSTS HERE. The single-answer route above stays for
   * a member who is served one question (a rare fallback) and for older
   * clients; both go through the same validation.
   */
  @Post(':id/intake/answers')
  answerBatch(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body()
    body: {
      answers?: {
        fieldKey?: string;
        value?: string;
        values?: string[];
        message?: string;
        fields?: Record<string, string>;
        /** Optional question the member has chosen not to answer. */
        skip?: boolean;
      }[];
    },
  ) {
    return this.intake.answerBatch(
      userId,
      id,
      Array.isArray(body?.answers) ? body.answers : [],
    );
  }

  @Post(':id/intake/skip')
  skip(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() body: { fieldKey?: string },
  ) {
    return this.intake.skip(userId, id, body?.fieldKey ?? '');
  }

  @Post(':id/intake/finish')
  finish(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.intake.finish(userId, id);
  }
}
