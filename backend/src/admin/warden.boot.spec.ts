import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { AdminAuditService } from './admin-audit.service';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { WardenController } from './warden.controller';
import { WardenService } from './warden.service';

/**
 * ⚠️ THE CRASH-LOOP SPEC. AdminJwtGuard resolves INSIDE the module that mounts
 * its controller, and it injects JwtService + PrismaService + Reflector. A
 * controller added to AdminModule without those locally is invisible to tsc and
 * to every unit spec, and then pm2 restart-loops the API on the box (the exact
 * incident news.module.spec.ts was written for, 2026-09-07).
 *
 * This compiles WardenController with the guard instantiated for REAL — only
 * the guard's own dependencies are stubbed — so a missing local dependency
 * fails here rather than on the box. WardenService is real too, which proves
 * its single constructor dependency (AdminAuditService) resolves.
 */
describe('WardenController boots inside AdminModule', () => {
  it('resolves the controller, its guard and its service', async () => {
    const mod = await Test.createTestingModule({
      controllers: [WardenController],
      providers: [
        WardenService,
        AdminJwtGuard,
        { provide: JwtService, useValue: { verifyAsync: async () => ({}) } },
        { provide: PrismaService, useValue: {} },
        { provide: AdminAuditService, useValue: { record: async () => undefined } },
        { provide: Reflector, useValue: { getAllAndOverride: () => undefined } },
      ],
    }).compile();

    expect(mod.get(WardenController)).toBeInstanceOf(WardenController);
    expect(mod.get(WardenService)).toBeInstanceOf(WardenService);
    expect(mod.get(AdminJwtGuard)).toBeInstanceOf(AdminJwtGuard);
    await mod.close();
  });
});
