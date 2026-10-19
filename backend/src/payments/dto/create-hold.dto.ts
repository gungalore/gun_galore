import { IsString, IsNotEmpty } from 'class-validator';

// Body for POST /transactions/hold — opening the checkout page reserves ONE
// unit of a plain BUY_NOW listing for 15 minutes. Quantity is deliberately not
// accepted: extra units are reserved atomically at Pay, if the buyer picks
// more than one.
export class CreateHoldDto {
  @IsString()
  @IsNotEmpty()
  listingId!: string;
}
