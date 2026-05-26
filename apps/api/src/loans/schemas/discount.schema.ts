import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DiscountDocument = HydratedDocument<Discount>;

@Schema({ timestamps: true, collection: 'discounts' })
export class Discount {
  @Prop({ required: true }) staffId!: string;
  @Prop({ required: true }) loanId!: string;
  @Prop({ required: true, enum: ['Origination', 'PayOff'] }) discountType!: 'Origination' | 'PayOff';
  @Prop({ required: true, min: 0 }) discountRate!: number;
  @Prop({ required: true, min: 0 }) discountAmount!: number;
  @Prop({ required: true }) dateGranted!: Date;
  @Prop({ default: false }) cancelled!: boolean;
  @Prop() cancelledAt?: Date;
  @Prop() cancelledReason?: string;
}

export const DiscountSchema = SchemaFactory.createForClass(Discount);
DiscountSchema.index({ loanId: 1 });
DiscountSchema.index({ staffId: 1 });
DiscountSchema.index({ cancelled: 1, discountType: 1 });
