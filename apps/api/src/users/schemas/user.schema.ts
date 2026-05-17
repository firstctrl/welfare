import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  username!: string;

  @Prop({ required: true })
  displayName!: string;

  @Prop({ sparse: true, unique: true })
  email?: string;

  @Prop({ required: true, enum: ['WELFARE_OFFICER'], default: 'WELFARE_OFFICER' })
  role!: string;

  @Prop({ required: true, enum: ['ldap', 'local'] })
  source!: 'ldap' | 'local';

  @Prop({ select: false })
  passwordHash?: string;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop()
  lastLogin?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
