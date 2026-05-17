import { SetMetadata } from '@nestjs/common';
import { AuditAction, AuditEntity } from '@welfare/shared';

export const AUDIT_KEY = 'audit_metadata';

export interface AuditMetadata {
  action: AuditAction;
  entity: AuditEntity;
}

export const Audit = (action: AuditAction, entity: AuditEntity) =>
  SetMetadata(AUDIT_KEY, { action, entity } satisfies AuditMetadata);
