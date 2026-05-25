import { IsString, IsObject, IsOptional, IsArray, IsEnum } from 'class-validator';

// Shape we expect from the browser's PushManager.subscribe() result.
// The PushSubscription DOM object's .toJSON() returns:
//   { endpoint, keys: { p256dh, auth }, expirationTime }
// We discard expirationTime (browsers don't honour it consistently)
// and flatten the keys into top-level fields for the DB row.
export class SubscribeDto {
  @IsString()
  endpoint!: string;

  @IsObject()
  keys!: { p256dh: string; auth: string };

  /** Optional — the User-Agent string at subscribe time. Stored only
   * to make admin debugging easier ("which device subscribed when") —
   * never used to identify users. */
  @IsOptional()
  @IsString()
  userAgent?: string;

  /** Optional override of which categories this device should receive
   * push for. Defaults server-side to all three. Currently the
   * frontend doesn't expose per-category toggles — this is plumbing
   * for a future settings panel. */
  @IsOptional()
  @IsArray()
  @IsEnum(['BUYER', 'SELLER', 'ACCOUNT'], { each: true })
  categories?: ('BUYER' | 'SELLER' | 'ACCOUNT')[];
}
