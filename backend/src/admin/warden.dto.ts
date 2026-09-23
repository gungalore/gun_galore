import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * WARDEN — request bodies.
 *
 * The global ValidationPipe runs with `whitelist: true`, so anything not
 * declared here is stripped rather than rejected. That is worth knowing when
 * reading the approve path below: a client that sends `command` instead of
 * `expectedCommand` does not get a 400, it gets an empty string and a 409.
 */

export class SendWardenChatDto {
  /**
   * Plain language. Warden accepts a reaction, a refusal, a question or a
   * standing instruction — the daemon classifies it, this API does not.
   *
   * The cap is generous because an operator explaining WHY they refuse a fix
   * is the most valuable thing on the thread; it exists to stop a paste of a
   * whole log file, not to shorten a sentence.
   */
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;
}

export class ApproveProposalDto {
  /**
   * ⚠️ THE COMPARE-AND-SWAP. The operator approved the command they were
   * shown; this is that exact string, echoed back off the confirm dialog.
   * WardenService re-reads the proposal and refuses if Warden now holds
   * anything else.
   *
   * Without it, a card rendered at 09:05 and approved at 09:40 approves
   * whatever the proposal says at 09:40. A money-grade confirm that restates
   * what will run, and then runs something else, is worse than no confirm —
   * it is a confirm the operator has learned to trust.
   */
  @IsString()
  @MaxLength(8000)
  expectedCommand!: string;

  /**
   * Optional, because the confirm dialog restates the command rather than
   * asking for prose. WardenService synthesises an audit reason when this is
   * absent — AdminAuditService.record() throws on an empty one.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DeclineProposalDto {
  /** Why it was refused. Warden reads declines back as standing guidance. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PauseWardenDto {
  /**
   * How long to hold off, in minutes.
   *
   * ⚠️ THERE IS NO "PAUSE INDEFINITELY", AND THE MAXIMUM IS THE POINT. A
   * pause is set during an incident or a deploy by somebody mid-something
   * else, and the one thing nobody ever does is come back and resume it. An
   * open-ended pause is a watchdog silently switched off for a month while
   * the Site board still reads as though it is watching. The daemon clamps
   * this to 24 hours on its own side as well; both ends refuse, because a
   * client is not a boundary.
   *
   * Optional — absent means the daemon's default hour. A client sending
   * `0` or a negative number has a bug and gets a 400 rather than a pause
   * that expired before the response was written.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  minutes?: number;

  /**
   * Why. Optional for the operator, mandatory for the audit row —
   * AdminAuditService.record() throws on an empty reason, so WardenService
   * synthesises one when this is absent. Warden echoes it back into the
   * thread so the next person reading knows why it went quiet.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
