import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';

/**
 * Catches every 429 (TOO_MANY_REQUESTS) — both @nestjs/throttler's
 * ThrottlerException and our custom HttpException 429s (e.g.
 * AskGgQuotaService fair-use pause) — and sets the HTTP `Retry-After`
 * header (RFC 7231 §7.1.3) on the response before delegating to the
 * default Nest exception handler.
 *
 * Why: clients, proxies (nginx, Cloudflare) and standards-compliant
 * retry libraries look at the `Retry-After` header to back off.
 * Returning the value only inside a JSON body means a naive client
 * retries immediately and our fair-use enforcement collapses.
 *
 * Header value: seconds (integer). We prefer `retryAfterSec` from the
 * exception payload when present (custom quota errors set this);
 * otherwise we fall back to 60s — matching the throttler's default TTL.
 *
 * Non-429 HttpExceptions are re-delegated to BaseExceptionFilter so
 * response shape and logging match Nest defaults exactly.
 */
@Catch(HttpException)
export class RetryAfterFilter extends BaseExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    if (exception.getStatus() === HttpStatus.TOO_MANY_REQUESTS) {
      const res = host.switchToHttp().getResponse<Response>();
      const body = exception.getResponse();
      let retryAfterSec = 60;
      if (body && typeof body === 'object') {
        const candidate = (body as Record<string, unknown>).retryAfterSec;
        if (typeof candidate === 'number' && Number.isFinite(candidate)) {
          retryAfterSec = Math.max(1, Math.ceil(candidate));
        }
      }
      res.setHeader('Retry-After', String(retryAfterSec));
    }
    super.catch(exception, host);
  }
}
