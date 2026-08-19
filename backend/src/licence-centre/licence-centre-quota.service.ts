import { Injectable, NotFoundException } from '@nestjs/common';
import { FLAGS, SettingsService } from '../settings/settings.service';

// The flag gate, kept in its own service so the HTTP path, the admin path and
// anything else that grows later all pass through one check.
//
// ⚠️ THE RETENTION SWEEP MUST NOT USE THIS. A purge routed through a
// flag-gated service deletes nothing while the flag is off, and still stamps a
// healthy heartbeat — the failure mode where a POPIA job looks green and does
// nothing. Retention talks to Prisma and the file store directly.

@Injectable()
export class LicenceCentreQuotaService {
  constructor(private readonly settings: SettingsService) {}

  async isEnabled(): Promise<boolean> {
    return this.settings.get(FLAGS.licenceCentreEnabled);
  }

  /**
   * 404, not 403: with the module off it should not be discoverable that it
   * exists at all.
   */
  async assertEnabled(): Promise<void> {
    if (!(await this.isEnabled())) throw new NotFoundException('Not found');
  }

  /**
   * Read by the page before anything else, so a member sees the "not open
   * yet" state instead of the frontend 404-storming every endpoint.
   */
  async status(): Promise<{
    enabled: boolean;
    reminders: boolean;
    maxCredentials: number;
  }> {
    const [enabled, reminders, maxCredentials] = await Promise.all([
      this.settings.get(FLAGS.licenceCentreEnabled),
      this.settings.get(FLAGS.licenceCentreRemindersEnabled),
      this.settings.get(FLAGS.licenceCentreMaxCredentials),
    ]);
    return { enabled, reminders, maxCredentials };
  }
}
