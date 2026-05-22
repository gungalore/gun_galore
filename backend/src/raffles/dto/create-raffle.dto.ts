import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Length,
} from 'class-validator';

// Three operator inputs: itemPrice (selling price), itemCost (what we
// paid), ticketPrice. targetTicketCount is auto-derived on the backend
// as ceil(itemValueCents / ticketPriceCents) — sell-out exactly covers
// the prize selling price. The "is this a firearm?" toggle was dropped
// per spec.
export class CreateRaffleDto {
  @IsString()
  @Length(5, 200)
  title: string;

  @IsString()
  @Length(20, 5000)
  description: string;

  @IsInt()
  @Min(1000) // R10 minimum
  itemValueCents: number;

  @IsInt()
  @Min(0)
  itemCostCents: number;

  @IsInt()
  @Min(100) // R1 minimum
  ticketPriceCents: number;

  // Multiple choice question — C is always the correct answer. Backend
  // enforces this in createPendingTickets().
  @IsString()
  @Length(5, 500)
  question: string;

  @IsString()
  @Length(1, 200)
  optionA: string;

  @IsString()
  @Length(1, 200)
  optionB: string;

  @IsString()
  @Length(1, 200)
  optionC: string;

  @IsString()
  @Length(1, 200)
  optionD: string;

  // ISO 8601 — when the raffle becomes ACTIVE. If past, it opens on create.
  @IsString()
  startTime: string;

  // Optional legacy single-image URL (Cloudinary multi-upload uses
  // POST /admin/raffles/:id/images instead).
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
