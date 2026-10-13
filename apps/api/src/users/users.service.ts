import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { PrismaClient } from '@ctp/database';
import { hashPassword, verifyPassword } from '@ctp/shared';
import type { AuthUser } from '@ctp/types';
import { AuditService } from '../audit/audit.service';
import { TokenService } from '../auth/token.service';
import { clientInfo } from '../common/client-info';
import type { RequestUser } from '../common/decorators/auth.decorators';
import { toAuthUser } from '../common/mappers';
import { PRISMA } from '../common/prisma/prisma.service';
import { ChangePasswordDto, UpdateProfileDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly tokens: TokenService,
  ) {}

  async updateProfile(userId: string, dto: UpdateProfileDto, req: Request): Promise<AuthUser> {
    const data: { name?: string; mobile?: string | null; telegramChatId?: string | null } = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.mobile !== undefined) data.mobile = dto.mobile === '' ? null : dto.mobile;
    if (dto.telegramChatId !== undefined) data.telegramChatId = dto.telegramChatId === '' ? null : dto.telegramChatId;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update');

    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({ where: { id: userId }, data });
      await this.audit.logTx(tx, {
        action: 'PROFILE_UPDATED',
        actorUserId: userId,
        targetType: 'User',
        targetId: userId,
        metadata: { fields: Object.keys(data) },
        client: clientInfo(req),
      });
      return updated;
    });
    return toAuthUser(user);
  }

  /** Changing the password signs out every other session (all other refresh-token families). */
  async changePassword(current: RequestUser, dto: ChangePasswordDto, req: Request): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: current.id } });
    if (!(await verifyPassword(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('New password must be different from the current password');
    }
    const passwordHash = await hashPassword(dto.newPassword);
    const session = await this.prisma.session.findUnique({ where: { id: current.sessionId }, select: { familyId: true } });

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await this.audit.logTx(tx, { action: 'PASSWORD_CHANGED', actorUserId: user.id, targetType: 'User', targetId: user.id, client: clientInfo(req) });
    });
    await this.tokens.revokeAllForUser(user.id, session?.familyId);
  }
}
