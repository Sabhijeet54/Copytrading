import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../../auth/auth-cookies';
import type { AuthenticatedRequest } from '../decorators/auth.decorators';

export const CLIENT_HEADER = 'x-ctp-client';

/** Assigns a request id (accepts an incoming one if it looks sane) and echoes it back. */
export function requestId(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

const accessLogger = new Logger('HTTP');

/**
 * Access log: method, PATH ONLY (query strings are dropped because broker callbacks carry
 * one-time request tokens), status and duration. Bodies and headers are never logged.
 */
export function accessLog(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (req.path === '/health') return;
    accessLogger.log(`${req.method} ${req.path} ${res.statusCode} ${ms.toFixed(1)}ms [${req.requestId}]`);
  });
  next();
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence-in-depth on top of SameSite=Lax cookies: state-changing requests that carry
 * auth cookies must also send the custom `X-CTP-Client` header, which a cross-site HTML form
 * cannot set and a cross-origin fetch cannot send without passing CORS preflight.
 */
export function csrfHeaderCheck(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) return next();
  const hasAuthCookie = Boolean(req.cookies?.[ACCESS_COOKIE] || req.cookies?.[REFRESH_COOKIE]);
  if (hasAuthCookie && !req.header(CLIENT_HEADER)) {
    res.status(403).json({ statusCode: 403, error: 'Forbidden', message: 'Missing client header' });
    return;
  }
  next();
}
