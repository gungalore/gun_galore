import 'reflect-metadata';
import { JwtModule } from '@nestjs/jwt';
import { LicenceCentreModule } from './licence-centre.module';
import { LicenceCentreRetentionService } from './licence-centre-retention.service';
import { LicenceCentreQuotaService } from './licence-centre-quota.service';
import { LicenceCentreRemindersService } from './licence-centre-reminders.service';
import { LicenceCentreAdminController } from './licence-centre-admin.controller';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { AdminJwtGuard } from '../admin/guards/admin-jwt.guard';
import { UsersModule } from '../users/users.module';
import { MotivationsModule } from '../motivations/motivations.module';

// Nest resolves modules at RUNTIME. A provider that is used but not exported,
// or a guard whose JwtService has no JwtModule behind it, type-checks perfectly
// and then crash-loops the app at boot — which on this project means a deploy
// that reports success and a site that is down.
//
// So the wiring is asserted off the decorator metadata, which is what Nest
// itself reads.

const meta = (m: unknown, key: string): unknown[] =>
  (Reflect.getMetadata(key, m as object) as unknown[]) ?? [];

describe('module wiring', () => {
  it('registers JwtModule, because it hosts an AdminJwtGuard controller', () => {
    // ⚠️ THE CRASH-LOOP. AdminJwtGuard constructor-injects JwtService. A module
    // with an admin controller and no JwtModule.register({}) compiles clean and
    // dies at boot. Two other modules in this repo carry the same warning.
    expect(meta(LicenceCentreModule, 'controllers')).toContain(
      LicenceCentreAdminController,
    );
    const imports = meta(LicenceCentreModule, 'imports');
    expect(imports.length).toBeGreaterThan(0);
    // JwtModule.register({}) returns a DynamicModule wrapping JwtModule.
    expect(
      imports.some(
        (m) => (m as { module?: unknown })?.module === JwtModule || m === JwtModule,
      ),
    ).toBe(true);
  });

  it('provides the guard as well as importing the module', () => {
    // Both halves are required; either alone still crash-loops.
    expect(meta(LicenceCentreModule, 'providers')).toContain(AdminJwtGuard);
  });

  it('exports the retention service, because account deletion needs it', () => {
    expect(meta(LicenceCentreModule, 'exports')).toContain(
      LicenceCentreRetentionService,
    );
    // Exporting something a module does not provide is a boot-time failure.
    expect(meta(LicenceCentreModule, 'providers')).toContain(
      LicenceCentreRetentionService,
    );
  });

  it('does NOT export the encrypted file store', () => {
    // Scoped here so nothing else can start writing member files into the
    // vault namespace without a deliberate decision.
    expect(meta(LicenceCentreModule, 'exports')).not.toContain(
      SecureFileStorageService,
    );
    expect(meta(LicenceCentreModule, 'providers')).toContain(
      SecureFileStorageService,
    );
  });

  it('provides the reminder cron and the flag gate', () => {
    const providers = meta(LicenceCentreModule, 'providers');
    expect(providers).toContain(LicenceCentreRemindersService);
    expect(providers).toContain(LicenceCentreQuotaService);
  });

  it('is imported by UsersModule, which injects from it', () => {
    expect(meta(UsersModule, 'imports')).toContain(LicenceCentreModule);
  });

  it('imports MotivationsModule for the renewal one-tap', () => {
    // startRenewal hands off to MotivationsService rather than writing a
    // second creation path: the writer owns the MO reference number, the beta
    // seat check, the profile prefill and the variant seed.
    expect(meta(LicenceCentreModule, 'imports')).toContain(MotivationsModule);
  });

  it('is not imported BY motivations, so the dependency stays one-way', () => {
    expect(meta(MotivationsModule, 'imports')).not.toContain(
      LicenceCentreModule,
    );
  });

  it('does not depend on UsersModule, so there is no cycle', () => {
    expect(meta(LicenceCentreModule, 'imports')).not.toContain(UsersModule);
  });
});
