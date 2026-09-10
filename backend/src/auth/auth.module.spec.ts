import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ActionTokensService } from '../actions/action-tokens.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DiditService } from '../didit/didit.service';
import { AuthModule } from './auth.module';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { AuthOrTokenGuard } from './auth-or-token.guard';
import { KycOrTokenGuard } from './kyc-or-token.guard';
import { ScanHandoffGuard } from './scan-handoff.guard';

// ⚠️ THIS SPEC EXISTS BECAUSE A MISSING LOCAL PROVIDER CRASH-LOOPS THE BOX
// WHILE tsc AND EVERY UNIT TEST STAY GREEN. Nest resolves a controller's
// @UseGuards classes inside the controller's OWN module, so a globally
// registered guard does not cover a controller mounted elsewhere — that is
// what took production down for four minutes on 2026-09-07, and AuthModule is
// now the module every guarded controller in the app depends on.
//
// It compiles the module the way the app does, stubbing only the GLOBAL
// providers. The guards themselves are built for real.
@Global()
@Module({
  providers: [
    // PrismaService is @Global in the app; the test module has to stand it
    // in explicitly or nothing that touches the database can construct.
    { provide: PrismaService, useValue: {} },
    { provide: ActionTokensService, useValue: {} },
    { provide: NotificationsService, useValue: {} },
    { provide: DiditService, useValue: {} },
  ],
  exports: [PrismaService, ActionTokensService, NotificationsService, DiditService],
})
class StubGlobalsModule {}

describe('AuthModule', () => {
  it('boots with its controller and all five guards resolved', async () => {
    const mod = await Test.createTestingModule({
      imports: [StubGlobalsModule, AuthModule],
    }).compile();

    expect(mod.get(AuthService)).toBeInstanceOf(AuthService);
    expect(mod.get(SessionService)).toBeInstanceOf(SessionService);

    // Every guard the rest of the app decorates a controller with. If one of
    // these cannot be constructed here, it cannot be constructed on the box.
    expect(mod.get(AuthGuard)).toBeInstanceOf(AuthGuard);
    expect(mod.get(OptionalAuthGuard)).toBeInstanceOf(OptionalAuthGuard);
    expect(mod.get(AuthOrTokenGuard)).toBeInstanceOf(AuthOrTokenGuard);
    expect(mod.get(KycOrTokenGuard)).toBeInstanceOf(KycOrTokenGuard);
    expect(mod.get(ScanHandoffGuard)).toBeInstanceOf(ScanHandoffGuard);

    await mod.close();
  });
});
