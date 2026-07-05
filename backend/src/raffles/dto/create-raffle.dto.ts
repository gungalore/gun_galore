import {
  IsString,
  IsInt,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  IsDateString,
  Min,
  Length,
} from 'class-validator';
import { SubscriptionTier, ExperienceType, Province } from '@prisma/client';

// Three operator inputs: itemPrice (selling price), itemCost (what we
// paid), ticketPrice. targetTicketCount is auto-derived on the backend
// as ceil(itemValueCents / ticketPriceCents) — sell-out exactly covers
// the prize selling price.
export class CreateRaffleDto {
  @IsString()
  @Length(5, 200)
  title: string;

  @IsString()
  @Length(20, 5000)
  description: string;

  // Phase E3 — for subscriber raffles these can be 0 (prize value
  // hidden, no public ticket sale). For public raffles the normal
  // minimums apply (R10 prize, R1 ticket).
  @IsInt()
  @Min(0)
  itemValueCents: number;

  @IsInt()
  @Min(0)
  itemCostCents: number;

  @IsInt()
  @Min(0)
  ticketPriceCents: number;

  // Phase E3 — subscriber-raffle inputs. null/undefined = standard
  // public raffle (existing behaviour). MEMBER = Ask GG Member raffle
  // (open to Members + Pros, auto-entered free, 48h auto-draw). PRO =
  // Ask GG Pro raffle (Pros only).
  @IsOptional()
  @IsEnum(SubscriptionTier)
  subscriberTierRestriction?: SubscriptionTier;

  // Default true when subscriberTierRestriction is set — service
  // forces it on regardless of what the form sends. Kept as a DTO
  // field so the admin form can preview the rendered card.
  @IsOptional()
  @IsBoolean()
  hidePrizeValue?: boolean;

  // Is the prize a firearm? Persisted on the Raffle so the dispatch gate
  // (bare-courier reject → dealer-transfer routing) and the claim-time
  // 18+/licence attestation can be enforced. Defaults false.
  @IsOptional()
  @IsBoolean()
  prizeIsFirearm?: boolean;

  // EXP-E5 — is the prize an outfitter-sponsored EXPERIENCE (guided hunt /
  // range day)? Mirrors prizeIsFirearm: forced false for subscriber raffles
  // in the service. Defaults false.
  @IsOptional()
  @IsBoolean()
  prizeIsExperience?: boolean;

  // EXP-E5 — experience-prize metadata (snapshot of the sponsored package,
  // mirroring the Listing experience columns). Only meaningful when
  // prizeIsExperience is true; ignored otherwise.
  @IsOptional()
  @IsEnum(ExperienceType)
  experienceType?: ExperienceType;

  @IsOptional()
  @IsDateString()
  eventStartDate?: string;

  @IsOptional()
  @IsDateString()
  eventEndDate?: string;

  @IsOptional()
  @IsEnum(Province)
  eventProvince?: Province;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  locationText?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  durationText?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  speciesList?: string[];

  @IsOptional()
  @IsString()
  @Length(1, 5000)
  whatsIncluded?: string;

  @IsOptional()
  @IsBoolean()
  rifleProvided?: boolean;

  // EXP-E5 — sponsor settlement: the vetted outfitter GG pays out of ticket
  // revenue after the draw. sponsorUserId is the recipient (User.id); the
  // agreed EFT amount is sponsorSettlementCents. Both optional so a
  // platform-owned experience prize (no sponsor) is still valid.
  @IsOptional()
  @IsString()
  sponsorUserId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sponsorSettlementCents?: number;

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
