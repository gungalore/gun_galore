import { IsInt, Min, Max, IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateRatingDto {
  @IsInt()
  @Min(1)
  @Max(5)
  stars: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
