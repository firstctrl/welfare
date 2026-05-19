import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { AuditAction, AuditEntity } from '@welfare/shared';
import { AuditLog, AuditLogDocument } from './audit-log.schema';
import { AuditQueryDto } from './dto/audit-query.dto';

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

  async findAll(query: AuditQueryDto): Promise<{
    data: AuditLogDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const filter: Record<string, unknown> = {};
    if (query.actorId) filter.actorId = query.actorId;
    if (query.entity) filter.entity = query.entity;
    if (query.action) filter.action = query.action;
    if (query.from || query.to) {
      const range: Record<string, Date> = {};
      if (query.from) range.$gte = new Date(query.from);
      if (query.to) range.$lte = new Date(query.to);
      filter.createdAt = range;
    }
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.auditModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean().exec(),
      this.auditModel.countDocuments(filter).exec(),
    ]);
    return { data: data as unknown as AuditLogDocument[], total, page, limit };
  }
}
