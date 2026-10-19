/**
 * Integration tests against real PostgreSQL + Redis (from the repo .env).
 * Run: docker compose up -d && npm run prisma:migrate && npm run test:e2e
 *
 * Every test user is created with a unique e2e-* email and removed afterwards.
 */
import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type Redis from 'ioredis';
import { loadDotenv } from '@ctp/config';
import { createPrismaClient, PrismaClient } from '@ctp/database';
import { hashPassword } from '@ctp/shared';
import { RedisKeys } from '@ctp/types';
import { AppModule } from '../../src/app.module';
import { REDIS } from '../../src/common/redis/redis.module';
import { configureApp } from '../../src/main';

loadDotenv(__dirname);

const RUN = randomUUID().slice(0, 8);
const email = (name: string) => `e2e-${RUN}-${name}@example.com`.toLowerCase();
const PASSWORD = 'E2eTestPass123';
const H = { 'X-CTP-Client': 'web' };

let app: NestExpressApplication;
let prisma: PrismaClient;
let redis: Redis;

async function clearRateLimits() {
  const keys = await redis.keys(`${RedisKeys.rateLimitPrefix}*`);
  if (keys.length) await redis.del(...keys);
}

async function createUser(name: string, role: 'ADMIN' | 'MASTER' | 'FOLLOWER') {
  return prisma.user.create({
    data: { email: email(name), name: `E2E ${name}`, role, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date() },
  });
}

async function login(e: string, password = PASSWORD) {
  // Tests log in far more often than the auth rate limit allows; the limiter itself is tested separately.
  await clearRateLimits();
  const agent = request.agent(app.getHttpServer());
  let res = await agent.post('/auth/login').set(H).send({ email: e, password });
  // Masters / admins use the staff login (/master-login).
  if (res.status === 403) res = await agent.post('/auth/login').set(H).send({ email: e, password, portal: 'staff' });
  expect(res.status).toBe(200);
  return agent;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  prisma = createPrismaClient();
  redis = app.get(REDIS);
  await clearRateLimits();
});

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { startsWith: `e2e-${RUN}-` } }, select: { id: true } });
  const ids = users.map((u) => u.id);
  await prisma.strategy.deleteMany({ where: { masterUserId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await clearRateLimits();
  await prisma.$disconnect();
  await app.close();
});

describe('health', () => {
  it('GET /health reports component status', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ database: 'connected', redis: 'connected' });
    expect(['ok', 'degraded']).toContain(res.body.status);
    expect(['connected', 'disconnected']).toContain(res.body.worker);
  });
});

describe('authentication', () => {
  it('registers a follower, sets httpOnly cookies and never returns tokens or hashes in the body', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent.post('/auth/register').set(H).send({ email: email('reg'), password: PASSWORD, name: 'Reg User', role: 'FOLLOWER' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: email('reg'), role: 'FOLLOWER', emailVerified: false });
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/passwordHash|argon2|ctp_at|ctp_rt/);
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith('ctp_at=') && /HttpOnly/i.test(c))).toBe(true);
    expect(cookies.some((c) => c.startsWith('ctp_rt=') && /HttpOnly/i.test(c))).toBe(true);

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email('reg'));

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: email('reg') } });
    expect(stored.passwordHash).not.toContain(PASSWORD);
    expect(stored.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(await prisma.emailVerificationToken.count({ where: { userId: stored.id } })).toBe(1);
  });

  it('refuses self-registration as ADMIN', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').set(H).send({ email: email('sneaky'), password: PASSWORD, name: 'Sneaky', role: 'ADMIN' });
    expect(res.status).toBe(400);
  });

  it('rejects weak passwords and unknown fields', async () => {
    const weak = await request(app.getHttpServer()).post('/auth/register').set(H).send({ email: email('weak'), password: 'short', name: 'Weak', role: 'FOLLOWER' });
    expect(weak.status).toBe(400);
    const extra = await request(app.getHttpServer()).post('/auth/register').set(H).send({ email: email('x'), password: PASSWORD, name: 'X', role: 'FOLLOWER', status: 'ACTIVE' });
    expect(extra.status).toBe(400);
  });

  it('rejects duplicate emails (case-insensitive)', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').set(H).send({ email: email('reg').toUpperCase(), password: PASSWORD, name: 'Dup' });
    expect(res.status).toBe(409);
  });

  it('returns the same error for unknown email and wrong password, and audits failures', async () => {
    const a = await request(app.getHttpServer()).post('/auth/login').set(H).send({ email: email('nobody'), password: PASSWORD });
    const b = await request(app.getHttpServer()).post('/auth/login').set(H).send({ email: email('reg'), password: 'WrongPass1234' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email('reg') } });
    expect(await prisma.auditLog.count({ where: { action: 'USER_LOGIN_FAILED', actorUserId: user.id } })).toBeGreaterThan(0);
  });

  it('rotates refresh tokens over HTTP', async () => {
    await createUser('rot', 'FOLLOWER');
    const agent = await login(email('rot'));
    const rotated = await agent.post('/auth/refresh').set(H);
    expect(rotated.status).toBe(200);
    const sessions = await prisma.session.findMany({ where: { user: { email: email('rot') } }, orderBy: { createdAt: 'asc' } });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.revokedAt).not.toBeNull();
    expect(sessions[0]!.replacedById).toBe(sessions[1]!.id);
    expect(sessions[1]!.revokedAt).toBeNull();
    // The new access token works; the old session can no longer authenticate.
    expect((await agent.get('/auth/me')).status).toBe(200);
  });

  it('treats replay of a rotated refresh token as theft and revokes the whole session family', async () => {
    const { TokenService } = await import('../../src/auth/token.service');
    const tokens = app.get(TokenService);
    const user = await createUser('reuse', 'FOLLOWER');
    const issued = await tokens.issueForNewSession(user, {});
    const first = await tokens.rotate(issued.refreshToken, {});
    expect(first.kind).toBe('ok');

    // Immediate replay (another tab racing) is tolerated without killing the family.
    expect((await tokens.rotate(issued.refreshToken, {})).kind).toBe('race');

    // Replay after the grace window → reuse detected, every session in the family revoked.
    await prisma.session.update({ where: { id: issued.session.id }, data: { revokedAt: new Date(Date.now() - 120_000) } });
    const replay = await tokens.rotate(issued.refreshToken, {});
    expect(replay.kind).toBe('reuse');
    expect(await prisma.session.count({ where: { familyId: issued.session.familyId, revokedAt: null } })).toBe(0);
    if (first.kind === 'ok') expect((await tokens.rotate(first.tokens.refreshToken, {})).kind).not.toBe('ok');
  });

  it('a refresh token can only be consumed once under concurrency', async () => {
    const { TokenService } = await import('../../src/auth/token.service');
    const tokens = app.get(TokenService);
    const user = await createUser('concurrent', 'FOLLOWER');
    const issued = await tokens.issueForNewSession(user, {});
    const results = await Promise.all(Array.from({ length: 5 }, () => tokens.rotate(issued.refreshToken, {})));
    expect(results.filter((r) => r.kind === 'ok')).toHaveLength(1);
    expect(await prisma.session.count({ where: { familyId: issued.session.familyId, revokedAt: null } })).toBe(1);
  });

  it('logout revokes the session server-side', async () => {
    await createUser('logout', 'MASTER');
    const agent = await login(email('logout'));
    expect((await agent.get('/auth/me')).status).toBe(200);
    expect((await agent.post('/auth/logout').set(H)).status).toBe(204);
    expect((await agent.get('/auth/me')).status).toBe(401);
    expect(await prisma.session.count({ where: { user: { email: email('logout') }, revokedAt: null } })).toBe(0);
  });

  it('requires the client header on state-changing cookie requests (CSRF defence)', async () => {
    await createUser('csrf', 'FOLLOWER');
    const agent = await login(email('csrf'));
    const res = await agent.patch('/users/me').send({ name: 'Changed' });
    expect(res.status).toBe(403);
    const ok = await agent.patch('/users/me').set(H).send({ name: 'Changed' });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Changed');
  });

  it('changing password revokes other sessions but keeps the current one', async () => {
    await createUser('pw', 'FOLLOWER');
    const a = await login(email('pw'));
    const b = await login(email('pw'));
    const res = await a.post('/users/me/password').set(H).send({ currentPassword: PASSWORD, newPassword: 'BrandNewPass456' });
    expect(res.status).toBe(204);
    expect((await a.get('/auth/me')).status).toBe(200);
    expect((await b.get('/auth/me')).status).toBe(401);
    await login(email('pw'), 'BrandNewPass456');
  });
});

describe('RBAC', () => {
  it('anonymous requests to protected routes get 401', async () => {
    expect((await request(app.getHttpServer()).get('/auth/me')).status).toBe(401);
    expect((await request(app.getHttpServer()).get('/admin/dashboard')).status).toBe(401);
  });

  it.each(['MASTER', 'FOLLOWER'] as const)('%s cannot access admin endpoints', async (role) => {
    await createUser(`rbac-${role}`, role);
    const agent = await login(email(`rbac-${role}`));
    for (const path of ['/admin/dashboard', '/admin/users', '/admin/audit-logs', '/admin/system-health']) {
      expect((await agent.get(path)).status).toBe(403);
    }
    expect((await agent.post('/admin/copy-trading/halt').set(H).send({ reason: 'nope' })).status).toBe(403);
  });

  it('admin can read the dashboard and users without seeing secrets', async () => {
    await createUser('admin', 'ADMIN');
    const agent = await login(email('admin'));
    const dash = await agent.get('/admin/dashboard');
    expect(dash.status).toBe(200);
    expect(dash.body).toHaveProperty('totalUsers');
    const users = await agent.get('/admin/users').query({ search: `e2e-${RUN}`, pageSize: 100 });
    expect(users.status).toBe(200);
    expect(users.body.total).toBeGreaterThan(0);
    expect(JSON.stringify(users.body)).not.toMatch(/passwordHash|encryptedAccessToken|argon2/);
  });
});

describe('admin actions', () => {
  it('disabling a user revokes sessions, stops copy trading, pauses strategies and is audited', async () => {
    await createUser('admin2', 'ADMIN');
    const admin = await login(email('admin2'));
    const master = await createUser('dis-master', 'MASTER');
    const follower = await createUser('dis-follower', 'FOLLOWER');
    const strategy = await prisma.strategy.create({
      data: { masterUserId: master.id, name: `E2E ${RUN}`, status: 'ACTIVE', allowedExchanges: ['NFO'], allowedInstruments: [] },
    });
    const follow = await prisma.strategyFollower.create({
      data: { strategyId: strategy.id, followerUserId: follower.id, copyStatus: 'ON', startedAt: new Date() },
    });
    const followerAgent = await login(email('dis-follower'));
    expect((await followerAgent.get('/auth/me')).status).toBe(200);

    const noReason = await admin.patch(`/admin/users/${follower.id}/status`).set(H).send({ status: 'DISABLED' });
    expect(noReason.status).toBe(400);

    const res = await admin.patch(`/admin/users/${follower.id}/status`).set(H).send({ status: 'DISABLED', reason: 'E2E test' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISABLED');
    expect((await followerAgent.get('/auth/me')).status).toBe(401);
    expect((await prisma.strategyFollower.findUniqueOrThrow({ where: { id: follow.id } })).copyStatus).toBe('OFF');
    expect(await prisma.auditLog.count({ where: { action: 'ADMIN_DISABLED_USER', targetId: follower.id } })).toBe(1);

    const disabledLogin = await request(app.getHttpServer()).post('/auth/login').set(H).send({ email: email('dis-follower'), password: PASSWORD });
    expect(disabledLogin.status).toBe(403);

    // Disabling the master pauses their strategy.
    await admin.patch(`/admin/users/${master.id}/status`).set(H).send({ status: 'DISABLED', reason: 'E2E test' });
    expect((await prisma.strategy.findUniqueOrThrow({ where: { id: strategy.id } })).status).toBe('PAUSED');

    // Re-enabling does not restart copying.
    const enabled = await admin.patch(`/admin/users/${follower.id}/status`).set(H).send({ status: 'ACTIVE' });
    expect(enabled.status).toBe(200);
    expect((await prisma.strategyFollower.findUniqueOrThrow({ where: { id: follow.id } })).copyStatus).toBe('OFF');
  });

  it('an admin cannot disable themselves', async () => {
    const me = await createUser('self', 'ADMIN');
    const agent = await login(email('self'));
    const res = await agent.patch(`/admin/users/${me.id}/status`).set(H).send({ status: 'DISABLED', reason: 'oops' });
    expect(res.status).toBe(400);
  });

  it('disconnecting a broker account deletes credentials and stops copying through it', async () => {
    await createUser('admin3', 'ADMIN');
    const admin = await login(email('admin3'));
    const follower = await createUser('bk-follower', 'FOLLOWER');
    const master = await createUser('bk-master', 'MASTER');
    const account = await prisma.brokerAccount.create({
      data: { userId: follower.id, broker: 'MOCK', brokerClientId: `E2E-${RUN}`, status: 'CONNECTED', isPaper: true },
    });
    await prisma.brokerCredential.create({ data: { brokerAccountId: account.id, encryptedAccessToken: 'v1:k1:x:y:z' } });
    const strategy = await prisma.strategy.create({ data: { masterUserId: master.id, name: `E2E bk ${RUN}`, status: 'ACTIVE' } });
    const follow = await prisma.strategyFollower.create({
      data: { strategyId: strategy.id, followerUserId: follower.id, brokerAccountId: account.id, copyStatus: 'ON' },
    });

    const res = await admin.post(`/admin/broker-accounts/${account.id}/disconnect`).set(H).send({ reason: 'E2E disconnect' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('DISCONNECTED');
    expect(JSON.stringify(res.body)).not.toMatch(/encrypted/i);
    expect(await prisma.brokerCredential.count({ where: { brokerAccountId: account.id } })).toBe(0);
    expect((await prisma.strategyFollower.findUniqueOrThrow({ where: { id: follow.id } })).copyStatus).toBe('OFF');
  });

  it('global halt sets the Redis kill switch and resume clears it', async () => {
    await createUser('admin4', 'ADMIN');
    const admin = await login(email('admin4'));
    const existing = await redis.get(RedisKeys.copyHalted);
    const halt = await admin.post('/admin/copy-trading/halt').set(H).send({ reason: 'E2E halt' });
    expect(halt.status).toBe(201);
    expect(await redis.get(RedisKeys.copyHalted)).not.toBeNull();
    expect((await admin.get('/admin/copy-trading/status')).body.halted).toBe(true);
    const resume = await admin.post('/admin/copy-trading/resume').set(H).send({ reason: 'E2E resume' });
    expect(resume.status).toBe(201);
    expect(await redis.get(RedisKeys.copyHalted)).toBeNull();
    if (existing) await redis.set(RedisKeys.copyHalted, existing);
  });
});

describe('rate limiting', () => {
  it('limits login attempts per client', async () => {
    await clearRateLimits();
    const server = app.getHttpServer();
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push((await request(server).post('/auth/login').set(H).send({ email: email('rl'), password: 'Whatever123' })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(10)).toContain(429);
    await clearRateLimits();
  });
});
