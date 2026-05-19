import {
  ExceptionFilter, Catch, ArgumentsHost,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exResponse = exception.getResponse();
      if (typeof exResponse === 'string') {
        message = exResponse;
        code = this.statusToCode(statusCode);
      } else if (typeof exResponse === 'object' && exResponse !== null) {
        const r = exResponse as { message?: string | string[]; error?: string };
        message = r.message ?? message;
        code = r.error?.toUpperCase().replace(/\s+/g, '_') ?? this.statusToCode(statusCode);
      }
    } else {
      this.logger.error('Unhandled exception', exception instanceof Error ? exception.stack : exception);
    }

    response.status(statusCode).json({
      statusCode,
      message,
      code,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
    };
    return map[status] ?? 'ERROR';
  }
}
