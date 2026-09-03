import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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
