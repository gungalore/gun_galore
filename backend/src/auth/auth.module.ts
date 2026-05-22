import { Module, Global } from '@nestjs/common';
import { ClerkGuard } from './clerk.guard';
import { UsersModule } from '../users/users.module';

// Global so any controller can `@UseGuards(ClerkGuard)` without needing
// to import this module explicitly. The guard depends on PrismaService
// (already global via PrismaModule) and UsersService (imported here).
@Global()
@Module({
  imports: [UsersModule],
  providers: [ClerkGuard],
  exports: [ClerkGuard],
})
export class AuthModule {}
