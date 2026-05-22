import {
  IsString,
  IsOptional,
  Length,
  IsInt,
  Min,
  Max,
} from 'class-validator';

export class PostalEntryDto {
  @IsString()
  raffleId: string;

  // Reference code printed on the PDF the user sent in
  @IsString()
  @Length(8, 8)
  referenceCode: string;

  @IsString()
  @Length(1, 100)
  firstName: string;

  @IsString()
  @Length(1, 100)
  lastName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  // How many tickets the postal entrant is being credited.
  // CPA Section 36 free-entry route: usually 1 per posted form.
  @IsInt()
  @Min(1)
  @Max(10)
  ticketCount: number;
}
