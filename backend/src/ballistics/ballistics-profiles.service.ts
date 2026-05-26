import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * CRUD over `UserBallisticProfile`. Local-first on the client (writes
 * land in localStorage immediately + sync queue pushes to server) but
 * the server is the source of truth for cross-device merging.
 *
 * Plan cap: 20 profiles per user. Enforced at create time. The user
 * can delete + re-create to free a slot.
 *
 * Purchaser-only — the controller asserts a license before calling
 * any method here. Default-flag enforcement (exactly one default per
 * user) is done in the upsert path because Postgres can't enforce a
 * "max one true" partial-unique constraint cleanly.
 */
const MAX_PROFILES_PER_USER = 20;

export interface ProfileDto {
  id?: string;
  name: string;
  rifleName?: string | null;
  twist?: string | null;
  scopeHeightCm?: number | null;
  bulletName?: string | null;
  bulletWeightGr: number;
  bcG1: number;
  bcG7?: number | null;
  dragModel?: 'G1' | 'G7';
  muzzleVelocityFps: number;
  zeroM?: number;
  preferredUnitElev?: 'mil' | 'moa' | 'clk';
  preferredUnitRange?: 'm' | 'yd';
  zeroAdjMil?: number;
  aiSourcedAt?: Date | null;
  isDefault?: boolean;
}

@Injectable()
export class BallisticsProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.userBallisticProfile.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async create(userId: string, dto: ProfileDto) {
    this.validateDto(dto);
    const count = await this.prisma.userBallisticProfile.count({
      where: { userId },
    });
    if (count >= MAX_PROFILES_PER_USER) {
      throw new ForbiddenException({
        message: `Profile limit reached (${MAX_PROFILES_PER_USER}). Delete an old profile to make room.`,
        code: 'profile-cap-reached',
      });
    }
    // If this is being created as default, clear other defaults first.
    if (dto.isDefault) {
      await this.prisma.userBallisticProfile.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    try {
      return await this.prisma.userBallisticProfile.create({
        data: this.toCreateData(userId, dto),
      });
    } catch (err) {
      // unique([userId, name]) — friendlier error.
      if (
        err instanceof Error &&
        err.message.includes('Unique constraint failed')
      ) {
        throw new BadRequestException({
          message: `You already have a profile named "${dto.name}". Pick a different name.`,
          code: 'profile-name-conflict',
        });
      }
      throw err;
    }
  }

  async update(userId: string, profileId: string, dto: Partial<ProfileDto>) {
    const existing = await this.prisma.userBallisticProfile.findUnique({
      where: { id: profileId },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Profile not found.');
    }
    if (dto.isDefault) {
      await this.prisma.userBallisticProfile.updateMany({
        where: { userId, isDefault: true, NOT: { id: profileId } },
        data: { isDefault: false },
      });
    }
    return this.prisma.userBallisticProfile.update({
      where: { id: profileId },
      data: this.toUpdateData(dto),
    });
  }

  async delete(userId: string, profileId: string) {
    const existing = await this.prisma.userBallisticProfile.findUnique({
      where: { id: profileId },
      select: { userId: true, isDefault: true },
    });
    if (!existing || existing.userId !== userId) {
      throw new NotFoundException('Profile not found.');
    }
    await this.prisma.userBallisticProfile.delete({
      where: { id: profileId },
    });
    // If we just deleted the default, promote the most recently
    // updated remaining profile so the next launch has something to
    // load instantly (no half-state on the client).
    if (existing.isDefault) {
      const next = await this.prisma.userBallisticProfile.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (next) {
        await this.prisma.userBallisticProfile.update({
          where: { id: next.id },
          data: { isDefault: true },
        });
      }
    }
    return { ok: true };
  }

  /**
   * Duplicate an existing profile under a new name. Frontend convenience
   * for "I want to tweak this load without losing my original".
   */
  async duplicate(userId: string, profileId: string, newName: string) {
    const src = await this.prisma.userBallisticProfile.findUnique({
      where: { id: profileId },
    });
    if (!src || src.userId !== userId) {
      throw new NotFoundException('Profile not found.');
    }
    const cleanName = newName.trim().slice(0, 60) || `${src.name} (copy)`;
    return this.create(userId, {
      name: cleanName,
      rifleName: src.rifleName,
      twist: src.twist,
      scopeHeightCm: src.scopeHeightCm,
      bulletName: src.bulletName,
      bulletWeightGr: src.bulletWeightGr,
      bcG1: src.bcG1,
      bcG7: src.bcG7,
      dragModel: src.dragModel as 'G1' | 'G7',
      muzzleVelocityFps: src.muzzleVelocityFps,
      zeroM: src.zeroM,
      preferredUnitElev: src.preferredUnitElev as 'mil' | 'moa' | 'clk',
      preferredUnitRange: src.preferredUnitRange as 'm' | 'yd',
      zeroAdjMil: src.zeroAdjMil,
      isDefault: false, // never auto-promote a duplicate
    });
  }

  private validateDto(dto: ProfileDto): void {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new BadRequestException('Profile name is required.');
    }
    if (dto.name.length > 60) {
      throw new BadRequestException('Profile name must be ≤ 60 chars.');
    }
    if (dto.bulletWeightGr <= 0 || dto.bulletWeightGr > 1000) {
      throw new BadRequestException('Bullet weight must be 1–1000 gr.');
    }
    if (dto.bcG1 <= 0 || dto.bcG1 > 1.5) {
      throw new BadRequestException('BC G1 must be 0.05–1.5.');
    }
    if (
      dto.muzzleVelocityFps <= 0 ||
      dto.muzzleVelocityFps > 5000
    ) {
      throw new BadRequestException('Muzzle velocity must be 300–5000 fps.');
    }
  }

  private toCreateData(userId: string, dto: ProfileDto) {
    return {
      userId,
      name: dto.name.trim(),
      rifleName: dto.rifleName?.trim() || null,
      twist: dto.twist?.trim() || null,
      scopeHeightCm: dto.scopeHeightCm ?? null,
      bulletName: dto.bulletName?.trim() || null,
      bulletWeightGr: dto.bulletWeightGr,
      bcG1: dto.bcG1,
      bcG7: dto.bcG7 ?? null,
      dragModel: dto.dragModel ?? 'G1',
      muzzleVelocityFps: dto.muzzleVelocityFps,
      zeroM: dto.zeroM ?? 100,
      preferredUnitElev: dto.preferredUnitElev ?? 'mil',
      preferredUnitRange: dto.preferredUnitRange ?? 'm',
      zeroAdjMil: dto.zeroAdjMil ?? 0,
      aiSourcedAt: dto.aiSourcedAt ?? null,
      isDefault: dto.isDefault ?? false,
    };
  }

  private toUpdateData(dto: Partial<ProfileDto>) {
    const out: Record<string, unknown> = {};
    if (dto.name !== undefined) out.name = dto.name.trim();
    if (dto.rifleName !== undefined)
      out.rifleName = dto.rifleName?.trim() || null;
    if (dto.twist !== undefined) out.twist = dto.twist?.trim() || null;
    if (dto.scopeHeightCm !== undefined) out.scopeHeightCm = dto.scopeHeightCm;
    if (dto.bulletName !== undefined)
      out.bulletName = dto.bulletName?.trim() || null;
    if (dto.bulletWeightGr !== undefined)
      out.bulletWeightGr = dto.bulletWeightGr;
    if (dto.bcG1 !== undefined) out.bcG1 = dto.bcG1;
    if (dto.bcG7 !== undefined) out.bcG7 = dto.bcG7;
    if (dto.dragModel !== undefined) out.dragModel = dto.dragModel;
    if (dto.muzzleVelocityFps !== undefined)
      out.muzzleVelocityFps = dto.muzzleVelocityFps;
    if (dto.zeroM !== undefined) out.zeroM = dto.zeroM;
    if (dto.preferredUnitElev !== undefined)
      out.preferredUnitElev = dto.preferredUnitElev;
    if (dto.preferredUnitRange !== undefined)
      out.preferredUnitRange = dto.preferredUnitRange;
    if (dto.zeroAdjMil !== undefined) out.zeroAdjMil = dto.zeroAdjMil;
    if (dto.aiSourcedAt !== undefined) out.aiSourcedAt = dto.aiSourcedAt;
    if (dto.isDefault !== undefined) out.isDefault = dto.isDefault;
    return out;
  }
}
