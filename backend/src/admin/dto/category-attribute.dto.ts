import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { AttributeType } from '@prisma/client';

// snake_case machine key: starts with a lowercase letter, then up to 48
// more of [a-z0-9_]. Doubles as the Listing.attributes JSON key and the
// Meili facet field `attr_<key>`, so it must stay stable + safe.
const KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;

export class CreateCategoryAttributeDto {
  @Matches(KEY_RE, {
    message:
      'key must be snake_case: a lowercase letter followed by up to 48 of [a-z0-9_]',
  })
  key!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @IsEnum(AttributeType)
  type!: AttributeType;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string;

  // Required + non-empty ONLY for SELECT types; ignored otherwise.
  @ValidateIf((o: CreateCategoryAttributeDto) => o.type === 'SELECT')
  @IsArray()
  @ArrayNotEmpty({ message: 'options must be a non-empty list for SELECT attributes' })
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// Update mirrors create but every field is optional. `key` is intentionally
// omitted — the machine key is immutable once created (it anchors listing
// values + the Meili facet); to change it, deactivate and add a new one.
export class UpdateCategoryAttributeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  @IsOptional()
  @IsEnum(AttributeType)
  type?: AttributeType;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  unit?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @IsOptional()
  @IsBoolean()
  filterable?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
