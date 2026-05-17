import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { AuditAction, AuditEntity } from '@welfare/shared';

export type AuditLogDocument = HydratedDocument<AuditLog>;

@Schema({ timestamps: { createdAt: true, updatedAt: false }, versionKey: false })
export class AuditLog {
  @Prop({ required: true })
  actorId!: string;

  @Prop({ required: true })
  actorName!: string;

  @Prop({ required: true, enum: Object.values(AuditAction) })
  action!: AuditAction;

  @Prop({ required: true, enum: Object.values(AuditEntity) })
  entity!: AuditEntity;

  @Prop({ required: true })
  entityId!: string;

  @Prop({ type: Object })
  before?: Record<string, unknown>;

  @Prop({ type: Object })
  after?: Record<string, unknown>;

  @Prop()
  ip?: string;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
// Index for efficient querying by entity or actor
AuditLogSchema.index({ entity: 1, entityId: 1, createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
