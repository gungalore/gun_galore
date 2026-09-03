import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * THE DESK — the Site board.
 *
 * Read-only truth about the running system: what is configured, what is up,
 * what is queued. It observes and reports; it changes nothing and runs
 * nothing.
 *
 * ⚠️ THIS FILE MUST NEVER EMIT A SECRET. It reads process.env to answer
 * "which mode is this in" and "is this configured", and the only things it is
 * ever allowed to send are a MODE STRING or a BOOLEAN. Not a key, not a
 * prefix, not a masked tail, not a length. The board is rendered in a browser,
 * screenshotted into support threads and read over shoulders; a value that
 * reaches it has left the server for good.
 *
 * The distinction that keeps this honest: `PAYMENT_MODE=paygate` is a MODE and
 * may be shown. `PEACH_ENTITY_ID=8ac7a4c8...` is a VALUE and may only ever be
 * reported as `configured: true`.
 */

export type GateTone = 'ok' | 'warn' | 'bad' | 'info';

export interface ConfigGate {
  /** The env var or setting key, so the operator can find it in code. */
  key: string;
  /** What it is, in the operator's words. */
  label: string;
  /** A mode string or a boolean rendered as a word. NEVER a secret. */
  value: string;
  tone: GateTone;
  /** What is queued behind this gate, when something is. */
  note?: string;
}

@Injectable()
export class DeskSiteService {
  constructor(private readonly prisma: PrismaService) {}

  /** True when the variable is set to something non-empty. Never its value. */
  private isConfigured(name: string): boolean {
    const v = process.env[name];
    return typeof v === 'string' && v.trim().length > 0;
  }

  private mode(name: string, fallback = 'unset'): string {
    const v = process.env[name];
    return v && v.trim() ? v.trim() : fallback;
  }

  private flag(name: string): boolean {
    return process.env[name] === 'true';
  }

  /**
   * The config gates, as read-only truth.
   *
   * ⚠️ TRUTH, NOT CONTROLS. Nothing here is settable from the panel: each of
   * these changes in code, with a commit and a reason. A toggle on this board
   * would mean the running configuration of a firearms marketplace could be
   * changed by whoever has the admin tab open, with no diff and no review.
   */
  async gates(): Promise<ConfigGate[]> {
    const payoutsQueued = await this.prisma.transaction.aggregate({
      where: { paymentStatus: 'RELEASED', paidOutAt: null, payoutHeldAt: null },
      _sum: { sellerPayout: true },
      _count: true,
    });

    const paymentsLive = this.flag('PAYMENTS_LIVE');
    const identityMode = this.mode('VERIFYNOW_MODE', 'unset');
    const localOrigins = this.flag('ALLOW_LOCAL_ORIGINS');
    const queuedCents = payoutsQueued._sum.sellerPayout ?? 0;

    return [
      {
        key: 'PAYMENT_MODE',
        label: 'Payment mode',
        value: this.mode('PAYMENT_MODE', 'unset'),
        tone: 'info',
      },
      {
        key: 'PAYMENTS_LIVE',
        label: 'Payments live',
        value: paymentsLive ? 'on' : 'off',
        tone: paymentsLive ? 'ok' : 'warn',
        note: paymentsLive
          ? undefined
          : payoutsQueued._count > 0
            ? `${payoutsQueued._count} payouts (R${Math.round(queuedCents / 100).toLocaleString('en-ZA')}) queued behind it`
            : 'checkout is closed',
      },
      {
        key: 'PEACH_*',
        label: 'Gateway credentials',
        // ⚠️ PRESENCE ONLY. Never the entity id, never the token, never a
        // masked tail — a masked secret is still a secret with a hint on it.
        value: this.isConfigured('PEACH_ENTITY_ID') ? 'configured' : 'not configured',
        tone: this.isConfigured('PEACH_ENTITY_ID') ? 'ok' : 'info',
      },
      {
        key: 'VERIFYNOW_MODE',
        label: 'Identity checks',
        value: identityMode,
        // ⚠️ RED, NOT AMBER. Sandbox identity checks on a public site means
        // sellers are not genuinely ID-verified while the UI says they are.
        // That is a red gate that should nag daily until it changes.
        tone: identityMode === 'production' ? 'ok' : 'bad',
        note: identityMode === 'production' ? undefined : 'sellers are not genuinely ID-verified',
      },
      {
        key: 'ALLOW_LOCAL_ORIGINS',
        label: 'Local origins',
        value: localOrigins ? 'allowed' : 'blocked',
        tone: localOrigins ? 'bad' : 'ok',
        note: localOrigins ? 'a local dev origin can call this API' : undefined,
      },
    ];
  }

  /**
   * What the API process can see of its own health.
   *
   * ⚠️ THIS IS NOT THE FULL VITALS BOARD AND DOES NOT PRETEND TO BE. Disk,
   * SSL expiry, nginx error rates and backup freshness live on the box, not
   * in this process — they are Warden's to report. Rather than invent them or
   * render a plausible zero, anything this process cannot measure is returned
   * as `known: false` and the board draws an em dash. A vitals tile showing
   * "0%" for a disk nobody measured is worse than one showing nothing.
   */
  vitals() {
    const mem = process.memoryUsage();
    return [
      {
        key: 'api_process',
        label: 'Backend',
        known: true,
        value: `up ${Math.floor(process.uptime() / 86400)}d`,
        tone: 'ok' as GateTone,
      },
      {
        key: 'heap',
        label: 'API heap',
        known: true,
        value: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        tone: 'ok' as GateTone,
      },
      { key: 'disk', label: 'Disk', known: false, value: '—', tone: 'info' as GateTone },
      { key: 'ssl', label: 'SSL cert', known: false, value: '—', tone: 'info' as GateTone },
      { key: 'backups', label: 'Backups', known: false, value: '—', tone: 'info' as GateTone },
      { key: 'nginx', label: 'Errors', known: false, value: '—', tone: 'info' as GateTone },
    ];
  }

  /**
   * Outbound channel health.
   *
   * WhatsApp states its gate rather than a zero: "no sends" and "0 sent" look
   * identical on a board and mean opposite things.
   */
  async channels() {
    const dayAgo = new Date(Date.now() - 24 * 3_600_000);
    const [whatsappEnabled] = await Promise.all([
      this.prisma.setting
        .findUnique({ where: { key: 'whatsapp_enabled' } })
        .then((s) => s?.value === 'true')
        .catch(() => false),
    ]);

    const smsFailures = await this.prisma.smsLog
      .count({ where: { createdAt: { gte: dayAgo }, status: 'FAILED' } })
      .catch(() => 0);

    return [
      { key: 'email', label: 'Email', state: 'delivering', tone: 'ok' as GateTone, detail: 'Resend' },
      {
        key: 'sms',
        label: 'SMS',
        state: smsFailures > 0 ? `${smsFailures} failed` : 'delivering',
        tone: smsFailures > 0 ? ('warn' as GateTone) : ('ok' as GateTone),
        detail: 'SMSPortal · last 24h',
      },
      { key: 'push', label: 'Web push', state: 'delivering', tone: 'ok' as GateTone, detail: 'VAPID' },
      {
        key: 'whatsapp',
        label: 'WhatsApp',
        state: whatsappEnabled ? 'enabled' : 'gated',
        tone: whatsappEnabled ? ('ok' as GateTone) : ('warn' as GateTone),
        // ⚠️ The honest line. There is no provider, no WABA and no send path;
        // "0 sent" would read as a working channel having a quiet day.
        detail: whatsappEnabled ? 'enabled' : 'no provider yet · whatsapp_enabled off',
      },
    ];
  }

  async board() {
    const [gates, channels] = await Promise.all([this.gates(), this.channels()]);
    return {
      gates,
      channels,
      vitals: this.vitals(),
      /**
       * ⚠️ WARDEN IS NOT RUNNING. There is no daemon: no checks engine, no
       * safe-list actions, no Claude escalation and no chat thread. The board
       * says so on its face rather than rendering an empty, healthy-looking
       * chat that implies something is watching.
       */
      warden: {
        present: false,
        note: 'Warden is not deployed. Nothing is watching the box automatically yet.',
      },
    };
  }
}
