import {
  IsArray,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Condition, Province, ShippingMethod } from '@prisma/client';

// ─── Daily Deals admin DTOs (DD-1) ───────────────────────────────────
// Every field carries a class-validator decorator because the global
// ValidationPipe runs with whitelist:true — undecorated fields are
// silently stripped before they reach the service. All money values are
// ZAR CENTS (integers). Cross-field money invariants (wasPrice > dealPrice
// > 0) and the licensed-category rejection are enforced in DealsService,
// not here, so the errors read in domain terms.

export class CreateDealDto {
  // ── Product half (reuses the listing infrastructure) ──────────────
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  categoryId!: string;

  @IsString()
  @MaxLength(8000)
  description!: string;

  // Deals are first-party retail; default NEW in the service when omitted.
  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @IsEnum(Province)
  province!: Province;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  calibre?: string;

  // Courier methods offered. Licensed/firearm methods are irrelevant —
  // firearm categories are rejected outright. Defaults to [PUDO, TCG] in
  // the service when omitted.
  @IsOptional()
  @IsArray()
  @IsEnum(ShippingMethod, { each: true })
  shippingMethods?: ShippingMethod[];

  // Parcel dimensions for the courier rate API (Pudo / TCG). Required for a
  // shippable deal; the service applies sensible defaults if omitted so a
  // deal is never un-quotable.
  @IsOptional()
  @IsInt()
  @Min(1)
  weightGrams?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  lengthCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  widthCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  heightCm?: number;

  // ── Deal half ─────────────────────────────────────────────────────
  // The deal SELL price. Stored on Listing.price (single source of truth
  // for checkout); Deal carries only cost + was.
  @IsInt()
  @Min(1)
  dealPriceCents!: number;

  // RRP anchor (struck-through). Must exceed dealPriceCents (service).
  @IsInt()
  @Min(1)
  wasPriceCents!: number;

  // Internal per-unit supplier cost. Drives margin %. Never public.
  @IsInt()
  @Min(0)
  costPriceCents!: number;

  @IsInt()
  @Min(1)
  initialStock!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerCap?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  shipsInDaysMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  shipsInDaysMax?: number;

  @IsOptional()
  @IsInt()
  heroRank?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierRef?: string;

  // DD-F: the structured JIT supplier the deal is fulfilled through. When set,
  // the service validates the supplier exists + is active. Kept alongside the
  // legacy free-text supplierName/supplierRef.
  @IsOptional()
  @IsString()
  supplierId?: string;

  // Which drop this deal belongs to (grouping/calendar). Optional in DD-1.
  @IsOptional()
  @IsISO8601()
  dropDate?: string;

  // Explicit schedule window (optional — a deal can be created as a pure
  // DRAFT and scheduled later via the schedule action).
  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}

// All fields optional for a PATCH. Money invariants re-checked in the
// service against the merged (existing + incoming) values.
export class UpdateDealDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(8000)
  description?: string;

  @IsOptional()
  @IsEnum(Condition)
  condition?: Condition;

  @IsOptional()
  @IsEnum(Province)
  province?: Province;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  make?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  calibre?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(ShippingMethod, { each: true })
  shippingMethods?: ShippingMethod[];

  @IsOptional()
  @IsInt()
  @Min(1)
  weightGrams?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  lengthCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  widthCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  heightCm?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  dealPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  wasPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  costPriceCents?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  initialStock?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  perCustomerCap?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  shipsInDaysMin?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  shipsInDaysMax?: number;

  @IsOptional()
  @IsInt()
  heroRank?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  supplierRef?: string;

  // DD-F: re-link the deal to a different structured supplier. The service
  // validates the supplier exists + is active, and only allows the change up
  // until a purchase order exists for the deal.
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsOptional()
  @IsISO8601()
  dropDate?: string;
}

// Schedule action — set the go-live window (DRAFT → SCHEDULED).
export class ScheduleDealDto {
  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// Extend action — push the end out (LIVE/ENDED → EXTENDED).
export class ExtendDealDto {
  @IsISO8601()
  extendedUntil!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// Reason-only body for the simple lifecycle actions (go-live, end,
// cancel, duplicate, delete). Reason is optional — the service supplies a
// sensible default for the audit log when omitted.
export class DealActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
