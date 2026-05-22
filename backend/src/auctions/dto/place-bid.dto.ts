import { IsInt, IsOptional, Min, IsBoolean } from 'class-validator';

// Two bid intents, same endpoint:
//
//   isOneShot=false (default) → AUTO BID. `maxAmount` is the proxy
//     ceiling. The system places only the minimum increment above the
//     current bid and auto-counters other bidders up to maxAmount.
//     Other bidders never see maxAmount.
//
//   isOneShot=true → PLACE BID. The user wants their visible bid to
//     equal `maxAmount` right now — no proxy, no quiet leak-out at the
//     next increment. The system posts maxAmount as the visible bid
//     and treats maxAmount as both the visible bid AND the proxy
//     ceiling (so if someone else outbids them they don't get
//     auto-countered above it). Same payload, different UX intent.
export class PlaceBidDto {
  // Buyer's amount in ZAR cents. Meaning depends on isOneShot — see
  // class-level comment.
  @IsInt()
  @Min(100)
  maxAmount: number;

  @IsOptional()
  @IsBoolean()
  isOneShot?: boolean;
}
