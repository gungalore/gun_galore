import { IsInt, IsString, Min } from 'class-validator';

// One bid on a featured slot's currently OPEN auction. The backend
// snaps `amountCents` to the nearest tier (rounding DOWN — e.g.
// R275 → T1_24H at R100 cap until it crosses R250). The frontend
// surfaces the resulting tier + duration BEFORE the bid lands, so
// "snap to nearest" should never surprise the bidder.
export class PlaceFeaturedBidDto {
  @IsString()
  slotId: string;

  @IsInt()
  @Min(10000) // R100 absolute floor — backend re-checks config for the real floor
  amountCents: number;
}
