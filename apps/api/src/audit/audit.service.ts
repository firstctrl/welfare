import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, AuditEntity } from '@welfare/shared';
import { AuditLog, AuditLogDocument } from './audit-log.schema';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name) private readonly auditModel: Model<AuditLogDocument>,
  ) {}

  async log(
    actorId: string,
    actorName: string,
    action: AuditAction,
    entity: AuditEntity,
    entityId: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
    ip?: string,
  ): Promise<void> {
    try {
      await this.auditModel.create({ actorId, actorName, action, entity, entityId, before, after, ip });
    } catch (err) {
      // Never let audit logging crash the main request
      this.logger.error('Failed to write audit log', err);
    }
  }

  async findByEntity(entity: AuditEntity, entityId: string, limit = 100, skip = 0): Promise<AuditLogDocument[]> {
    return this.auditModel
      .find({ entity, entityId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async findByActor(actorId: string, limit = 100, skip = 0): Promise<AuditLogDocument[]> {
    return this.auditModel
      .find({ actorId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }
}
