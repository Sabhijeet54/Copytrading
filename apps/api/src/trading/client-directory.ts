import type { PrismaClient } from '@ctp/database';
import { isRemoved } from './follower-access';

/**
 * Active client (FOLLOWER) accounts for the "Assign client" picker — name, email, mobile and whether the client
 * already has `strategyId`. Never returns secrets.
 */
export async function clientDirectory(prisma: PrismaClient, search?: string, strategyId?: string) {
  const q = search?.trim().slice(0, 100);
  const users = await prisma.user.findMany({
    where: {
      role: 'FOLLOWER',
      status: 'ACTIVE',
      ...(q
        ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }, { mobile: { contains: q } }] }
        : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      mobile: true,
      follows: strategyId ? { where: { strategyId }, select: { copyStatus: true, stoppedReason: true } } : false,
    },
    orderBy: { name: 'asc' },
    take: 50,
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    mobile: u.mobile,
    assigned: Array.isArray(u.follows) && u.follows.some((f) => !isRemoved(f)),
  }));
}
