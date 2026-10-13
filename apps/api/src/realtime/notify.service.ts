import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationSeverity, Prisma, PrismaClient } from '@ctp/database';
import { type NotificationPayload, WsEvent } from '@ctp/types';
import { fetch as undiciFetch } from 'undici';
import { PRISMA } from '../common/prisma/prisma.service';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { RealtimeService } from './realtime.gateway';

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body?: string;
  severity?: NotificationSeverity;
  data?: Record<string, unknown>;
  /** Also send to the user's Telegram chat (when configured). Default true for WARNING/ERROR. */
  telegram?: boolean;
}

/**
 * In-app notifications (Notification row + realtime push) and optional Telegram alerts.
 * Fire-and-forget: never throws and never blocks the order path (callers don't await it there).
 */
@Injectable()
export class NotifyService {
  private readonly logger = new Logger('Notify');

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly realtime: RealtimeService,
  ) {}

  async notify(n: NotifyInput): Promise<void> {
    try {
      const row = await this.prisma.notification.create({
        data: {
          userId: n.userId,
          type: n.type,
          title: n.title,
          body: n.body ?? null,
          severity: n.severity ?? 'INFO',
          data: (n.data ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      const payload: NotificationPayload = {
        id: row.id,
        type: row.type,
        severity: row.severity,
        title: row.title,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      };
      this.realtime.toUser(n.userId, WsEvent.NOTIFICATION_CREATED, payload);
      const wantTelegram = n.telegram ?? (n.severity === 'WARNING' || n.severity === 'ERROR');
      if (wantTelegram && this.config.TELEGRAM_BOT_TOKEN) {
        const user = await this.prisma.user.findUnique({ where: { id: n.userId }, select: { telegramChatId: true } });
        if (user?.telegramChatId) await this.telegram(user.telegramChatId, `${n.title}${n.body ? `\n${n.body}` : ''}`);
      }
    } catch (err) {
      this.logger.warn(`notify(${n.type}) failed: ${(err as Error).message}`);
    }
  }

  /** Platform alert to the admin Telegram chat + every connected admin socket. */
  async alertAdmins(title: string, body?: string): Promise<void> {
    this.realtime.toRole('ADMIN', WsEvent.NOTIFICATION_CREATED, {
      id: `sys-${Date.now()}`,
      type: 'SYSTEM_ALERT',
      severity: 'WARNING',
      title,
      body: body ?? null,
      createdAt: new Date().toISOString(),
    } satisfies NotificationPayload);
    if (this.config.TELEGRAM_BOT_TOKEN && this.config.TELEGRAM_ADMIN_CHAT_ID) {
      await this.telegram(this.config.TELEGRAM_ADMIN_CHAT_ID, `⚠️ ${title}${body ? `\n${body}` : ''}`);
    }
  }

  private async telegram(chatId: string, text: string): Promise<void> {
    try {
      await undiciFetch(`https://api.telegram.org/bot${this.config.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      this.logger.warn(`Telegram send failed: ${(err as Error).message}`);
    }
  }
}
