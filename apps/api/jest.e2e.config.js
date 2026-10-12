/** Integration tests — require PostgreSQL + Redis from .env (docker compose up -d). */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30000,
};
