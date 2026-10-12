import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPrismaClient, PrismaClient } from '@ctp/database';
import { API_CONFIG, ApiConfig } from '../../config/config.module';

export const PRISMA = Symbol('PRISMA');

/** Thin lifecycle wrapper; inject `PrismaService.client` or use the PRISMA token. */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Prisma');
  readonly client: PrismaClient;

  constructor(@Inject(API_CONFIG) config: ApiConfig) {
    this.client = createPrismaClient({ databaseUrl: config.DATABASE_URL, logWarnings: true });
  }

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
    this.logger.log('Connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: PRISMA, useFactory: (svc: PrismaService) => svc.client, inject: [PrismaService] },
  ],
  exports: [PrismaService, PRISMA],
})
export class PrismaModule {}
