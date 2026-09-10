import { Module, Global } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { OptionalAuthGuard } from './optional-auth.guard';
import { AuthOrTokenGuard } from './auth-or-token.guard';
import { KycOrTokenGuard } from './kyc-or-token.guard';
import { ScanHandoffGuard } from './scan-handoff.guard';
import { SessionService } from './session.service';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

/**
 * Global so any controller can `@UseGuards(AuthGuard)` (or one of the dual-auth
 * guards for endpoints reachable from an SMS link) without importing this
 * module.
 *
 * ⚠️ Being global does NOT excuse a module from providing a guard it uses when
 * that guard has its own injected dependencies — Nest resolves a controller's
 * `@UseGuards` classes inside the controller's OWN module. Getting that wrong
 * crash-loops the backend at boot while tsc and every unit test stay green.
 * That is what auth.module.spec.ts is for.
 *
 * `JwtModule.register({})` is empty on purpose: every sign and verify passes
 * its secret explicitly, so the member secret and the admin secret can never
 * be confused for one another by a module-level default.
 *
 * ⚠️ IT IMPORTS NEITHER ActionTokensModule NOR NotificationsModule, ON
 * PURPOSE. Both are @Global, so their services inject without an import —
 * and importing them here drags their whole dependency graph into every
 * boot spec that compiles this module, which is how the cycle that used to
 * need a forwardRef got there in the first place.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    SessionService,
    AuthService,
    AuthGuard,
    OptionalAuthGuard,
    AuthOrTokenGuard,
    KycOrTokenGuard,
    ScanHandoffGuard,
  ],
  exports: [
    SessionService,
    AuthService,
    AuthGuard,
    OptionalAuthGuard,
    AuthOrTokenGuard,
    KycOrTokenGuard,
    ScanHandoffGuard,
  ],
})
export class AuthModule {}
