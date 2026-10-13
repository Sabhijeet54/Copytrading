import * as Prisma from '@ctp/database';
import * as Types from '@ctp/types';

/** The frontend-safe enum mirrors in @ctp/types must match the Prisma schema exactly. */
const ENUMS = [
  'Role',
  'UserStatus',
  'BrokerName',
  'BrokerAccountStatus',
  'BrokerAccountMode',
  'StrategyStatus',
  'RiskLevel',
  'AllocationMode',
  'CopyStatus',
  'Exchange',
  'OrderSide',
  'OrderType',
  'ProductType',
  'OrderStatus',
  'OrderSource',
  'NotificationSeverity',
  'TransactionType',
  'SystemEventSeverity',
  'AuditAction',
] as const;

describe('enum mirrors', () => {
  it.each(ENUMS)('%s matches the Prisma enum', (name) => {
    const prismaEnum = (Prisma as unknown as Record<string, Record<string, string>>)[name];
    const typesEnum = (Types as unknown as Record<string, Record<string, string>>)[name];
    expect(prismaEnum).toBeDefined();
    expect(typesEnum).toBeDefined();
    expect(Object.values(typesEnum!).sort()).toEqual(Object.values(prismaEnum!).sort());
  });
});
