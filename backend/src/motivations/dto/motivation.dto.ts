import {
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MotivationLicenceType } from '@prisma/client';

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
