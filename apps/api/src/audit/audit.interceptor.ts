import {
  Injectable, NestInterceptor, ExecutionContext, CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { AUDIT_KEY, AuditMetadata } from './audit.decorator';
import { UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditMetadata | undefined>(
      AUDIT_KEY,
      context.getHandler(),
    );

    if (!metadata) return next.handle();

    const request = context.switchToHttp().getRequest<Request & { user?: UserDocument }>();
    const user = request.user;
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';

    return next.handle().pipe(
      tap((responseData: unknown) => {
        if (!user) return;

        // Extract entityId from response or route params
        const entityId =
          (request.params as Record<string, string>)?.id ||
          (responseData as Record<string, unknown> | null)?._id?.toString() ||
          'unknown';

        // Fire-and-forget — never block the response
        void this.auditService.log(
          user._id.toString(),
          user.displayName,
          metadata.action,
          metadata.entity,
          entityId,
          undefined,
          undefined,
          ip,
        );
      }),
    );
  }
}
