import 'reflect-metadata';
import { MotivationsModule } from './motivations.module';
import { MotivationRetentionService } from './motivation-retention.service';
import { SecureFileStorageService } from '../common/secure-file-storage.service';
import { UsersModule } from '../users/users.module';

// Nest resolves modules at RUNTIME. A provider that is used but not exported,
// or a module that is depended on but not imported, type-checks perfectly and
// then crash-loops the app at boot — this codebase already carries a warning
// about exactly that in motivations.module.ts.
//
// So the wiring is asserted off the decorator metadata, which is the same thing
// Nest itself reads.

const meta = (m: unknown, key: string): unknown[] =>
  (Reflect.getMetadata(key, m as object) as unknown[]) ?? [];

describe('module wiring', () => {
  it('exports the retention service, because account deletion needs it', () => {
    // UsersService injects it to remove a member's encrypted licence documents
    // BEFORE the cascade takes the rows that point at them.
    expect(meta(MotivationsModule, 'exports')).toContain(
      MotivationRetentionService,
    );
  });

  it('does NOT export the encrypted file store', () => {
    // Deliberately scoped to this module so nothing else can start writing user
    // files into it without a deliberate decision. Exporting it would make that
    // a one-line accident.
    expect(meta(MotivationsModule, 'exports')).not.toContain(
      SecureFileStorageService,
    );
    expect(meta(MotivationsModule, 'providers')).toContain(
      SecureFileStorageService,
    );
  });

  it('provides the retention service it exports', () => {
    // Exporting something a module does not provide is a boot-time failure.
    expect(meta(MotivationsModule, 'providers')).toContain(
      MotivationRetentionService,
    );
  });

  it('is imported by UsersModule, which injects from it', () => {
    expect(meta(UsersModule, 'imports')).toContain(MotivationsModule);
  });

  it('does not depend on UsersModule, so there is no cycle', () => {
    // UsersModule -> MotivationsModule is safe only while it stays one-way.
    expect(meta(MotivationsModule, 'imports')).not.toContain(UsersModule);
  });
});
