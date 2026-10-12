import { Global, Module } from '@nestjs/common';
import { ApiEnv, loadApiEnv, loadDotenv } from '@ctp/config';

export const API_CONFIG = Symbol('API_CONFIG');
export type ApiConfig = ApiEnv;

/** Loads and validates environment once at boot. The process exits if validation fails. */
@Global()
@Module({
  providers: [
    {
      provide: API_CONFIG,
      useFactory: (): ApiConfig => {
        loadDotenv();
        return loadApiEnv();
      },
    },
  ],
  exports: [API_CONFIG],
})
export class ConfigModule {}
