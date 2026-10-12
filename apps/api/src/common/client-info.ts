import type { Request } from 'express';
import type { ClientInfo } from '../auth/token.service';

/** req.ip honours `trust proxy` (enabled via TRUST_PROXY behind Railway's edge). */
export function clientInfo(req: Request): ClientInfo {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}
