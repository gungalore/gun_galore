import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RespondWantedDto {
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  message: string;

  // Optional link to one of the responder's own ACTIVE listings ("I have
  // this for sale"). Ownership + status are verified server-side.
  @IsOptional()
  @IsString()
  listingId?: string;
}
