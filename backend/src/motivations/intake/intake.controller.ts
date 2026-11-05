import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
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
      }[];
    },
  ) {
    return this.intake.answerBatch(
      userId,
      id,
      Array.isArray(body?.answers) ? body.answers : [],
    );
  }

  @Post(':id/intake/finish')
  finish(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.intake.finish(userId, id);
  }
}
