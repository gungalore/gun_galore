import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { LlmService } from '../llm/llm.service';

export type DocumentEngineAction =
  | 'GENERATE'
  | 'MOTIVATION_UPLOAD'
  | 'VAULT_UPLOAD';

export interface DocumentEngineStatus {
  available: boolean;
  reason: 'ok' | 'maintenance';
  message: string;
  retryAt: string | null;
}

const FAILURES_TO_OPEN = 2;
const PROBE_AFTER_MS = 5 * 60 * 1000;
const MESSAGE =
  'Document preparation is paused while the document engine is under maintenance. We will email you when it is available again.';

/**
 * Whether the Jev-backed document engine may be used, and who is waiting.
 *
 * ⚠️ JEV IS THE ONLY CLASSIFIER. When it is down, generation and document
 * uploads must stop rather than fall through to a second classifier. The
 * circuit is deliberately small and in-memory: one process owns the site, and
 * the durable part is the notice table, not the availability flag.
 */
@Injectable()
export class DocumentEngineService {
  private readonly logger = new Logger(DocumentEngineService.name);
  private failures = 0;
  private openUntil = 0;
  private outageId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly notifications: NotificationsService,
  ) {}

  status(): DocumentEngineStatus {
    const available = this.available();
    return {
      available,
      reason: available ? 'ok' : 'maintenance',
      message: available
        ? 'The document engine is available.'
        : MESSAGE,
      retryAt: available || !this.openUntil ? null : new Date(this.openUntil).toISOString(),
    };
  }

  available(): boolean {
    if (!this.hasKey()) return false;
    return Date.now() >= this.openUntil;
  }

  hasKey(): boolean {
    return Boolean(process.env.JEV_API_KEY);
  }

  /**
   * Stop a generation or upload before it spends anything.
   *
   * This is also the door that records the member's interest, so a client that
   * correctly intercepted the action still gets the recovery email.
   */
  async assertAvailable(args: {
    userId: string;
    motivationId?: string | null;
    action: DocumentEngineAction;
  }): Promise<void> {
    if (this.available()) return;
    await this.record(args).catch(() => undefined);
    throw new ServiceUnavailableException({
      statusCode: 503,
      error: 'Service Unavailable',
      code: 'document_engine_maintenance',
      message: MESSAGE,
    });
  }

  /** Record a blocked action without throwing. Used by the client-side notice. */
  async record(args: {
    userId: string;
    motivationId?: string | null;
    action: DocumentEngineAction;
  }): Promise<void> {
    if (this.available()) return;
    if (!this.outageId) this.outageId = randomUUID();

    const motivationId = (args.motivationId ?? '').trim();
    const already = await this.prisma.documentEngineNotice.findFirst({
      where: {
        userId: args.userId,
        motivationId,
        action: args.action,
        notifiedAt: null,
      },
      select: { id: true },
    });
    if (already) return;

    await this.prisma.documentEngineNotice
      .create({
        data: {
          userId: args.userId,
          motivationId,
          action: args.action,
          outageId: this.outageId,
        },
      })
      .catch((err: unknown) => {
        // A concurrent request may have won the unique key. That is the desired
        // state, not a failed notice.
        if (!/unique|P2002/i.test((err as Error).message)) {
          this.logger.warn(
            `Could not record document-engine notice: ${(err as Error).message}`,
          );
        }
      });
  }

  /** A real Jev call succeeded. Close the circuit and tell the waiters. */
  reportSuccess(): void {
    const wasOpen = this.openUntil > 0 || this.failures > 0;
    this.failures = 0;
    this.openUntil = 0;
    if (wasOpen) void this.sendPending();
  }

  /** A real Jev call failed. Open the circuit after the second failure. */
  reportFailure(): void {
    if (!this.hasKey()) {
      this.openUntil = Date.now() + PROBE_AFTER_MS;
      if (!this.outageId) this.outageId = randomUUID();
      return;
    }
    this.failures += 1;
    if (this.failures >= FAILURES_TO_OPEN) {
      this.openUntil = Date.now() + PROBE_AFTER_MS;
      if (!this.outageId) this.outageId = randomUUID();
      this.logger.warn(
        `Document engine opened after ${this.failures} consecutive Jev failures`,
      );
    }
  }

  /**
   * While the circuit is open, ask Jev one cheap text question every five
   * minutes. Images are not used for the probe: a text call is smaller and
   * answers the question "is the service back".
   */
  @Cron('*/5 * * * *')
  async probe(): Promise<void> {
    if (!this.hasKey() || this.available()) return;
    try {
      const res = await this.llm.decide({
        state: { probe: 'document-engine-availability' },
        questions: {
          reachable: {
            type: 'noul',
            instructions: 'Is this request being answered by TypeSafe System One?',
          },
        },
        purpose: 'document.engine.probe',
        timeoutMs: 10_000,
      });
      if (res.answers.reachable) {
        this.reportSuccess();
        this.logger.log('Document engine recovered');
      }
    } catch {
      // Still down. Keep the circuit open; the next cron tick tries again.
      this.openUntil = Date.now() + PROBE_AFTER_MS;
    }
  }

  /** Send one email per user for everything they tried during this outage. */
  async sendPending(): Promise<number> {
    const pending = await this.prisma.documentEngineNotice.findMany({
      where: { notifiedAt: null },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    if (!pending.length) return 0;

    const byUser = new Map<string, typeof pending>();
    for (const row of pending) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row);
      byUser.set(row.userId, list);
    }

    let sent = 0;
    for (const [userId, rows] of byUser) {
      const user = await this.prisma.user
        .findUnique({
          where: { id: userId },
          select: { email: true, firstName: true },
        })
        .catch(() => null);
      if (user?.email) {
        try {
          await this.notifications.documentEngineResumed({
            userId,
            email: user.email,
            name: user.firstName ?? 'there',
            items: rows.map((row) => ({
              motivationId: row.motivationId || null,
              action: row.action as DocumentEngineAction,
            })),
          });
          sent += 1;
        } catch (err) {
          this.logger.warn(
            `Recovery email failed for ${userId}: ${(err as Error).message}`,
          );
          continue;
        }
      }

      await this.prisma.documentEngineNotice
        .updateMany({
          where: { id: { in: rows.map((row) => row.id) } },
          data: { notifiedAt: new Date() },
        })
        .catch(() => undefined);
    }

    return sent;
  }
}
