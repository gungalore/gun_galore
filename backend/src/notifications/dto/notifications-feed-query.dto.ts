import { IsEnum, IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { NotificationCategory } from '@prisma/client';

export class NotificationsFeedQueryDto {
  @IsOptional()
  @IsEnum(NotificationCategory)
  category?: NotificationCategory;

  // 'active' (default) — only unresolved rows
  // 'resolved' — only resolved rows (history)
  // 'all' — both
  @IsOptional()
  @IsEnum(['active', 'resolved', 'all'])
  status?: 'active' | 'resolved' | 'all';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  // Cursor for "Load more" — pass the createdAt of the last row in the
  // previous page; server returns rows strictly older than this.
  @IsOptional()
  @IsISO8601()
  before?: string;
}
