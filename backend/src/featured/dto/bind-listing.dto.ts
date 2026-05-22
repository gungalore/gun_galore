import { IsString } from 'class-validator';

// Winner of a featured-slot auction picks which of their ACTIVE
// listings to put in the slot. Service validates ownership + status
// + that we're inside the 15-min bind window.
export class BindFeaturedListingDto {
  @IsString()
  slotId: string;

  @IsString()
  listingId: string;
}
