import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, AuditEntity } from '@welfare/shared';
import { AuditLog, AuditLogDocument } from './audit-log.schema';

export interface LogAuditParams {
  actorId: string;
  actorName: string;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
  ) {}

  async log(params: LogAuditParams): Promise<void> {
    try {
      await this.auditModel.create(params);
    } catch (err) {
      // Never let audit logging crash the main request
      this.logger.error('Failed to write audit log', err);
    }
  }

  async findByEntity(entity: AuditEntity, entityId: string): Promise<AuditLogDocument[]> {
    return this.auditModel
      .find({ entity, entityId })
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
  }

  async findByActor(actorId: string): Promise<AuditLogDocument[]> {
    return this.auditModel
      .find({ actorId })
      .sort({ createdAt: -1 })
      .limit(100)
      .exec();
  }
}
