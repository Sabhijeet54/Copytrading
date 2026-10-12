import type { CookieOptions, Response } from 'express';
import type { ApiConfig } from '../config/config.module';

export const ACCESS_COOKIE = 'ctp_at';
export const REFRESH_COOKIE = 'ctp_rt';

/**
 * Tokens are only ever delivered as httpOnly cookies — never in a response body —
 * so page JavaScript (and any XSS) cannot read them.
 *
 * The web app proxies /api/* to this API (Next.js rewrites), so cookies are first-party
 * to the web origin and SameSite=Lax is sufficient.
 */
function base(config: ApiConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
  };
}

export function setAuthCookies(
  res: Response,
  config: ApiConfig,
  tokens: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base(config), maxAge: config.JWT_ACCESS_TTL_SECONDS * 1000 });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, { ...base(config), expires: tokens.refreshExpiresAt });
}

export function clearAuthCookies(res: Response, config: ApiConfig): void {
  res.clearCookie(ACCESS_COOKIE, base(config));
  res.clearCookie(REFRESH_COOKIE, base(config));
}
