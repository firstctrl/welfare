import { AuditAction } from '../enums/audit-action.enum';
import { AuditEntity } from '../enums/audit-entity.enum';
export interface IAuditLog {
    _id: string;
    actorId: string;
    actorName: string;
    action: AuditAction;
    entity: AuditEntity;
    entityId: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    ip?: string;
    createdAt: string;
}
//# sourceMappingURL=audit-log.interface.d.ts.map