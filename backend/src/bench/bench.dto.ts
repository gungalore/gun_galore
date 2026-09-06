import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/**
 * THE BENCH — the shapes a member may send.
 *
 * 🚨 THE GLOBAL ValidationPipe RUNS ON DECLARED CLASSES AND ON NOTHING ELSE.
 * `@Body() body: Record<string, unknown>` is not a class, so the pipe skips it
 * entirely — whitelist, transform and every constraint — and the body arrives
 * exactly as it was posted. Both write routes were typed that way: PUT /me
 * took a 15 MB `bullets` blob or a non-array (a 500), and POST /log took
 * `chargeGr: "abc"`, which is NaN by the time Prisma sees it, and unbounded
 * `notes` up to the body limit.
 *
 * ⚠️ AND `whitelist: true` STRIPS WHAT IT DOES NOT KNOW, NESTED TOO. Every
 * field a member may legitimately send has to be declared here — including the
 * legacy `maker` / `category` / `type` on a stored bullet, which nothing
 * matches on but which is theirs and must survive a save.
 */

/**
 * ⚠️ `@IsOptional()` IS WHAT KEEPS A NULL A NULL. It skips the constraints for
 * both `undefined` AND `null`, so a field the sheet deliberately posts as null
 * — velocity and group are always null at the bench, measured later at the
 * range — passes validation untouched and reaches the service as null.
 * `@IsNumber()` alone would reject it, and `Number(null)` is 0, which is how
 * every entry ever logged came back reading "0 m/s · 0 mm".
 */

/* ── The log ────────────────────────────────────────────────────────────── */

/** Ten years back is older than any reloading log a member would type in. */
const SHOT_AT_MAX_AGE_YEARS = 10;

/**
 * A date the member fired on, as `YYYY-MM-DD` or a full ISO instant.
 *
 * ⚠️ BOTH SPELLINGS, BECAUSE BOTH ARRIVE. The sheet's `<input type="date">`
 * hands back `2026-09-06`; anything built from a `Date` sends the full ISO
 * string. Rejecting either would fail a save with nothing on screen to fix.
 *
 * ⚠️ AND `new Date('2026-13-45')` IS AN INVALID DATE, NOT A THROW. Prisma turns
 * one into a 500 at write time, which reads to the member as "the site is
 * broken" over a form they filled in correctly bar one digit.
 *
 * Bounded rather than merely parseable: a year in the far future or the far
 * past sorts the entry off the end of their own list, where they cannot find
 * it to delete it.
 */
export function parseShotAt(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s)) return null;

  // A bare date is read as UTC midnight, which is what `new Date('2026-09-06')`
  // already does — named here so the CSV's Johannesburg formatting has one
  // known convention to work back from rather than two.
  const d = new Date(s.length === 10 ? `${s}T00:00:00.000Z` : s);
  if (Number.isNaN(d.getTime())) return null;

  const now = Date.now();
  // A day ahead, not an instant: a member in SAST logging tonight's range trip
  // is already "tomorrow" in UTC for two hours of every day.
  const max = now + 24 * 60 * 60 * 1000;
  const min = new Date(new Date(now).setFullYear(new Date(now).getFullYear() - SHOT_AT_MAX_AGE_YEARS)).getTime();
  if (d.getTime() > max || d.getTime() < min) return null;

  return d;
}

function IsShotAt(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isShotAt',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => parseShotAt(value) !== null,
        defaultMessage: () =>
          `${propertyName} must be a date (YYYY-MM-DD or ISO) within the last ${SHOT_AT_MAX_AGE_YEARS} years`,
      },
    });
  };
}

/**
 * POST /bench/log.
 *
 * 🚨 `chargeGr` IS THE ONE FIGURE ON THIS FORM THAT CANNOT BE ABSENT, and the
 * spec (§6.4) says so: a log entry without a charge records nothing. 2000 gr is
 * an order of magnitude above any small-arms charge — it is there to stop a
 * mis-keyed field, not to judge a load.
 */
export class AddLogDto {
  @IsString()
  @MaxLength(64)
  cartridgeKey!: string;

  @IsString()
  @MaxLength(120)
  bulletLabel!: string;

  @IsString()
  @MaxLength(120)
  powderName!: string;

  @IsNumber()
  @Min(0.0001)
  @Max(2000)
  chargeGr!: number;

  /** Nullable — the sheet posts null when the member left it blank. */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(500)
  coalMm?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  primer?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  caseLabel?: string | null;

  /** The consolidated load this came off, so the list can put it back against its window. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  loadId?: string | null;

  /** Metres per second. Measured at the range, so null at save time. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3000)
  velocityMs?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  groupMm?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;

  @IsOptional()
  @IsShotAt()
  shotAt?: string;
}

/**
 * PATCH /bench/log/:id — the results, added after the range.
 *
 * ⚠️ THE THREE FIELDS THE MEMBER LEARNS LATER, AND NOT ONE MORE. The charge,
 * the COAL and the components are what they LOADED; changing those after the
 * fact would rewrite the record of a round that was actually fired. Velocity,
 * group and notes are what they MEASURED, and the sheet already tells them
 * those come later.
 *
 * All three are nullable so a wrong reading can be cleared, not only replaced.
 */
export class PatchLogDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3000)
  velocityMs?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10000)
  groupMm?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

/* ── The bench ──────────────────────────────────────────────────────────── */

/**
 * One bullet on the shelf.
 *
 * 🚨 A BULLET IS A WEIGHT IN A CALIBRE — see bench.types.ts. `maker`,
 * `category` and `type` are legacy decoration off older benches: nothing
 * matches on them, and they are declared here ONLY so `whitelist: true` does
 * not strip them out of a member's own saved shelf on the next write.
 */
export class BenchBulletDto {
  @IsNumber()
  @Min(0.1)
  @Max(2000)
  weightGr!: number;

  /** Inches. Absent or null on benches saved before calibres were recorded. */
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(2)
  calibreIn?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  maker?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  type?: string;
}

/**
 * PUT /bench/me — the WHOLE bench, every time.
 *
 * ⚠️ IT REPLACES, IT DOES NOT MERGE, and putBench() writes `?? []` for every
 * axis — so an omitted axis is a cleared axis. That is deliberate (see
 * BEHAVIOUR.md §2: a partial write clears what it omits, and an emptied bench
 * looks exactly like a broken one), which is why every field below is
 * required rather than optional: the client must send what it means to keep.
 *
 * 500 is a cap nobody reaches by hand — the whole canonical powder list is a
 * few hundred rows — and it stops one request storing a megabyte in a column
 * every later read of that member's bench has to carry.
 */
export class PutBenchDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  powderIds!: string[];

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BenchBulletDto)
  bullets!: BenchBulletDto[];

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  cartridgeKeys!: string[];

  @IsIn(['metric', 'imperial'])
  units!: string;
}

/* ── The permalink ──────────────────────────────────────────────────────── */

/**
 * POST /bench/share.
 *
 * The payload is the client's own filter object plus a snapshot of the bench
 * it was read against — opaque to the server, which stores and returns it
 * unread. It is capped by SIZE in the service rather than by shape here: the
 * finder's controls change more often than this endpoint should.
 */
export class ShareBenchDto {
  @IsObject()
  payload!: Record<string, unknown>;
}
