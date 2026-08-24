import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MotivationLicenceType } from '@prisma/client';
import {
  SCHEME_KEYS,
  FORMAT_KEYS,
  type Scheme,
  type TemplateFormat,
} from '../motivation-pdf.service';
import {
  LAYOUT_KEYS,
  type TemplateLayout,
} from '../motivation-pdf-layouts';

// DTO classes are declared in dependency order and one concern per file.
//
// NOT A STYLE PREFERENCE. `emitDecoratorMetadata` emits a
// Reflect.metadata('design:type', X) call that EVALUATES X at class-definition
// time, so a DTO referenced before its declaration is a temporal-dead-zone
// crash at import — "Cannot access 'X' before initialization" — with tsc
// perfectly clean and no test touching it. That exact fault crash-looped this
// backend once and took every route down with it.

export class CreateMotivationDto {
  @IsEnum(MotivationLicenceType)
  licenceType!: MotivationLicenceType;

  /**
   * Free-text label for WHICH application this motivation belongs to, so one
   * person can hold a separate motivation per application of the same type.
   * Empty string is the normal case and is a real value — it is the throttle
   * key, and it must never be null (Postgres treats NULLs as distinct, which
   * would disable the unique constraint entirely).
   */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  applicationRef?: string;
}

export class SaveAnswersDto {
  /**
   * Partial patch of field key → answer. Validated against the registry in the
   * service rather than here: which keys are legal depends on the licence type
   * of the row being edited, which a DTO cannot see.
   */
  @IsObject()
  answers!: Record<string, unknown>;
}

export class AcceptDeclarationDto {
  /**
   * Separate, opt-in, and NOT required to generate. Permission to quote them
   * in a testimonial is a different decision from confirming their own facts
   * are true, and bundling the two would make the consent worthless.
   */
  @IsOptional()
  @IsBoolean()
  testimonialConsent?: boolean;
}

/**
 * One answer to one follow-up question.
 *
 * The cap is generous because this is the applicant's own account of their
 * circumstances and the field registry caps it again per field; the point here
 * is only to stop an unbounded body reaching the database.
 */
export class AnswerFollowUpDto {
  @IsString()
  @IsNotEmpty({ message: 'Please write an answer first.' })
  @MaxLength(4000)
  answer!: string;
}

/**
 * The template the applicant picked in the carousel.
 *
 * ⚠️ VALIDATED AS A MEMBER OF THE LIST, not as "a string". These values are
 * written into a plain VARCHAR (no Postgres enum, so adding a template costs
 * no migration) — which means this DTO is the only place a typo gets caught
 * before it reaches the column. The renderer still falls back on read, so a
 * bad value can never fail a download; this just stops it being stored.
 *
 * Both fields optional so the picker can change the colour without resending
 * the format, and vice versa.
 */
export class SetTemplateDto {
  @IsOptional()
  @IsIn(FORMAT_KEYS, { message: 'That is not one of our formats.' })
  format?: TemplateFormat;

  @IsOptional()
  @IsIn(SCHEME_KEYS, { message: 'That is not one of our schemes.' })
  colourway?: Scheme;

  /**
   * Which of the five layouts the pack is set in.
   *
   * Validated against the same list the renderer falls back to, so the picker
   * cannot offer something the document cannot be.
   */
  @IsOptional()
  @IsIn(LAYOUT_KEYS, { message: 'That is not one of our layouts.' })
  layout?: TemplateLayout;
}
