import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@ctp/database';
import type { Response } from 'express';
import type { ApiErrorBody } from '@ctp/types';
import type { AuthenticatedRequest } from '../decorators/auth.decorators';

/**
 * Consistent error bodies. Internal error details (stack traces, SQL, broker payloads) are logged
 * server-side and never sent to the client. Request bodies are never logged.
 */
function statusText(status: number): string {
  const name = HttpStatus[status];
  if (!name) return 'Error';
  return name
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthenticatedRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      error = statusText(status);
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; error?: string };
        message = b.message ?? exception.message;
        if (b.error) error = b.error;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        error = 'Conflict';
        message = 'A record with these values already exists';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        error = 'Not Found';
        message = 'Record not found';
      } else {
        this.logger.error(`Prisma error ${exception.code} on ${req.method} ${req.path} [${req.requestId}]`);
      }
    } else {
      const err = exception as Error;
      this.logger.error(`Unhandled error on ${req.method} ${req.path} [${req.requestId}]: ${err?.message}`, err?.stack);
    }

    const payload: ApiErrorBody = { statusCode: status, error, message, requestId: req.requestId };
    res.status(status).json(payload);
  }
}
