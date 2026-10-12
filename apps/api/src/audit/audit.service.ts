import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import type { AuditAction, Prisma, PrismaClient } from '@ctp/database';
import { redact } from '@ctp/shared';
import { PRISMA } from '../common/prisma/prisma.service';
import type { ClientInfo } from '../auth/token.service';

export interface AuditEntry {
  action: AuditAction;
  actorUserId?: string | null;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  client?: ClientInfo;
}

type Tx = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private toData(entry: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    return {
      action: entry.action,
      actorUserId: entry.actorUserId ?? null,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      // Secrets are stripped by key name before anything is persisted.
      metadata: entry.metadata ? (redact(entry.metadata) as Prisma.InputJsonValue) : undefined,
      ip: entry.client?.ip ?? null,
      userAgent: entry.client?.userAgent?.slice(0, 512) ?? null,
    };
  }

  /** Writes inside the caller's transaction so the audit row commits/rolls back with the change. */
  async logTx(tx: Tx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.toData(entry) });
  }

  /** Best-effort write for events outside a transaction (e.g. failed logins). Never throws. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({ data: this.toData(entry) });
    } catch (err) {
      this.logger.error(`Failed to write audit log ${entry.action}: ${(err as Error).message}`);
    }
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
