import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, Module, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import type { Request, Response } from 'express';
import type { BrokerName, PrismaClient } from '@ctp/database';
import type { BrokerAccountView } from '@ctp/types';
import { clientInfo } from '../common/client-info';
import { CurrentUser, Public, RequestUser } from '../common/decorators/auth.decorators';
import { toBrokerAccountView } from '../common/mappers';
import { PRISMA } from '../common/prisma/prisma.service';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { BrokerApiError } from './broker-http';
import { BrokerSessionService } from './broker-session.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class AngelOneLoginDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsString()
  @Matches(/^[A-Z0-9]{3,20}$/, { message: 'Enter a valid Angel One client ID' })
  clientCode!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\d{4,6}$/, { message: 'PIN must be 4–6 digits' })
  pin!: string;

  @Transform(trim)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'TOTP must be 6 digits' })
  totp!: string;
}

/**
 * Broker connection flows.
 *   Zerodha   : GET /brokers/zerodha/connect → Kite login → GET /brokers/zerodha/callback
 *   Angel One : POST /brokers/angel-one/login (client ID + PIN + TOTP)
 *               or GET /brokers/angel-one/connect → publisher login → GET /brokers/angel-one/callback
 *   Both      : POST /brokers/accounts/:id/disconnect
 */
@Controller('brokers')
export class BrokersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly sessions: BrokerSessionService,
  ) {}

  @Get('accounts')
  async myAccounts(@CurrentUser() user: RequestUser): Promise<BrokerAccountView[]> {
    const accounts = await this.prisma.brokerAccount.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'asc' } });
    return accounts.map(toBrokerAccountView);
  }

  /** Which brokers are configured on this server (the UI hides buttons for the rest). */
  @Get('available')
  available(): { zerodha: boolean; angelOne: boolean; angelOnePublisherLogin: boolean } {
    const c = this.config;
    return {
      zerodha: Boolean(c.ZERODHA_API_KEY && c.ZERODHA_API_SECRET),
      angelOne: Boolean(c.ANGEL_API_KEY),
      angelOnePublisherLogin: Boolean(c.ANGEL_API_KEY && c.ANGEL_REDIRECT_URL),
    };
  }

  // ------------------------------------------------------------ Zerodha

  @Get('zerodha/connect')
  async zerodhaConnect(@CurrentUser() user: RequestUser): Promise<{ loginUrl: string }> {
    const client = this.sessions.zerodha();
    const state = await this.sessions.createState(user.id, 'ZERODHA');
    return { loginUrl: client.loginUrl(state) };
  }

  /** Kite redirects the browser here; the user is identified by the one-time `state`. */
  @Public()
  @Get('zerodha/callback')
  async zerodhaCallback(
    @Query('request_token') requestToken: string | undefined,
    @Query('status') status: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleCallback('ZERODHA', state, res, async (userId) => {
      if (status !== 'success' || !requestToken) throw new BrokerApiError('Zerodha login was cancelled or failed.');
      const s = await this.sessions.zerodha().createSession(requestToken);
      return this.sessions.saveSession(
        userId,
        'ZERODHA',
        {
          brokerClientId: s.userId,
          accessToken: s.accessToken,
          refreshToken: s.refreshToken,
          extra: { publicToken: s.publicToken },
          expiresAt: s.expiresAt,
        },
        clientInfo(req),
      );
    });
  }

  // ---------------------------------------------------------- Angel One

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('angel-one/login')
  async angelOneLogin(@CurrentUser() user: RequestUser, @Body() dto: AngelOneLoginDto, @Req() req: Request): Promise<BrokerAccountView> {
    const client = this.sessions.angelOne();
    try {
      const s = await client.loginWithTotp(dto.clientCode, dto.pin, dto.totp);
      const account = await this.sessions.saveSession(
        user.id,
        'ANGEL_ONE',
        { brokerClientId: s.clientCode, accessToken: s.jwtToken, refreshToken: s.refreshToken, extra: { feedToken: s.feedToken }, expiresAt: s.expiresAt },
        clientInfo(req),
      );
      return toBrokerAccountView(account);
    } catch (err) {
      if (err instanceof BrokerApiError) {
        throw new BadRequestException(await this.sessions.recordError(user.id, 'ANGEL_ONE', err));
      }
      throw err;
    }
  }

  @Get('angel-one/connect')
  async angelOneConnect(@CurrentUser() user: RequestUser): Promise<{ loginUrl: string }> {
    if (!this.config.ANGEL_REDIRECT_URL) {
      throw new BadRequestException('Angel One publisher login is not configured; use client ID + PIN + TOTP.');
    }
    const state = await this.sessions.createState(user.id, 'ANGEL_ONE');
    return { loginUrl: this.sessions.angelOne().publisherLoginUrl(state, this.config.ANGEL_REDIRECT_URL) };
  }

  @Public()
  @Get('angel-one/callback')
  async angelOneCallback(
    @Query('auth_token') authToken: string | undefined,
    @Query('feed_token') feedToken: string | undefined,
    @Query('refresh_token') refreshToken: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleCallback('ANGEL_ONE', state, res, async (userId) => {
      if (!authToken) throw new BrokerApiError('Angel One login was cancelled or failed.');
      const s = await this.sessions.angelOne().sessionFromPublisherTokens(authToken, refreshToken, feedToken);
      return this.sessions.saveSession(
        userId,
        'ANGEL_ONE',
        { brokerClientId: s.clientCode, accessToken: s.jwtToken, refreshToken: s.refreshToken, extra: { feedToken: s.feedToken }, expiresAt: s.expiresAt },
        clientInfo(req),
      );
    });
  }

  // -------------------------------------------------------------- shared

  @HttpCode(HttpStatus.OK)
  @Post('accounts/:id/disconnect')
  async disconnect(@CurrentUser() user: RequestUser, @Param('id') id: string, @Req() req: Request): Promise<BrokerAccountView> {
    return toBrokerAccountView(await this.sessions.disconnect(user.id, id, clientInfo(req)));
  }

  /** Runs a broker callback and always redirects the browser back to the web app with a result. */
  private async handleCallback(broker: BrokerName, state: string | undefined, res: Response, work: (userId: string) => Promise<unknown>) {
    const slug = broker === 'ZERODHA' ? 'zerodha' : 'angel-one';
    const back = new URL('/dashboard', this.config.WEB_ORIGIN);
    back.searchParams.set('broker', slug);
    let userId: string | undefined;
    try {
      userId = await this.sessions.consumeState(state, broker);
      await work(userId);
      back.searchParams.set('result', 'connected');
    } catch (err) {
      const message = userId ? await this.sessions.recordError(userId, broker, err) : (err as Error).message;
      back.searchParams.set('result', 'error');
      back.searchParams.set('message', message.slice(0, 200));
    }
    res.redirect(HttpStatus.FOUND, back.toString());
  }
}

@Module({ controllers: [BrokersController], providers: [BrokerSessionService], exports: [BrokerSessionService] })
export class BrokersModule {}
