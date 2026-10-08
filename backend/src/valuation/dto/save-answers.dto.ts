import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class AnswerItemDto {
  @IsString()
  @MaxLength(10)
  questionId!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selected?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  custom?: string | null;

  @IsBoolean()
  unsure!: boolean;
}

export class SaveAnswersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerItemDto)
  answers!: AnswerItemDto[];
}
