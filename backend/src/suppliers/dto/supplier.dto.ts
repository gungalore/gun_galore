import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Max,
  Min,
} from 'class-validator';
import { Province } from '@prisma/client';

// ─── Daily Deals supplier DTOs (DD-F) ────────────────────────────────
// A JIT fulfilment supplier: GG raises a Zoho Purchase Order against it on a
// house-deal sale and The Courier Guy collects the stock from its warehouse.
// Every field carries a class-validator decorator because the global
// ValidationPipe runs with whitelist:true — undecorated fields are silently
// stripped before they reach the service. Domain-level checks (SA phone shape,
// complete warehouse address, valid province) run in SuppliersService so the
// errors read in domain terms; the decorators here are the coarse first gate.

export class CreateSupplierDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsString()
  @MaxLength(200)
  contactPerson!: string;

  @IsEmail({}, { message: 'A valid supplier email is required.' })
  @MaxLength(200)
  email!: string;

  @IsString()
  @MaxLength(40)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vatNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  regNumber?: string;

  // ── Collection warehouse (where TCG collects from) ─────────────────
  @IsString()
  @MaxLength(200)
  warehouseStreet!: string;

  @IsString()
  @MaxLength(120)
  warehouseSuburb!: string;

  @IsString()
  @MaxLength(120)
  warehouseCity!: string;

  @IsEnum(Province)
  warehouseProvince!: Province;

  @IsString()
  @MaxLength(10)
  warehousePostalCode!: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  warehouseLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  warehouseLng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// All fields optional for a PATCH. The service re-validates any field the
// PATCH actually carries against the same domain rules as create.
export class UpdateSupplierDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contactPerson?: string;

  @IsOptional()
  @IsEmail({}, { message: 'A valid supplier email is required.' })
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  vatNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  regNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  warehouseStreet?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  warehouseSuburb?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  warehouseCity?: string;

  @IsOptional()
  @IsEnum(Province)
  warehouseProvince?: Province;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  warehousePostalCode?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  warehouseLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  warehouseLng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  // Toggle active/inactive from the edit modal (the checkbox). Soft only —
  // there is no hard delete. Also reachable via POST :id/deactivate.
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

// Reason-only body for the deactivate action (audited soft-delete).
export class SupplierActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
