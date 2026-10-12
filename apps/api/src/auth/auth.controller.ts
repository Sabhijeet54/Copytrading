import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthResponse, AuthUser } from '@ctp/types';
import { clientInfo } from '../common/client-info';
import { CurrentUser, Public, RequestUser } from '../common/decorators/auth.decorators';
import { toAuthUser } from '../common/mappers';
import { API_CONFIG, ApiConfig } from '../config/config.module';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './auth-cookies';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto, ResendVerificationDto, VerifyEmailDto } from './dto/auth.dto';

/** Stricter limits for credential endpoints: 10 requests / minute / IP. */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse | { user: AuthUser; verificationRequired: true }> {
    const result = await this.auth.register(dto, clientInfo(req));
    if (!result.tokens) return { user: toAuthUser(result.user), verificationRequired: true };
    setAuthCookies(res, this.config, result.tokens);
    return { user: toAuthUser(result.user), accessTokenExpiresAt: result.tokens.accessTokenExpiresAt };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    const { user, tokens } = await this.auth.login(dto, clientInfo(req));
    setAuthCookies(res, this.config, tokens!);
    return { user: toAuthUser(user), accessTokenExpiresAt: tokens!.accessTokenExpiresAt };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<AuthResponse> {
    try {
      const { user, tokens } = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], clientInfo(req));
      setAuthCookies(res, this.config, tokens);
      return { user: toAuthUser(user), accessTokenExpiresAt: tokens.accessTokenExpiresAt };
    } catch (err) {
      const isRace = (err as { getResponse?: () => { code?: string } }).getResponse?.()?.code === 'REFRESH_RACE';
      if (!isRace) clearAuthCookies(res, this.config);
      throw err;
    }
  }

  /** Public so a user with an expired access token can still end their session. */
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], clientInfo(req));
    clearAuthCookies(res, this.config);
  }

  @Get('me')
  async me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return toAuthUser(await this.auth.getUser(user.id));
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto, @Req() req: Request): Promise<{ verified: true }> {
    await this.auth.verifyEmail(dto.token, clientInfo(req));
    return { verified: true };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @HttpCode(HttpStatus.ACCEPTED)
  @Post('resend-verification')
  async resend(@Body() dto: ResendVerificationDto): Promise<{ accepted: true }> {
    await this.auth.resendVerification(dto.email);
    return { accepted: true };
  }
}
