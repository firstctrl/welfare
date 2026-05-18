import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { StaffStatus } from '@welfare/shared';

export type StaffDocument = HydratedDocument<Staff>;

@Schema({ timestamps: true, collection: 'staff' })
export class Staff {
  @Prop({ required: true, trim: true }) fullName!: string;
  @Prop({ required: true, unique: true, trim: true }) staffId!: string;
  @Prop({ required: true, trim: true }) pfNo!: string;
  @Prop({ required: true }) dateOfBirth!: Date;
  @Prop({ required: true, trim: true }) phoneNumber!: string;
  @Prop({ trim: true, sparse: true }) email?: string;
  @Prop() photoKey?: string;
  @Prop({ required: true }) dateOfEmployment!: Date;
  @Prop({ required: true }) dateOfFirstContribution!: Date;
  @Prop({ required: true, trim: true }) level!: string;
  @Prop({ required: true, min: 0, default: 0 }) point!: number;
  @Prop({ required: true, enum: StaffStatus, default: StaffStatus.Active })
  status!: StaffStatus;
}

export const StaffSchema = SchemaFactory.createForClass(Staff);

StaffSchema.index({ status: 1 });
StaffSchema.index({ level: 1 });
StaffSchema.index({ fullName: 'text', staffId: 'text', pfNo: 'text' });
