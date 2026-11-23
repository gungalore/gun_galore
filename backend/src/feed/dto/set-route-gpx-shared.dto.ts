import { IsBoolean } from 'class-validator';

/**
 * Author's consent for other members to download the post's .gpx.
 * ⚠️ A real JSON boolean is required — a bare body property is coerced from
 * multipart strings on upload, but this PATCH is plain JSON and must not treat
 * "false" (a truthy string) as true.
 */
export class SetRouteGpxSharedDto {
  @IsBoolean()
  gpxShared!: boolean;
}
