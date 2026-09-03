import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { WardenCheckBoard } from './warden.types';

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
   * The server vitals board.
   *
   * 🚨 FOUR OF THESE SIX WERE HARD-CODED `known: false` WITH A LITERAL EM
   * DASH, and the card's own footer told the operator they fill in "until
   * Warden is on it". Warden went on it on 2026-09-03 and they stayed em
   * dashes, because nothing ever read from it — the comment here said "they
   * are Warden's to report" and that was a statement of intent, not of
   * wiring. Once the stated precondition was met, the copy became a false
   * promise rather than an honest gap.
   *
   * ⚠️ THE HONESTY RULE IS UNCHANGED AND IS WHY THIS TAKES A REASON. An
   * unknown still renders as an em dash — but now with the reason Warden gave
   * ("cannot read /var/log/nginx/access.log: Permission denied") instead of
   * the blanket "needs Warden on the box", which is exactly wrong once Warden
   * is there and simply lacks a group membership. A tile showing 0% for a
   * disk nobody measured is worse than one showing nothing; a tile blaming
   * the wrong cause is worse than either.
   *
   * ⚠️ WARDEN IS PASSED IN, NEVER INJECTED. WardenService already depends on
   * this service, so reaching the other way would close a cycle. The
   * controller fetches the board and hands it over, which also keeps this
   * method pure and testable with a literal.
   */
  vitals(warden: WardenCheckBoard | null = null) {
    const mem = process.memoryUsage();
    const row = (id: string) => warden?.rows.find((r) => r.id === id) ?? null;

    /**
     * One Warden check as one tile.
     *
     * `unknown` and an absent row are the same outcome — not measured — but
     * they carry different reasons, and the difference matters to whoever
     * has to fix it: "Warden is not deployed" is a deploy, "Permission
     * denied" is a group membership.
     */
    const fromWarden = (key: string, label: string, id: string) => {
      const r = row(id);
      if (!r) {
        return {
          key,
          label,
          known: false,
          value: '—',
          tone: 'info' as GateTone,
          reason: warden
            ? `Warden ran but reported no ${id} check.`
            : 'Warden is not deployed — nothing has measured this.',
        };
      }
      if (r.status === 'unknown') {
        return { key, label, known: false, value: '—', tone: 'info' as GateTone, reason: r.verdict };
      }
      return {
        key,
        label,
        known: true,
        value: r.verdict,
        tone: (r.status === 'bad' ? 'bad' : r.status === 'warn' ? 'warn' : 'ok') as GateTone,
        reason: undefined,
      };
    };

    return [
      {
        key: 'api_process',
        label: 'Backend',
        known: true,
        value: `up ${Math.floor(process.uptime() / 86400)}d`,
        tone: 'ok' as GateTone,
        reason: undefined,
      },
      {
        key: 'heap',
        label: 'API heap',
        known: true,
        value: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        tone: 'ok' as GateTone,
        reason: undefined,
      },
      fromWarden('disk', 'Disk', 'host-disk'),
      // ⚠️ tls-EDGE, NOT tls-origin. The edge check reads the certificate as
      // actually served, which is the one a member's browser meets. tls-origin
      // reads the file on disk and is EACCES for Warden's service user today —
      // pointing this tile at it would render "not measured" for a certificate
      // that is verifiably fine.
      fromWarden('ssl', 'SSL cert', 'tls-edge'),
      fromWarden('backups', 'Backups', 'backup-last-run'),
      fromWarden('nginx', 'Errors', 'nginx-error-rate'),
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

    // 🚨 EMAIL USED TO BE A BARE LITERAL SAYING "delivering", tone ok — a green
    // tag that was true by assertion, never by measurement. The signal already
    // existed: desk.service.ts counts EmailOutbox rows parked past their retry
    // time and raises the pile card "The email outbox is not draining". So the
    // Site board could show a green Email tag at the same instant the Desk
    // showed an email outage, and both came from this one process.
    //
    // Same 30-minute stall window as that card, deliberately — two numbers for
    // "is email stuck" that could drift apart is how the pair disagreed before.
    const OUTBOX_STALL_MINUTES = 30;
    const emailStalled = await this.prisma.emailOutbox
      .count({
        where: { nextAttemptAt: { lt: new Date(Date.now() - OUTBOX_STALL_MINUTES * 60_000) } },
      })
      .catch(() => null);

    return [
      {
        key: 'email',
        label: 'Email',
        // A failed COUNT is not zero stuck emails — it is no answer, and the
        // board's own rule is that unknown never renders as a healthy state.
        state:
          emailStalled === null
            ? 'not measured'
            : emailStalled > 0
              ? `${emailStalled} stuck`
              : 'delivering',
        tone:
          emailStalled === null
            ? ('neutral' as GateTone)
            : emailStalled > 0
              ? ('warn' as GateTone)
              : ('ok' as GateTone),
        detail:
          emailStalled === null
            ? 'Resend · outbox could not be read'
            : `Resend · outbox, ${OUTBOX_STALL_MINUTES}m stall window`,
      },
      {
        key: 'sms',
        label: 'SMS',
        state: smsFailures > 0 ? `${smsFailures} failed` : 'delivering',
        tone: smsFailures > 0 ? ('warn' as GateTone) : ('ok' as GateTone),
        detail: 'SMSPortal · last 24h',
      },
      {
        key: 'push',
        label: 'Web push',
        // ⚠️ NOTHING RECORDS WEB-PUSH DELIVERY, so there is no honest way to
        // say it is working. This said "delivering" with a green tone, which
        // is the same claim the Email row was making falsely — an assertion
        // wearing the colour of a measurement.
        //
        // `neutral` is the tone WhatsApp already uses below for "real but not
        // reporting", and it exists precisely so a permanent unknown does not
        // sit in amber next to genuine alarms until nobody reads either.
        // Turning this green again requires a failure table to read, not a
        // different literal.
        state: 'not measured',
        tone: 'neutral' as GateTone,
        detail: 'VAPID · no delivery record kept',
      },
      {
        key: 'whatsapp',
        label: 'WhatsApp',
        state: whatsappEnabled ? 'enabled' : 'gated',
        // ⚠️ NOT CONFIGURED IS NOT FAILING. warn is the amber the SMS row wears
        // to say "2 failed"; giving it to a channel nobody has switched on yet
        // parks a permanent false alarm beside a real one, and the real one
        // stops being read. The artboard draws this neutral.
        tone: whatsappEnabled ? ('ok' as GateTone) : ('neutral' as GateTone),
        // ⚠️ The honest line. There is no provider, no WABA and no send path;
        // "0 sent" would read as a working channel having a quiet day.
        detail: whatsappEnabled ? 'enabled' : 'no provider yet · whatsapp_enabled off',
      },
    ];
  }

  async board(warden: WardenCheckBoard | null = null) {
    const [gates, channels] = await Promise.all([this.gates(), this.channels()]);
    return {
      gates,
      channels,
      vitals: this.vitals(warden),
      /**
       * 🚨 THIS WAS HARD-CODED `present: false` and stayed that way after the
       * daemon went live — a second copy of the same mistake as the vitals
       * tiles above, in the same object. It now reports what is actually
       * there.
       */
      warden: warden
        ? {
            present: true,
            note: `Warden last checked ${warden.lastCheckAt ?? 'an unknown time'} — ${warden.counts.bad} bad, ${warden.counts.warn} warn, ${warden.counts.unknown} not measured.`,
          }
        : {
            present: false,
            note: 'Warden is not deployed. Nothing is watching the box automatically yet.',
          },
    };
  }
}
