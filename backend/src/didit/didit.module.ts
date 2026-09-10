import { Global, Module } from '@nestjs/common';
import { DiditService } from './didit.service';

/**
 * Global because three unrelated surfaces need it — sign-up (email OTP), the
 * profile phone card (phone OTP) and seller verification (KYC sessions) — and
 * every one of them must go through the single adapter rather than reaching
 * for fetch and an API key of its own.
 */
@Global()
@Module({
  providers: [DiditService],
  exports: [DiditService],
})
export class DiditModule {}
