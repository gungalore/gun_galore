import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';

export enum ReviewAction {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ListingReviewDto {
  @IsEnum(ReviewAction)
  action: ReviewAction;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
